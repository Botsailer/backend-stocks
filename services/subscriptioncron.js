const cron = require("node-cron");
const mongoose = require("mongoose");
const Subscription = require("../models/subscription");
const PaymentHistory = require("../models/paymenthistory");
const winston = require("winston");
const { getRazorpayInstance, getConfig } = require("../utils/configSettings");
const TelegramService = require("../services/tgservice");
const User = require("../models/user");
const { sendEmail } = require("../services/emailServices");

// Logger configuration
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: "logs/subscription-cleanup.log",
      maxsize: 5 * 1024 * 1024,
      maxFiles: 7
    })
  ]
});

// Recurring payment check job (runs every hour)
const checkRecurringPaymentsJob = cron.schedule("0 * * * *", async () => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
  const subscriptions = await Subscription.find({ 
    type: "recurring", 
    status: "active" 
  }).populate({
    path: 'productId',
    refPath: 'productType'
  }).populate('user');
  
  const razorpay = await getRazorpayInstance();
  
  for (const sub of subscriptions) {
    try {
      const rSub = await razorpay.subscriptions.fetch(sub.razorpaySubscriptionId);
      
      if (["halted", "cancelled", "expired"].includes(rSub.status)) {
        // Get product name and user email for API call
        let productName = 'Unknown Product';
        if (sub.productType === 'Portfolio' && sub.productId && sub.productId.name) {
          productName = sub.productId.name;
        } else if (sub.productType === 'Bundle' && sub.productId && sub.productId.name) {
          productName = sub.productId.name;
        }
        
        const userEmail = sub.user && sub.user.email ? sub.user.email : null;
        
        // Call subscription cancellation API
        if (userEmail && sub.productId) {
          const cancelResult = await TelegramService.cancelSubscription(
            userEmail,
            sub.productId._id || sub.productId,
            productName,
            sub.expiresAt
          );
          
          if (!cancelResult.success) {
            logger.warn(`Failed to cancel subscription via API for ${userEmail}: ${cancelResult.error}`);
            await sendAdminNotification(
              'Recurring Subscription Cancellation API Failed',
              `Failed to cancel recurring subscription via DELETE API for user ${userEmail}, product: ${productName}`,
              {
                subscriptionId: sub._id,
                razorpayStatus: rSub.status,
                userEmail,
                productId: sub.productId._id || sub.productId,
                productName,
                error: cancelResult.error
              }
            );
          } else {
            logger.info(`Successfully cancelled recurring subscription for ${userEmail}, product: ${productName}`);
          }
        }
        
        await Subscription.updateOne(
          { _id: sub._id },
          { status: "cancelled", cancelledAt: now, cancelReason: "Payment failed or mandate cancelled" }
        );
        await updateUserPremiumStatus(sub.user);
        logger.info(`Cancelled recurring subscription (Razorpay status): ${sub._id} for user: ${sub.user}`);
      }
      
      // If the subscription is active but last payment is more than 30 days ago, cancel
      if (rSub.status === "active" && (!sub.lastPaymentAt || new Date(sub.lastPaymentAt) < thirtyDaysAgo)) {
        // Get product name and user email for API call
        let productName = 'Unknown Product';
        if (sub.productType === 'Portfolio' && sub.productId && sub.productId.name) {
          productName = sub.productId.name;
        } else if (sub.productType === 'Bundle' && sub.productId && sub.productId.name) {
          productName = sub.productId.name;
        }
        
        const userEmail = sub.user && sub.user.email ? sub.user.email : null;
        
        // Call subscription cancellation API
        if (userEmail && sub.productId) {
          const cancelResult = await TelegramService.cancelSubscription(
            userEmail,
            sub.productId._id || sub.productId,
            productName,
            sub.expiresAt
          );
          
          if (!cancelResult.success) {
            logger.warn(`Failed to cancel stalled subscription via API for ${userEmail}: ${cancelResult.error}`);
            await sendAdminNotification(
              'Stalled Recurring Subscription Cancellation API Failed',
              `Failed to cancel stalled recurring subscription via DELETE API for user ${userEmail}, product: ${productName}`,
              {
                subscriptionId: sub._id,
                stalledReason: 'No payment for 30+ days',
                userEmail,
                productId: sub.productId._id || sub.productId,
                productName,
                lastPaymentAt: sub.lastPaymentAt,
                error: cancelResult.error
              }
            );
          } else {
            logger.info(`Successfully cancelled stalled recurring subscription for ${userEmail}, product: ${productName}`);
          }
        }
        
        await Subscription.updateOne(
          { _id: sub._id },
          { status: "cancelled", updatedAt: now, cancellationReason: "Payment failure - auto-cancelled after 30 days of no payment" }
        );
        await updateUserPremiumStatus(sub.user);
        logger.info(`Cancelled stalled recurring subscription: ${sub._id} for user: ${sub.user}`);
      }
    } catch (err) {
      logger.error(`Error checking subscription ${sub._id}:`, err);
      
      // Send admin notification for subscription check error
      await sendAdminNotification(
        'Recurring Payment Check Error',
        `Error checking recurring subscription ${sub._id}`,
        {
          subscriptionId: sub._id,
          error: err.message,
          stack: err.stack
        }
      );
    }
  }
  logger.info("Recurring payment check completed");
}, { timezone: "Asia/Kolkata", scheduled: false });

