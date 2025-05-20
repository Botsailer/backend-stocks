const express = require('express');
const router = express.Router();
const passport = require('passport');
const subscriptionController = require('../controllers/subscriptionController');

const requireAuth = passport.authenticate('jwt', { session: false });

/**
 * @swagger
 * tags:
 *   name: Subscriptions
 *   description: Financial product subscription management
 * 
 * components:
 *   schemas:
 *     SubscriptionRequest:
 *       type: object
 *       required:
 *         - productType
 *         - productId
 *       properties:
 *         productType:
 *           type: string
 *           enum: [Portfolio, Bundle]
 *           example: "Bundle"
 *         productId:
 *           type: string
 *           format: objectid
 *           example: "615a2d4b87d9c34f7d4f8a12"
 * 
 *     SubscriptionResponse:
 *       type: object
 *       properties:
 *         orderId:
 *           type: string
 *           example: "order_Jio8jFk3Fk3Fk3"
 *         amount:
 *           type: integer
 *           example: 29999
 *           description: Amount in paise (1 INR = 100 paise)
 *         currency:
 *           type: string
 *           example: "INR"
 * 
 *     PaymentVerification:
 *       type: object
 *       required:
 *         - orderId
 *         - paymentId
 *         - signature
 *       properties:
 *         orderId:
 *           type: string
 *           example: "order_Jio8jFk3Fk3Fk3"
 *         paymentId:
 *           type: string
 *           example: "pay_Jio8jFk3Fk3Fk3"
 *         signature:
 *           type: string
 *           example: "b6929c0e50d53b..."
 * 
 *     PaymentHistory:
 *       allOf:
 *         - $ref: '#/components/schemas/PaymentHistory'
 *         - type: object
 *           properties:
 *             subscription:
 *               $ref: '#/components/schemas/Subscription'
 */

/**
 * @swagger
 * /api/subscriptions/order:
 *   post:
 *     summary: Create payment order
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SubscriptionRequest'
 *     responses:
 *       201:
 *         description: Payment order created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SubscriptionResponse'
 *       400:
 *         description: Invalid request parameters
 *       404:
 *         description: Product not found
 *       503:
 *         description: Payment service unavailable
 */
router.post('/order', requireAuth, subscriptionController.createOrder);

/**
 * @swagger
 * /api/subscriptions/verify:
 *   post:
 *     summary: Verify payment
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PaymentVerification'
 *     responses:
 *       200:
 *         description: Payment verified
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 subscription:
 *                   $ref: '#/components/schemas/Subscription'
 *       400:
 *         description: Invalid verification data
 *       404:
 *         description: Order/Subscription not found
 */
router.post('/verify', requireAuth, subscriptionController.verifyPayment);

/**
 * @swagger
 * /api/subscriptions/history:
 *   get:
 *     summary: Get payment history
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payment history retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/PaymentHistory'
 *       500:
 *         description: Server error
 */
router.get('/history', requireAuth, subscriptionController.getHistory);

module.exports = router;
