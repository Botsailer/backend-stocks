const cron = require("node-cron");
const mongoose = require("mongoose");
const Subscription = require("../models/subscription");
const PaymentHistory = require("../models/paymenthistory");
const winston = require("winston");
const { getRazorpayInstance } = require("../utils/configSettings");
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
  });
  const razorpay = await getRazorpayInstance();
  for (const sub of subscriptions) {
    try {
      const rSub = await razorpay.subscriptions.fetch(sub.razorpaySubscriptionId);
      if (["halted", "cancelled", "expired"].includes(rSub.status)) {
        await Subscription.updateOne(
          { _id: sub._id },
          { status: "cancelled", cancelledAt: now, cancelReason: "Payment failed or mandate cancelled" }
        );
        await updateUserPremiumStatus(sub.user);
        logger.info(`Cancelled recurring subscription (Razorpay status): ${sub._id} for user: ${sub.user}`);
      }
      // If the subscription is active but last payment is more than 30 days ago, cancel
      if (rSub.status === "active" && (!sub.lastPaymentAt || new Date(sub.lastPaymentAt) < thirtyDaysAgo)) {
        await Subscription.updateOne(
          { _id: sub._id },
          { status: "cancelled", updatedAt: now, cancellationReason: "Payment failure - auto-cancelled after 30 days of no payment" }
        );
        await updateUserPremiumStatus(sub.user);
        logger.info(`Cancelled stalled recurring subscription: ${sub._id} for user: ${sub.user}`);
      }
    } catch (err) {
      logger.error(`Error checking subscription ${sub._id}:`, err);
    }
  }
  logger.info("Recurring payment check completed");
}, { timezone: "Asia/Kolkata", scheduled: false });

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
    
    // Find subscriptions that expired but haven't been processed
    const expiredSubs = await Subscription.find({
      status: 'active',
      expiresAt: { $lt: now },
      telegram_kicked: { $ne: true } // Only unprocessed
    }).populate('portfolio');
    
    logger.info(`Found ${expiredSubs.length} expired subscriptions to process`);
    
    let processedCount = 0;
    let kickSuccessCount = 0;
    
    for (const sub of expiredSubs) {
      try {
        // Attempt to kick user from Telegram group
        let kickResult = { success: false };
        
        if (sub.telegram_user_id) {
          kickResult = await TelegramService.kickUser(sub.productId, sub.telegram_user_id);
          
          if (kickResult.success) {
            kickSuccessCount++;
            logger.info(`Kicked Telegram user ${sub.telegram_user_id} from product ${sub.productId}`);
          } else {
            logger.warn(`Failed to kick Telegram user ${sub.telegram_user_id}: ${kickResult.error}`);
          }
        }
        
        // Update subscription status
        sub.status = 'expired';
        sub.telegram_kicked = true;
        sub.expiredAt = now;
        await sub.save();
        
        processedCount++;
        
        // Send expiration notification
        if (sub.portfolio) {
          await sendExpirationEmail(sub.user, sub, sub.portfolio);
        }
        
      } catch (error) {
        logger.error(`Error processing subscription ${sub._id}:`, {
          error: error.message,
          stack: error.stack
        });
      }
    }
    
    logger.info(`Expired subscription processing complete. Processed: ${processedCount}, Kicked: ${kickSuccessCount}`);
    
    return {
      success: true,
      processedCount,
      kickSuccessCount
    };
    
  } catch (error) {
    logger.error('Error in processExpiredSubscriptions:', {
      error: error.message,
      stack: error.stack
    });
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
    });
    let cancelledRecurringCount = 0;
    const cancelledUserIds = new Set();
    for (const subscription of stalledRecurringSubscriptions) {
      try {
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

// Export functions
module.exports = {
  startSubscriptionCleanupJob,
  cleanupExpiredSubscriptions,
  enhancedCleanupExpiredSubscriptions,
  processExpiredSubscriptions
};