async function sendAdminNotification(subject, message, errorDetails = null) {
  try {
    const adminEmail = await getConfig("RECEIVE_EMAIL_AT" , 'support@rangaone.finance');
    const htmlContent = `
      <div style="max-width:600px; margin:0 auto; padding:20px; font-family:sans-serif;">
        <h2 style="color:#e74c3c;">Admin Notification</h2>
        <p><strong>Subject:</strong> ${subject}</p>
        <p><strong>Message:</strong> ${message}</p>
        
        ${errorDetails ? `
        <div style="background-color:#f8f9fa; padding:15px; border-radius:5px; margin:20px 0;">
          <h3 style="color:#e74c3c; margin-top:0;">Error Details:</h3>
          <pre style="background:#fff; padding:10px; border-radius:3px; overflow-x:auto;">${JSON.stringify(errorDetails, null, 2)}</pre>
        </div>
        ` : ''}
        
        <hr style="margin:30px 0; border:none; border-top:1px solid #eee;">
        <p style="color:#666; font-size:12px;">This is an automated admin notification from subscription service.</p>
      </div>
    `;
    
    await sendEmail(adminEmail, subject, message, htmlContent);
    logger.info(`Admin notification sent: ${subject}`);
  } catch (error) {
    logger.error('Failed to send admin notification:', {
      subject,
      error: error.message
    });
  }
}

async function updateUserPremiumStatus(userId) {
  try {
    const now = new Date();
    const hasPremiumSubscription = await Subscription.exists({
      user: userId,
      status: "active",
      category: { $regex: /^premium$/i },
      expiresAt: { $gt: now }
    });
    
    await User.findByIdAndUpdate(userId, { hasPremium: !!hasPremiumSubscription });
    return !!hasPremiumSubscription;
  } catch (error) {
    logger.error('Error updating premium status:', error);
    return false;
  }
}

