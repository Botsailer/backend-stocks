/**
 * Internal Webhook Routes for Subscription Management
 * Provides endpoints for triggering subscription events
 */
const express = require('express');
const router = express.Router();
const { handleSubscriptionExpirationWebhook } = require('../middleware/subscriptionValidator');
const subscriptionEventService = require('../services/subscriptionEventService');
const Subscription = require('../models/subscription');
const requireAdmin = require('../middleware/requirreAdmin');
const passport = require('passport');

// Authentication middleware for internal webhooks
const requireAuth = passport.authenticate('jwt', { session: false });

/**
 * @swagger
 * /api/internal/webhooks/subscription/expire:
 *   post:
 *     summary: Trigger subscription expiration processing
 *     tags: [Internal Webhooks]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               subscriptionId:
 *                 type: string
 *                 description: Specific subscription ID to process
 *               userId:
 *                 type: string
 *                 description: Process all subscriptions for a specific user
 *               force:
 *                 type: boolean
 *                 description: Force expiration even if not technically expired
 *                 default: false
 *     responses:
 *       200:
 *         description: Expiration processing triggered
 *       404:
 *         description: Subscription not found
 *       500:
 *         description: Server error
 */
router.post('/expire', requireAuth, requireAdmin, handleSubscriptionExpirationWebhook);

/**
 * @swagger
 * /api/internal/webhooks/subscription/check-expired:
 *   post:
 *     summary: Check and process all expired subscriptions immediately
 *     tags: [Internal Webhooks]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Expired subscriptions processed
 */
router.post('/check-expired', requireAuth, requireAdmin, async (req, res) => {
  try {
    const expiredCount = await subscriptionEventService.checkExpiredSubscriptions();
    
    res.json({
      success: true,
      message: `Processed ${expiredCount} expired subscriptions`,
      expiredCount
    });
  } catch (error) {
    console.error('Error in check-expired webhook:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check expired subscriptions'
    });
  }
});

/**
 * @swagger
 * /api/internal/webhooks/subscription/cancel:
 *   post:
 *     summary: Trigger subscription cancellation processing
 *     tags: [Internal Webhooks]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - subscriptionId
 *             properties:
 *               subscriptionId:
 *                 type: string
 *                 description: Subscription ID to cancel
 *     responses:
 *       200:
 *         description: Cancellation processing triggered
 *       404:
 *         description: Subscription not found
 *       500:
 *         description: Server error
 */
router.post('/cancel', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { subscriptionId } = req.body;

    if (!subscriptionId) {
      return res.status(400).json({
        success: false,
        error: 'subscriptionId is required'
      });
    }

    const subscription = await Subscription.findById(subscriptionId);
    
    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: 'Subscription not found'
      });
    }

    // Emit cancellation event
    subscriptionEventService.emitSubscriptionCancelled(subscription);

    res.json({
      success: true,
      message: 'Subscription cancellation event triggered',
      subscriptionId: subscription._id
    });

  } catch (error) {
    console.error('Error in cancel webhook:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger cancellation'
    });
  }
});

/**
 * @swagger
 * /api/internal/webhooks/subscription/activate:
 *   post:
 *     summary: Trigger subscription activation processing
 *     tags: [Internal Webhooks]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - subscriptionId
 *             properties:
 *               subscriptionId:
 *                 type: string
 *                 description: Subscription ID to activate
 *     responses:
 *       200:
 *         description: Activation processing triggered
 *       404:
 *         description: Subscription not found
 *       500:
 *         description: Server error
 */
router.post('/activate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { subscriptionId } = req.body;

    if (!subscriptionId) {
      return res.status(400).json({
        success: false,
        error: 'subscriptionId is required'
      });
    }

    const subscription = await Subscription.findById(subscriptionId);
    
    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: 'Subscription not found'
      });
    }

    // Emit activation event
    subscriptionEventService.emitSubscriptionActivated(subscription);

    res.json({
      success: true,
      message: 'Subscription activation event triggered',
      subscriptionId: subscription._id
    });

  } catch (error) {
    console.error('Error in activate webhook:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger activation'
    });
  }
});

/**
 * @swagger
 * /api/internal/webhooks/subscription/status:
 *   get:
 *     summary: Get subscription event service status
 *     tags: [Internal Webhooks]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Service status
 */
router.get('/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    
    // Get counts of different subscription statuses
    const [activeCount, expiredCount, cancelledCount, pendingCount] = await Promise.all([
      Subscription.countDocuments({ status: 'active', expiresAt: { $gt: now } }),
      Subscription.countDocuments({ status: 'expired' }),
      Subscription.countDocuments({ status: 'cancelled' }),
      Subscription.countDocuments({ status: 'pending' })
    ]);

    // Check for active subscriptions that are past expiration
    const expiredActiveCount = await Subscription.countDocuments({ 
      status: 'active', 
      expiresAt: { $lt: now } 
    });

    res.json({
      success: true,
      status: {
        service: 'running',
        timestamp: now.toISOString(),
        subscriptions: {
          active: activeCount,
          expired: expiredCount,
          cancelled: cancelledCount,
          pending: pendingCount,
          expiredButActive: expiredActiveCount
        }
      }
    });

  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get status'
    });
  }
});

module.exports = router;
