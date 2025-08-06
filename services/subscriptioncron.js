const cron = require("node-cron");
const mongoose = require("mongoose");
const Subscription = require("../models/subscription");
const PaymentHistory = require("../models/paymenthistory");
const winston = require("winston");

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



// Main cleanup function for expired and unpaid subscriptions
const cleanupExpiredSubscriptions = async () => {
  try {
    const now = new Date();
    logger.info("Starting subscription cleanup job", { timestamp: now });

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

    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    

const checkRecurringPaymentsJob = cron.schedule("0 * * * *", async () => {
  const now = new Date();
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
      }
      // Check if last payment was more than 30 days ago
      if (!sub.lastPaymentAt || new Date(sub.lastPaymentAt) < thirtyDaysAgo) {
        // If last payment is more than 30 days ago, cancel the subscription
        await Subscription.updateOne(
          { _id: sub._id },
          { status: "cancelled", updatedAt: now, cancellationReason: "Payment failure - auto-cancelled after 30 days of no payment" }
        );
        logger.info(`Cancelled stalled recurring subscription: ${sub._id} for user: ${sub.user}`);
      }
      // If the subscription is active but last payment is more than 30 days ago, cancel
      if (rSub.status === "active" && sub.lastPaymentAt && new Date(sub.lastPaymentAt) < thirtyDaysAgo) {
        await Subscription.updateOne(
          { _id: sub._id },
          { status: "cancelled", updatedAt: now, cancellationReason: "Payment failure - auto-cancelled after 30 days of no payment" }
        );
        logger.info(`Cancelled stalled recurring subscription: ${sub._id} for user: ${sub.user}`);
      }
    } catch (err) {
      logger.error(`Error checking subscription ${sub._id}:`, err);
    }
  }
  logger.info("Recurring payment check completed");
}, { timezone: "Asia/Kolkata" });
    

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

    // Summary log
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
    const { getRazorpayInstance } = require("../controllers/subscriptionController");
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
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });

  // Also schedule a daily summary report at 6 AM
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

  logger.info("Subscription cleanup cron jobs scheduled:");
  logger.info("- Cleanup job: Every 5 hours (0 */5 * * *)");
  logger.info("- Daily summary: 6:00 AM daily (0 6 * * *)");
};

// Export functions for manual execution and testing
module.exports = {
  startSubscriptionCleanupJob,
  cleanupExpiredSubscriptions,
  enhancedCleanupExpiredSubscriptions
};