async function processExpiredSubscriptions() {
  try {
    const now = new Date();
    logger.info(`Starting expired subscription processing at ${now.toISOString()}`);
    
    // Find subscriptions that expired but haven't been successfully processed
    // Either they're active and expired, or they're marked as expired but the telegram kick wasn't successful
    const expiredSubs = await Subscription.find({
      $or: [
        { status: 'active', expiresAt: { $lt: now } },
        { 
          status: 'expired', 
          telegram_kicked: { $ne: true },
          // Limit to subscriptions that haven't had too many kick attempts
          $or: [
            { kickAttemptCount: { $lt: 3 } },
            { kickAttemptCount: { $exists: false } }
          ],
          // Only retry subscriptions that expired within the last 30 days
          expiredAt: { $gt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) }
        }
      ]
    }).populate({
      path: 'productId',
      refPath: 'productType'
    }).populate('user');
    
    logger.info(`Found ${expiredSubs.length} expired subscriptions to process`);
    
    let processedCount = 0;
    let kickSuccessCount = 0;
    let cancelSuccessCount = 0;
    
    for (const sub of expiredSubs) {
      try {
        let productName = 'Unknown Product';
        
        // Get product name based on product type
        if (sub.productType === 'Portfolio' && sub.productId && sub.productId.name) {
          productName = sub.productId.name;
        } else if (sub.productType === 'Bundle' && sub.productId && sub.productId.name) {
          productName = sub.productId.name;
        }
        
        // Get user email
        const userEmail = sub.user && sub.user.email ? sub.user.email : null;
        
        // Attempt to cancel subscription via API
        let cancelResult = { success: false };
        if (userEmail && sub.productId) {
          // Get correct product ID for cancellation
          let productId = null;
          
          if (sub.productId) {
            if (typeof sub.productId.externalId === 'string' && sub.productId.externalId.trim() !== '') {
              // Use the external ID if available and valid
              productId = sub.productId.externalId;
              logger.info(`Using externalId for Telegram cancellation: ${productId}, user: ${userEmail}`);
            } else if (sub.productId._id) {
              // Fall back to MongoDB ID
              productId = sub.productId._id.toString();
              logger.info(`Using MongoDB ID for Telegram cancellation: ${productId}, user: ${userEmail}`);
            } else if (typeof sub.productId === 'string') {
              // Handle case where productId is already a string
              productId = sub.productId;
              logger.info(`Using string productId for Telegram cancellation: ${productId}, user: ${userEmail}`);
            }
          }
          
          if (!productId) {
            logger.error(`Cannot determine product ID for Telegram cancellation, subscription: ${sub._id}, user: ${userEmail}`);
            productId = sub.productId ? (sub.productId._id ? sub.productId._id.toString() : sub.productId.toString()) : null;
          }
          
          cancelResult = await TelegramService.cancelSubscription(
            userEmail,
            productId
          );
          
          if (cancelResult.success) {
            cancelSuccessCount++;
            logger.info(`Successfully cancelled subscription for ${userEmail}, product: ${productName}`);
          } else {
            logger.warn(`Failed to cancel subscription via API for ${userEmail}: ${cancelResult.error}`);
            
            // Send admin notification for API failure
            await sendAdminNotification(
              'Subscription Cancellation API Failed',
              `Failed to cancel subscription via DELETE API for user ${userEmail}, product: ${productName}`,
              {
                subscriptionId: sub._id,
                userEmail,
                productId: sub.productId._id || sub.productId,
                productName,
                productType: sub.productType,
                expirationDate: sub.expiresAt,
                error: cancelResult.error
              }
            );
          }
        } else {
          logger.warn(`Missing email or productId for subscription ${sub._id}`);
        }
        
        // Attempt to kick user from Telegram group if they have a telegram_user_id
        let kickResult = { success: false };
        if (sub.telegram_user_id) {
          logger.info(`Attempting to kick Telegram user ${sub.telegram_user_id} from product ${sub.productId._id || sub.productId}`);
          
          kickResult = await TelegramService.kickUser(sub.user._id || sub.user, sub.productId._id || sub.productId);
          
          if (kickResult.success) {
            kickSuccessCount++;
            logger.info(`Kicked Telegram user ${sub.telegram_user_id} from product ${sub.productId._id || sub.productId}`);
          } else {
            logger.warn(`Failed to kick Telegram user ${sub.telegram_user_id}: ${kickResult.error}`);
            
            // Send admin notification for Telegram kick failure
            await sendAdminNotification(
              'Telegram Kick Failed',
              `Failed to kick user from Telegram group for subscription ${sub._id}`,
              {
                subscriptionId: sub._id,
                userEmail,
                telegramUserId: sub.telegram_user_id,
                productId: sub.productId._id || sub.productId,
                productName,
                error: kickResult.error
              }
            );
          }
        }
        
        // Update subscription status
        try {
          // Set telegram_kicked based on success of the cancel operation
          const wasKicked = cancelResult.success || kickResult.success;
          
          // Use direct MongoDB update instead of Mongoose document save
          const updateResult = await Subscription.updateOne(
            { _id: sub._id },
            { 
              status: 'expired',
              telegram_kicked: wasKicked, // Only mark as kicked if the operation was successful
              expiredAt: now,
              kickAttemptCount: (sub.kickAttemptCount || 0) + 1,
              lastKickAttempt: now
            }
          );
          
          if (updateResult.modifiedCount > 0) {
            logger.info(`Updated subscription ${sub._id} status to expired and set telegram_kicked flag`, {
              modifiedCount: updateResult.modifiedCount,
              matchedCount: updateResult.matchedCount
            });
          } else {
            logger.warn(`Failed to update subscription ${sub._id} - no documents modified`, {
              modifiedCount: updateResult.modifiedCount,
              matchedCount: updateResult.matchedCount
            });
            
            // Try an alternative approach with findByIdAndUpdate
            const updatedDoc = await Subscription.findByIdAndUpdate(
              sub._id,
              { 
                status: 'expired',
                telegram_kicked: true,
                expiredAt: now
              },
              { new: true } // Return the updated document
            );
            
            if (updatedDoc) {
              logger.info(`Updated subscription ${sub._id} using findByIdAndUpdate`, {
                status: updatedDoc.status,
                telegram_kicked: updatedDoc.telegram_kicked,
                expiredAt: updatedDoc.expiredAt
              });
            } else {
              logger.error(`Failed to update subscription ${sub._id} using findByIdAndUpdate`);
            }
          }
        } catch (saveError) {
          logger.error(`Error updating subscription ${sub._id}:`, {
            error: saveError.message,
            stack: saveError.stack
          });
          
          // If it's a validation error, try to fix known issues and update again
          if (saveError.name === 'ValidationError') {
            try {
              // Fix category if it's invalid
              let updateData = { 
                status: 'expired',
                telegram_kicked: true,
                expiredAt: now
              };
              
              if (saveError.errors?.category) {
                logger.warn(`Invalid category found: ${sub.category}, fixing to 'premium'`);
                updateData.category = 'premium';
              }
              
              // Fix any other validation errors here
              
              // Try updating again with fixed data
              const fixResult = await Subscription.updateOne(
                { _id: sub._id },
                updateData
              );
              
              logger.info(`Fixed validation errors and updated subscription ${sub._id}`, {
                modifiedCount: fixResult.modifiedCount,
                matchedCount: fixResult.matchedCount
              });
            } catch (fixError) {
              logger.error(`Failed to fix validation errors for subscription ${sub._id}:`, {
                error: fixError.message,
                stack: fixError.stack
              });
            }
          }
        }
        
        processedCount++;
        
        // Send expiration notification
        if (sub.productId) {
          await sendExpirationEmail(sub.user, sub, sub.productId);
        }
        
      } catch (error) {
        logger.error(`Error processing subscription ${sub._id}:`, {
          error: error.message,
          stack: error.stack
        });
        
        // Send admin notification for processing error
        await sendAdminNotification(
          'Subscription Processing Error',
          `Error processing expired subscription ${sub._id}`,
          {
            subscriptionId: sub._id,
            error: error.message,
            stack: error.stack
          }
        );
      }
    }
    
    logger.info(`Expired subscription processing complete. Processed: ${processedCount}, Cancelled: ${cancelSuccessCount}, Kicked: ${kickSuccessCount}`);
    
    return {
      success: true,
      processedCount,
      cancelSuccessCount,
      kickSuccessCount
    };
    
  } catch (error) {
    logger.error('Error in processExpiredSubscriptions:', {
      error: error.message,
      stack: error.stack
    });
    
    // Send admin notification for function-level error
    await sendAdminNotification(
      'processExpiredSubscriptions Function Error',
      'Critical error in processExpiredSubscriptions function',
      {
        error: error.message,
        stack: error.stack
      }
    );
    
    return { success: false, error: error.message };
  }
}

