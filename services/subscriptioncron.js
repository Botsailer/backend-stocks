const cron = require("node-cron");
const mongoose = require("mongoose");
const Subscription = require("../models/subscription");
const User = require("../models/user");
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

// Update user premium status based on current active subscriptions
const updateUserPremiumStatus = async (userId) => {
  try {
    const now = new Date();
    
    // Check for any active premium subscription (case-insensitive)
    const hasPremiumSubscription = await Subscription.exists({
      user: userId,
      status: "active",
      category: { $regex: /^premium$/i },
      expiresAt: { $gt: now }
    });
    
    // Update user's premium status
    await User.findByIdAndUpdate(
      userId, 
      { hasPremium: !!hasPremiumSubscription },
      { new: true }
    );
    
    logger.info(`Updated user ${userId} hasPremium to: ${!!hasPremiumSubscription}`);
    return !!hasPremiumSubscription;
  } catch (error) {
    logger.error('Error updating premium status:', error);
    return false;
  }
};

// Main cleanup function for expired subscriptions
const cleanupExpiredSubscriptions = async () => {
  try {
    const now = new Date();
    logger.info("Starting subscription cleanup job", { timestamp: now });

    // Step 1: Find and mark expired one-time subscriptions
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

    // Step 2: Find users with failed recurring payments (more than 30 days without payment)
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    
    // Get subscriptions with recurring payments that haven't been charged recently
    const stalledRecurringSubscriptions = await Subscription.find({
      status: "active",
      type: "recurring",
      $or: [
        { lastPaymentAt: { $lt: thirtyDaysAgo } },
        { lastPaymentAt: { $exists: false } },
        // Additional condition for subscriptions that should have been charged but weren't
        {
          createdAt: { $lt: thirtyDaysAgo },
          lastPaymentAt: { $exists: false }
        }
      ]
    });

    let expiredRecurringCount = 0;
    for (const subscription of stalledRecurringSubscriptions) {
      try {
        // Cancel the recurring subscription
        await Subscription.updateOne(
          { _id: subscription._id },
          { 
            status: "cancelled",
            updatedAt: now,
            cancellationReason: "Payment failure - auto-cancelled after 30 days"
          }
        );
        expiredRecurringCount++;
        
        logger.info(`Cancelled stalled recurring subscription: ${subscription._id}`);
      } catch (error) {
        logger.error(`Error cancelling subscription ${subscription._id}:`, error);
      }
    }

    logger.info(`Cancelled ${expiredRecurringCount} stalled recurring subscriptions`);

    // Step 3: Get all affected users for premium status update
    const affectedUserIds = await Subscription.distinct('user', {
      $or: [
        { status: "expired", updatedAt: { $gte: new Date(now.getTime() - 60000) } },
        { status: "cancelled", updatedAt: { $gte: new Date(now.getTime() - 60000) } }
      ]
    });

    // Step 4: Update premium status for all affected users
    let updatedUsersCount = 0;
    for (const userId of affectedUserIds) {
      try {
        await updateUserPremiumStatus(userId);
        updatedUsersCount++;
      } catch (error) {
        logger.error(`Error updating premium status for user ${userId}:`, error);
      }
    }

    // Step 5: Clean up old expired subscriptions (older than 6 months)
    const sixMonthsAgo = new Date(now.getTime() - (6 * 30 * 24 * 60 * 60 * 1000));
    const deletedOldResult = await Subscription.deleteMany({
      status: { $in: ["expired", "cancelled"] },
      updatedAt: { $lt: sixMonthsAgo }
    });

    logger.info(`Deleted ${deletedOldResult.deletedCount} old expired/cancelled subscriptions`);

    // Summary log
    logger.info("Subscription cleanup completed", {
      expiredOneTime: expiredOneTimeResult.modifiedCount,
      cancelledRecurring: expiredRecurringCount,
      updatedUsers: updatedUsersCount,
      deletedOld: deletedOldResult.deletedCount,
      totalAffectedUsers: affectedUserIds.length,
      executionTime: new Date() - now
    });

    return {
      success: true,
      stats: {
        expiredOneTime: expiredOneTimeResult.modifiedCount,
        cancelledRecurring: expiredRecurringCount,
        updatedUsers: updatedUsersCount,
        deletedOld: deletedOldResult.deletedCount,
        totalAffectedUsers: affectedUserIds.length
      }
    };

  } catch (error) {
    logger.error("Subscription cleanup job failed", error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Schedule the cron job to run every 5 hours
// Cron expression: "0 */5 * * *" means at minute 0 past every 5th hour
const startSubscriptionCleanupJob = () => {
  // Run every 5 hours
  cron.schedule("0 */5 * * *", async () => {
    logger.info("Subscription cleanup cron job triggered");
    await cleanupExpiredSubscriptions();
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata" // Adjust timezone as needed
  });

  logger.info("Subscription cleanup cron job scheduled to run every 5 hours");
  
  // Also run immediately on startup (optional)
  // setTimeout(cleanupExpiredSubscriptions, 5000); // Run after 5 seconds
};

// Export functions for manual execution and testing
module.exports = {
  startSubscriptionCleanupJob,
  cleanupExpiredSubscriptions,
  updateUserPremiumStatus
};