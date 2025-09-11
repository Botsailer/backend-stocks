/**
 * Subscription Validation Middleware
 * Checks subscription validity on API requests and triggers expiration events
 */
const Subscription = require('../models/subscription');
const subscriptionEventService = require('../services/subscriptionEventService');
const winston = require('winston');

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "logs/subscription-middleware.log" })
  ]
});

/**
 * Middleware to validate user subscriptions on API requests
 * This ensures expired subscriptions are immediately processed
 */
const validateSubscriptions = async (req, res, next) => {
  try {
    // Only check for authenticated requests
    if (!req.user || !req.user._id) {
      return next();
    }

    const userId = req.user._id;
    const now = new Date();

    // Find any active subscriptions that are actually expired
    const expiredActiveSubscriptions = await Subscription.find({
      user: userId,
      status: 'active',
      expiresAt: { $lt: now }
    });

    // Process expired subscriptions immediately
    if (expiredActiveSubscriptions.length > 0) {
      logger.info(`Found ${expiredActiveSubscriptions.length} expired active subscriptions for user ${userId}`);
      
      for (const subscription of expiredActiveSubscriptions) {
        // Emit expiration event for immediate processing
        subscriptionEventService.emitSubscriptionExpired(subscription);
      }
    }

    next();
  } catch (error) {
    logger.error('Error in subscription validation middleware:', error);
    // Don't block the request, just log the error
    next();
  }
};

/**
 * Middleware specifically for subscription-related endpoints
 * Provides more thorough checking
 */
const validateSubscriptionAccess = async (req, res, next) => {
  try {
    if (!req.user || !req.user._id) {
      return next();
    }

    const userId = req.user._id;
    const now = new Date();

    // Check for expired subscriptions
    const expiredSubs = await Subscription.find({
      user: userId,
      status: 'active',
      expiresAt: { $lt: now }
    });

    // Process expired subscriptions
    for (const subscription of expiredSubs) {
      subscriptionEventService.emitSubscriptionExpired(subscription);
    }

    // Also check for subscriptions expiring in the next hour
    const soonToExpire = new Date(now.getTime() + (60 * 60 * 1000)); // 1 hour from now
    const expiringSubs = await Subscription.find({
      user: userId,
      status: 'active',
      expiresAt: { $gt: now, $lt: soonToExpire }
    });

    if (expiringSubs.length > 0) {
      logger.info(`User ${userId} has ${expiringSubs.length} subscriptions expiring within 1 hour`);
    }

    next();
  } catch (error) {
    logger.error('Error in subscription access validation:', error);
    next();
  }
};

/**
 * Express route handler for webhook-style subscription expiration checks
 * This can be called by external services or scheduled tasks
 */
const handleSubscriptionExpirationWebhook = async (req, res) => {
  try {
    const { subscriptionId, userId, force = false } = req.body;

    if (subscriptionId) {
      // Check specific subscription
      const subscription = await Subscription.findById(subscriptionId);
      
      if (!subscription) {
        return res.status(404).json({ 
          success: false, 
          error: 'Subscription not found' 
        });
      }

      const now = new Date();
      if (subscription.status === 'active' && (subscription.expiresAt < now || force)) {
        subscriptionEventService.emitSubscriptionExpired(subscription);
        
        return res.json({ 
          success: true, 
          message: 'Subscription expiration event triggered',
          subscriptionId: subscription._id
        });
      } else {
        return res.json({ 
          success: false, 
          message: 'Subscription is not expired or already processed',
          subscriptionId: subscription._id,
          status: subscription.status,
          expiresAt: subscription.expiresAt
        });
      }
    }

    if (userId) {
      // Check all subscriptions for a user
      const expiredCount = await subscriptionEventService.checkExpiredSubscriptions();
      
      return res.json({ 
        success: true, 
        message: `Checked expired subscriptions for user`,
        expiredCount
      });
    }

    // Check all expired subscriptions system-wide
    const expiredCount = await subscriptionEventService.checkExpiredSubscriptions();
    
    res.json({ 
      success: true, 
      message: 'System-wide subscription expiration check completed',
      expiredCount
    });

  } catch (error) {
    logger.error('Error in subscription expiration webhook:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
};

module.exports = {
  validateSubscriptions,
  validateSubscriptionAccess,
  handleSubscriptionExpirationWebhook
};