async function sendExpirationEmail(userId, subscription, portfolio) {
  try {
    const user = await User.findById(userId);
    if (!user) return;
    
    const subject = `Subscription Expired - ${portfolio.name}`;
    const text = `Your subscription to ${portfolio.name} has expired.`;
    const html = `
      <div style="max-width:600px; margin:0 auto; padding:20px; font-family:sans-serif;">
        <h2 style="color:#e67e22;">Subscription Expired</h2>
        <p>Dear ${user.fullName || user.username},</p>
        <p>Your subscription to <strong>${portfolio.name}</strong> expired on ${subscription.expiresAt.toLocaleDateString()}.</p>
        
        <div style="background-color:#f8f9fa; padding:15px; border-radius:5px; margin:20px 0;">
          <h3 style="color:#e67e22; margin-top:0;">Details:</h3>
          <p><strong>Portfolio:</strong> ${portfolio.name}</p>
          <p><strong>Expiration Date:</strong> ${subscription.expiresAt.toLocaleDateString()}</p>
          ${subscription.type === 'recurring' ? 
            `<p><strong>Note:</strong> Your recurring payments have been stopped.</p>` : ''}
        </div>
        
        <p>To continue your access, please renew your subscription:</p>
        <p style="margin:25px 0;">
          <a href="${process.env.FRONTEND_URL}/subscribe/${portfolio._id}" 
             style="background-color:#2e86c1; color:white; padding:12px 24px; text-decoration:none; border-radius:4px;">
            Renew Subscription
          </a>
        </p>
        
        <hr style="margin:30px 0; border:none; border-top:1px solid #eee;">
        <p style="color:#666; font-size:12px;">This is an automated notification.</p>
      </div>
    `;
    
    await sendEmail(user.email, subject, text, html);
    logger.info(`Expiration email sent to ${user.email}`);
  } catch (error) {
    logger.error('Failed to send expiration email', {
      userId,
      error: error.message
    });
  }
}

