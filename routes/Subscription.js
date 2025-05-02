/**
 * routes/subscription.js
 * ---
 * API routes for subscription management and Razorpay payment integration.
 */
const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');
const requireAuth = require('../middleware/requireAuth');

/**
 * @swagger
 * tags:
 *   name: Subscriptions
 *   description: Endpoints for managing subscriptions and Razorpay payments
 */

/**
 * @swagger
 * /api/subscriptions/order:
 *   post:
 *     summary: Initiate a Razorpay payment order for monthly subscription
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [portfolioId]
 *             properties:
 *               portfolioId:
 *                 type: string
 *                 description: MongoDB ObjectId of the target portfolio
 *     responses:
 *       200:
 *         description: Razorpay order successfully created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orderId:
 *                   type: string
 *                 amount:
 *                   type: number
 *                 currency:
 *                   type: string
 */
router.post('/order', requireAuth, subscriptionController.createOrder);

/**
 * @swagger
 * /api/subscriptions/verify:
 *   post:
 *     summary: Verify Razorpay payment signature and activate subscription
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, paymentId, signature]
 *             properties:
 *               orderId:
 *                 type: string
 *               paymentId:
 *                 type: string
 *               signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment verified and subscription activated
 *       400:
 *         description: Invalid signature or payment verification failure
 */
router.post('/verify', requireAuth, subscriptionController.verifyPayment);

/**
 * @swagger
 * /api/subscriptions/history:
 *   get:
 *     summary: Retrieve current user's complete payment history
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of payment history entries
 */
router.get('/history', requireAuth, subscriptionController.getHistory);

module.exports = router;


