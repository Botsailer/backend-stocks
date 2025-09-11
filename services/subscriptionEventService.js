/**
 * Subscription Event Service
 * Handles real-time subscription events and immediate Telegram kicks
 */
const EventEmitter = require('events');
const Subscription = require('../models/subscription');
const User = require('../models/user');
const TelegramService = require('./tgservice');
const winston = require('winston');

// Configure logger
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
      filename: "logs/subscription-events.log",
      maxsize: 5 * 1024 * 1024,
      maxFiles: 7
    })
  ]
});

class SubscriptionEventService extends EventEmitter {
  constructor() {
    super();
    this.setupEventHandlers();
    this.isProcessing = new Set(); // Prevent duplicate processing
  }

  setupEventHandlers() {
    // Handle subscription expiration
    this.on('subscription:expired', this.handleSubscriptionExpired.bind(this));
    
    // Handle subscription cancellation
    this.on('subscription:cancelled', this.handleSubscriptionCancelled.bind(this));
    
    // Handle subscription activation (for renewed subscriptions)
    this.on('subscription:activated', this.handleSubscriptionActivated.bind(this));
  }

  /**
   * Emit subscription expiration event
   * @param {Object} subscription - The expired subscription
   */
  emitSubscriptionExpired(subscription) {
    const eventKey = `expired:${subscription._id}`;
    
    if (this.isProcessing.has(eventKey)) {
      logger.warn(`Already processing expiration for subscription ${subscription._id}`);
      return;
    }

    logger.info(`Emitting subscription expired event for ${subscription._id}`);
    this.emit('subscription:expired', subscription);
  }

  /**
   * Emit subscription cancellation event
   * @param {Object} subscription - The cancelled subscription
   */
  emitSubscriptionCancelled(subscription) {
    const eventKey = `cancelled:${subscription._id}`;
    
    if (this.isProcessing.has(eventKey)) {
      logger.warn(`Already processing cancellation for subscription ${subscription._id}`);
      return;
    }

    logger.info(`Emitting subscription cancelled event for ${subscription._id}`);
    this.emit('subscription:cancelled', subscription);
  }

  /**
   * Emit subscription activation event
   * @param {Object} subscription - The activated subscription
   */
  emitSubscriptionActivated(subscription) {
    logger.info(`Emitting subscription activated event for ${subscription._id}`);
    this.emit('subscription:activated', subscription);
  }

  /**
   * Handle subscription expiration
   * @param {Object} subscription - The expired subscription
   */
  async handleSubscriptionExpired(subscription) {
    const eventKey = `expired:${subscription._id}`;
    this.isProcessing.add(eventKey);

    try {
      logger.info(`Processing expired subscription ${subscription._id}`);

      // Update subscription status to expired
      await Subscription.findByIdAndUpdate(subscription._id, {
        status: 'expired',
        expiredAt: new Date()
      });

      // Kick user from Telegram if they have telegram integration
      if (subscription.invite_link_url || subscription.telegram_user_id) {
        await this.processTelegramKick(subscription);
      }

      // Update user premium status
      await this.updateUserPremiumStatus(subscription.user);

      logger.info(`Successfully processed expired subscription ${subscription._id}`);

    } catch (error) {
      logger.error(`Error processing expired subscription ${subscription._id}:`, {
        error: error.message,
        stack: error.stack
      });
    } finally {
      this.isProcessing.delete(eventKey);
    }
  }

  /**
   * Handle subscription cancellation
   * @param {Object} subscription - The cancelled subscription
   */
  async handleSubscriptionCancelled(subscription) {
    const eventKey = `cancelled:${subscription._id}`;
    this.isProcessing.add(eventKey);

    try {
      logger.info(`Processing cancelled subscription ${subscription._id}`);

      // Update subscription status to cancelled
      await Subscription.findByIdAndUpdate(subscription._id, {
        status: 'cancelled',
        cancelledAt: new Date()
      });

      // Immediately kick user from Telegram
      if (subscription.invite_link_url || subscription.telegram_user_id) {
        await this.processeTelegramKick(subscription);
      }

      // Update user premium status
      await this.updateUserPremiumStatus(subscription.user);

      logger.info(`Successfully processed cancelled subscription ${subscription._id}`);

    } catch (error) {
      logger.error(`Error processing cancelled subscription ${subscription._id}:`, {
        error: error.message,
        stack: error.stack
      });
    } finally {
      this.isProcessing.delete(eventKey);
    }
  }

