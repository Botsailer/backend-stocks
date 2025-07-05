const express = require("express");
const router = express.Router();
const passport = require("passport");
const subscriptionController = require("../controllers/subscriptionController");

const requireAuth = passport.authenticate("jwt", { session: false });

/**
 * @swagger
 * tags:
 *   name: Subscriptions
 *   description: Financial product subscription management
 */

/**
 * @swagger
 * /api/subscriptions/order:
 *   post:
 *     summary: Create payment order for a single product
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productType
 *               - productId
 *             properties:
 *               productType:
 *                 type: string
 *                 enum: [Portfolio, Bundle]
 *                 example: "Bundle"
 *               productId:
 *                 type: string
 *                 format: objectid
 *                 example: "615a2d4b87d9c34f7d4f8a12"
 *     responses:
 *       201:
 *         description: Payment order created
 *       400:
 *         description: Invalid request parameters
 *       404:
 *         description: Product not found
 *       503:
 *         description: Payment service unavailable
 */
router.post("/order", requireAuth, subscriptionController.createOrder);

/**
 * @swagger
 * /api/subscriptions/checkout:
 *   post:
 *     summary: Checkout user's cart and create a payment order for all items
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Payment order created for cart
 *       400:
 *         description: Cart is empty or invalid
 *       404:
 *         description: Portfolio not found
 *       503:
 *         description: Payment service unavailable
 */
router.post("/checkout", requireAuth, subscriptionController.checkoutCart);

/**
 * @swagger
 * /api/subscriptions/verify:
 *   post:
 *     summary: Verify payment after client-side payment completion
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - orderId
 *               - paymentId
 *               - signature
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
 *         description: Invalid verification data
 *       404:
 *         description: Order/Subscription not found
 */
router.post("/verify", requireAuth, subscriptionController.verifyPayment);

/**
 * @swagger
 * /api/subscriptions/webhook:
 *   post:
 *     summary: Razorpay webhook for payment status updates (server-to-server)
 *     tags: [Subscriptions]
 *     description: |
 *       Receives payment status events from Razorpay for reliable verification.
 *       This endpoint should be set as a webhook in Razorpay dashboard.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook processed
 *       400:
 *         description: Invalid webhook data
 */
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  subscriptionController.razorpayWebhook
);

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
 *       500:
 *         description: Server error
 */
router.get("/history", requireAuth, subscriptionController.getHistory);

/**
 * @swagger
 * /api/subscriptions/emandate:
 *   post:
 *     summary: Create eMandate for yearly subscription with monthly payments
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productType
 *               - productId
 *             properties:
 *               productType:
 *                 type: string
 *                 enum: [Portfolio, Bundle]
 *                 example: "Bundle"
 *               productId:
 *                 type: string
 *                 format: objectid
 *                 example: "615a2d4b87d9c34f7d4f8a12"
 *     responses:
 *       201:
 *         description: eMandate created successfully
 *       400:
 *         description: Invalid request parameters
 *       404:
 *         description: Product not found
 *       503:
 *         description: Payment service unavailable
 */
router.post("/emandate", requireAuth, subscriptionController.createEmandate);

/**
 * @swagger
 * /api/subscriptions/emandate/verify:
 *   post:
 *     summary: Verify eMandate setup after customer authorization
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - emandateId
 *             properties:
 *               emandateId:
 *                 type: string
 *     responses:
 *       200:
 *         description: eMandate verified and subscription activated
 *       400:
 *         description: Invalid eMandate data or setup incomplete
 *       404:
 *         description: eMandate/Subscription not found
 */
router.post(
  "/emandate/verify",
  requireAuth,
  subscriptionController.verifyEmandate
);

/**
 * @swagger
 * /api/subscriptions/{subscriptionId}/cancel:
 *   post:
 *     summary: Cancel a subscription (subject to commitment period for yearly subscriptions)
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: subscriptionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Subscription cancelled successfully
 *       400:
 *         description: Cannot cancel during commitment period
 *       404:
 *         description: Subscription not found
 */
router.post(
  "/:subscriptionId/cancel",
  requireAuth,
  subscriptionController.cancelSubscription
);

module.exports = router;