// Main cleanup function for expired and unpaid subscriptions
const cleanupExpiredSubscriptions = async () => {
  try {
    const now = new Date();
    logger.info("Starting subscription cleanup job", { timestamp: now });

    // Process expired subscriptions
    const expirationResult = await processExpiredSubscriptions();

    // Step 1: Mark expired one-time subscriptions as expired
    const expiredOneTimeResult = await Subscription.updateMany(
      {
        status: "active",
        type: "one_time",
        expiresAt: { $lt: now }
      },
      { 
        status: "expired",
        updatedAt: now
      }
    );
    logger.info(`Expired ${expiredOneTimeResult.modifiedCount} one-time subscriptions`);

    // Step 2: Cancel stalled recurring subscriptions
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    const stalledRecurringSubscriptions = await Subscription.find({
      status: "active",
      type: "recurring",
      $or: [
        { lastPaymentAt: { $lt: thirtyDaysAgo } },
        { lastPaymentAt: { $exists: false } },
        {
          createdAt: { $lt: thirtyDaysAgo },
          lastPaymentAt: { $exists: false }
        }
      ]
    }).populate({
      path: 'productId',
      refPath: 'productType'
    }).populate('user');
    
    let cancelledRecurringCount = 0;
    const cancelledUserIds = new Set();
    
    for (const subscription of stalledRecurringSubscriptions) {
      try {
        // Get product name and user email for API call
        let productName = 'Unknown Product';
        if (subscription.productType === 'Portfolio' && subscription.productId && subscription.productId.name) {
          productName = subscription.productId.name;
        } else if (subscription.productType === 'Bundle' && subscription.productId && subscription.productId.name) {
          productName = subscription.productId.name;
        }
        
        const userEmail = subscription.user && subscription.user.email ? subscription.user.email : null;
        
        // Call subscription cancellation API
        if (userEmail && subscription.productId) {
          const cancelResult = await TelegramService.cancelSubscription(
            userEmail,
            subscription.productId._id || subscription.productId,
            productName,
            subscription.expiresAt
          );
          
          if (!cancelResult.success) {
            logger.warn(`Failed to cancel stalled recurring subscription via API for ${userEmail}: ${cancelResult.error}`);
            await sendAdminNotification(
              'Stalled Recurring Subscription Cancellation API Failed',
              `Failed to cancel stalled recurring subscription via DELETE API for user ${userEmail}, product: ${productName}`,
              {
                subscriptionId: subscription._id,
                stalledReason: 'No payment for 30+ days in cleanup',
                userEmail,
                productId: subscription.productId._id || subscription.productId,
                productName,
                lastPaymentAt: subscription.lastPaymentAt,
                error: cancelResult.error
              }
            );
          } else {
            logger.info(`Successfully cancelled stalled recurring subscription via API for ${userEmail}, product: ${productName}`);
          }
        }
        
        await Subscription.updateOne(
          { _id: subscription._id },
          { 
            status: "cancelled",
            updatedAt: now,
            cancellationReason: "Payment failure - auto-cancelled after 30 days of no payment"
          }
        );
        cancelledRecurringCount++;
        cancelledUserIds.add(subscription.user.toString());
        logger.info(`Cancelled stalled recurring subscription: ${subscription._id} for user: ${subscription.user}`);
      } catch (error) {
        logger.error(`Error cancelling subscription ${subscription._id}:`, error);
        
        // Send admin notification for cancellation error
        await sendAdminNotification(
          'Stalled Subscription Cancellation Error',
          `Error cancelling stalled recurring subscription ${subscription._id}`,
          {
            subscriptionId: subscription._id,
            error: error.message,
            stack: error.stack
          }
        );
      }
    }
    logger.info(`Cancelled ${cancelledRecurringCount} stalled recurring subscriptions`);

    // Step 3: Handle pending subscriptions that are too old (7+ days)
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    const oldPendingResult = await Subscription.updateMany(
      {
        status: "pending",
        createdAt: { $lt: sevenDaysAgo }
      },
      {
        status: "expired",
        updatedAt: now,
        cancellationReason: "Pending payment timeout - expired after 7 days"
      }
    );
    logger.info(`Expired ${oldPendingResult.modifiedCount} old pending subscriptions`);

    // Step 4: Clean up very old expired/cancelled subscriptions (6+ months)
    const sixMonthsAgo = new Date(now.getTime() - (6 * 30 * 24 * 60 * 60 * 1000));
    const deletedOldResult = await Subscription.deleteMany({
      status: { $in: ["expired", "cancelled"] },
      updatedAt: { $lt: sixMonthsAgo }
    });
    logger.info(`Deleted ${deletedOldResult.deletedCount} old expired/cancelled subscriptions`);

    // Step 5: Clean up old payment history records (1+ year)
    const oneYearAgo = new Date(now.getTime() - (365 * 24 * 60 * 60 * 1000));
    const deletedPaymentHistoryResult = await PaymentHistory.deleteMany({
      createdAt: { $lt: oneYearAgo },
      status: { $in: ["failed", "expired"] }
    });
    logger.info(`Deleted ${deletedPaymentHistoryResult.deletedCount} old payment history records`);

    // Step 6: Generate summary statistics
    const totalActiveSubscriptions = await Subscription.countDocuments({ status: "active" });
    const totalExpiredSubscriptions = await Subscription.countDocuments({ status: "expired" });
    const totalCancelledSubscriptions = await Subscription.countDocuments({ status: "cancelled" });
    const totalPendingSubscriptions = await Subscription.countDocuments({ status: "pending" });
    const executionTime = Date.now() - now.getTime();
    logger.info("Subscription cleanup completed", {
      summary: {
        expiredOneTime: expiredOneTimeResult.modifiedCount,
        cancelledRecurring: cancelledRecurringCount,
        expiredPending: oldPendingResult.modifiedCount,
        deletedOld: deletedOldResult.deletedCount,
        deletedPaymentHistory: deletedPaymentHistoryResult.deletedCount,
        affectedUsers: cancelledUserIds.size,
        cancelApiSuccessCount: expirationResult.cancelSuccessCount || 0,
        telegramKickSuccessCount: expirationResult.kickSuccessCount || 0,
        executionTimeMs: executionTime
      },
      currentStats: {
        activeSubscriptions: totalActiveSubscriptions,
        expiredSubscriptions: totalExpiredSubscriptions,
        cancelledSubscriptions: totalCancelledSubscriptions,
        pendingSubscriptions: totalPendingSubscriptions
      }
    });
    return {
      success: true,
      stats: {
        expiredOneTime: expiredOneTimeResult.modifiedCount,
        cancelledRecurring: cancelledRecurringCount,
        expiredPending: oldPendingResult.modifiedCount,
        deletedOld: deletedOldResult.deletedCount,
        deletedPaymentHistory: deletedPaymentHistoryResult.deletedCount,
        affectedUsers: cancelledUserIds.size,
        cancelApiSuccessCount: expirationResult.cancelSuccessCount || 0,
        telegramKickSuccessCount: expirationResult.kickSuccessCount || 0,
        currentStats: {
          active: totalActiveSubscriptions,
          expired: totalExpiredSubscriptions,
          cancelled: totalCancelledSubscriptions,
          pending: totalPendingSubscriptions
        }
      }
    };
  } catch (error) {
    logger.error("Subscription cleanup job failed", {
      error: error.message,
      stack: error.stack
    });
    
    // Send admin notification for cleanup job failure
    await sendAdminNotification(
      'Subscription Cleanup Job Failed',
      'Critical error in main subscription cleanup function',
      {
        error: error.message,
        stack: error.stack
      }
    );
    
    return {
      success: false,
      error: error.message
    };
  }
};