  /**
   * Handle subscription activation
   * @param {Object} subscription - The activated subscription
   */
  async handleSubscriptionActivated(subscription) {
    try {
      logger.info(`Processing activated subscription ${subscription._id}`);

      // Update user premium status
      await this.updateUserPremiumStatus(subscription.user);

      logger.info(`Successfully processed activated subscription ${subscription._id}`);

    } catch (error) {
      logger.error(`Error processing activated subscription ${subscription._id}:`, {
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * Process Telegram kick for expired/cancelled subscription
   * @param {Object} subscription - The subscription to process
   */
  async processTelegramKick(subscription) {
    try {
      // Get user details
      const user = await User.findById(subscription.user);
      if (!user || !user.email) {
        logger.warn(`Cannot kick user: Missing user or email for subscription ${subscription._id}`);
        return;
      }

      // Get product details for external ID
      let product;
      if (subscription.productType === 'Portfolio') {
        const Portfolio = require('../models/modelPortFolio');
        product = await Portfolio.findById(subscription.productId);
      } else if (subscription.productType === 'Bundle') {
        const Bundle = require('../models/bundle');
        product = await Bundle.findById(subscription.productId);
      }

      if (!product || !product.externalId) {
        logger.warn(`Cannot kick user: Missing product or externalId for subscription ${subscription._id}`);
        return;
      }

      // Attempt to cancel Telegram subscription
      const result = await TelegramService.cancelSubscriptionByEmail(user.email, product.externalId);

      if (result.success) {
        // Update subscription with successful kick
        await Subscription.findByIdAndUpdate(subscription._id, {
          telegram_kicked: true,
          lastKickAttempt: new Date(),
          kickAttemptCount: (subscription.kickAttemptCount || 0) + 1
        });

        logger.info(`Successfully kicked user from Telegram for subscription ${subscription._id}`);
      } else {
        // Update subscription with failed kick attempt
        await Subscription.findByIdAndUpdate(subscription._id, {
          telegram_kicked: false,
          lastKickAttempt: new Date(),
          kickAttemptCount: (subscription.kickAttemptCount || 0) + 1
        });

        logger.error(`Failed to kick user from Telegram for subscription ${subscription._id}:`, result.error);
      }

    } catch (error) {
      logger.error(`Error in processTelegramKick for subscription ${subscription._id}:`, {
        error: error.message,
        stack: error.stack
      });

      // Update subscription with error
      await Subscription.findByIdAndUpdate(subscription._id, {
        telegram_kicked: false,
        lastKickAttempt: new Date(),
        kickAttemptCount: (subscription.kickAttemptCount || 0) + 1
      });
    }
  }

  /**
   * Update user premium status based on active subscriptions
   * @param {String} userId - The user ID
   */
  async updateUserPremiumStatus(userId) {
    try {
      const now = new Date();
      const hasPremiumSubscription = await Subscription.exists({
        user: userId,
        status: "active",
        category: { $regex: /^premium$/i },
        expiresAt: { $gt: now }
      });

      await User.findByIdAndUpdate(userId, { 
        hasPremium: !!hasPremiumSubscription 
      });

      logger.info(`Updated user ${userId} premium status to: ${!!hasPremiumSubscription}`);
      
      return !!hasPremiumSubscription;
    } catch (error) {
      logger.error(`Error updating premium status for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Check for subscriptions that should be expired immediately
   * This can be called periodically or triggered by webhooks
   */
  async checkExpiredSubscriptions() {
    try {
      const now = new Date();
      
      // Find subscriptions that are active but past their expiration date
      const expiredSubs = await Subscription.find({
        status: 'active',
        expiresAt: { $lt: now }
      }).populate('user');

      logger.info(`Found ${expiredSubs.length} subscriptions that should be expired immediately`);

      for (const subscription of expiredSubs) {
        this.emitSubscriptionExpired(subscription);
      }

      return expiredSubs.length;
    } catch (error) {
      logger.error('Error checking expired subscriptions:', error);
      return 0;
    }
  }
}

// Create singleton instance
const subscriptionEventService = new SubscriptionEventService();

module.exports = subscriptionEventService;