// Handle Razorpay subscription cancellation for recurring subscriptions
const cancelRazorpaySubscriptions = async (subscriptionIds) => {
  if (!subscriptionIds.length) return;
  try {
    const razorpay = await getRazorpayInstance();
    for (const subscriptionId of subscriptionIds) {
      try {
        await razorpay.subscriptions.cancel(subscriptionId, {
          cancel_at_cycle_end: false,
        });
        logger.info(`Cancelled Razorpay subscription: ${subscriptionId}`);
      } catch (error) {
        logger.error(`Failed to cancel Razorpay subscription ${subscriptionId}:`, error);
      }
    }
  } catch (error) {
    logger.error("Error cancelling Razorpay subscriptions:", error);
  }
};

// Enhanced cleanup with Razorpay integration
const enhancedCleanupExpiredSubscriptions = async () => {
  try {
    const cleanupResult = await cleanupExpiredSubscriptions();
    if (cleanupResult.success) {
      // Get Razorpay subscription IDs that need to be cancelled
      const razorpaySubscriptionIds = await Subscription.distinct('razorpaySubscriptionId', {
        status: "cancelled",
        razorpaySubscriptionId: { $exists: true, $ne: null },
        updatedAt: { $gte: new Date(Date.now() - 60000) } // Last minute
      });
      if (razorpaySubscriptionIds.length > 0) {
        await cancelRazorpaySubscriptions(razorpaySubscriptionIds);
      }
    }
    return cleanupResult;
  } catch (error) {
    logger.error("Enhanced cleanup failed", error);
    return { success: false, error: error.message };
  }
};

// Schedule the cron job to run every 5 hours
const startSubscriptionCleanupJob = () => {
  // Run every 5 hours
  cron.schedule("0 */5 * * *", async () => {
    logger.info("Subscription cleanup cron job triggered");
    await enhancedCleanupExpiredSubscriptions();
    logger.info("Subscription cleanup cron job completed");
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });
  
  // Daily summary report at 6 AM
  cron.schedule("0 6 * * *", async () => {
    logger.info("Daily subscription summary job triggered");
    try {
      const stats = {
        active: await Subscription.countDocuments({ status: "active" }),
        expired: await Subscription.countDocuments({ status: "expired" }),
        cancelled: await Subscription.countDocuments({ status: "cancelled" }),
        pending: await Subscription.countDocuments({ status: "pending" }),
        totalUsers: await Subscription.distinct('user', { status: "active" }).then(users => users.length),
        recurringActive: await Subscription.countDocuments({ status: "active", type: "recurring" }),
        oneTimeActive: await Subscription.countDocuments({ status: "active", type: "one_time" })
      };
      logger.info("Daily subscription summary", { dailySummary: stats });
    } catch (error) {
      logger.error("Daily summary failed", error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });
  
  logger.info("Subscription cleanup cron jobs scheduled");
  logger.info("Starting recurring payment check job every hour");
  checkRecurringPaymentsJob.start();
  logger.info("Recurring payment check job started");
};

//testing call all functions
startSubscriptionCleanupJob();
cleanupExpiredSubscriptions();

/**
 * Force processing of expired subscriptions manually
 * This function allows administrators to immediately process expired subscriptions
 * without waiting for the scheduled cron job
 * @returns {Promise<Object>} Result with success status
 */
async function forceProcessExpiredSubscriptions() {
  logger.info('Manually triggering expired subscription processing');
  try {
    await processExpiredSubscriptions();
    logger.info('Manual expired subscription processing completed');
    return { 
      success: true, 
      message: 'Expired subscription processing completed', 
      timestamp: new Date().toISOString() 
    };
  } catch (error) {
    logger.error('Manual expired subscription processing failed', { 
      error: error.message,
      stack: error.stack
    });
    // Return information about the error but still resolve the promise
    return { 
      success: false, 
      error: error.message,
      message: 'Expired subscription processing failed but was logged',
      timestamp: new Date().toISOString()
    };
  }
}

// Export functions
module.exports = {
  startSubscriptionCleanupJob,
  cleanupExpiredSubscriptions,
  enhancedCleanupExpiredSubscriptions,
  processExpiredSubscriptions,
  forceProcessExpiredSubscriptions
};