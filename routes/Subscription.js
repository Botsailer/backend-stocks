// routes/subscriptionRoutes.js

const express = require("express");
const router = express.Router();
const passport = require("passport");
const subscriptionController = require("../controllers/subscriptionController");
const { validateSubscriptions } = require("../middleware/subscriptionValidator");


const requireAuth = passport.authenticate("jwt", { session: false });

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
 *               planType:
 *                 type: string
 *                 enum: 
 *                   - monthly
 *                   - quarterly
 *                   - yearly
 *                 example: "quarterly"
 *                 description: |
 *                   Plan type for one-time payment:
 *                   - **monthly**: 1 month access
 *                   - **quarterly**: 3 months access
 *                   - **yearly**: 12 months access
 *               couponCode:
 *                 type: string
 *                 example: "WELCOME10"
 *                 description: Optional coupon code for discount
 *     responses:
 *       201:
 *         description: Payment order created
 *       400:
 *         description: Invalid request parameters
 *       404:
 *         description: Product not found
 *       409:
 *         description: User already subscribed to this product
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               planType:
 *                 type: string
 *                 enum: 
 *                   - monthly
 *                   - quarterly
 *                   - yearly
 *                 example: "quarterly"
 *                 description: |
 *                   Plan type for cart items (one-time payment):
 *                   - **monthly**: 1 month access
 *                   - **quarterly**: 3 months access
 *                   - **yearly**: 12 months access
 *               couponCode:
 *                 type: string
 *                 example: "WELCOME10"
 *                 description: Optional coupon code for discount
 *     responses:
 *       201:
 *         description: Payment order created for cart
 *       400:
 *         description: Cart is empty or invalid
 *       404:
 *         description: Portfolio not found
 *       409:
 *         description: User already subscribed to one or more portfolios in the cart
 *       503:
 *         description: Payment service unavailable
 */
router.post("/checkout", requireAuth, subscriptionController.checkoutCart);

/**
 * @swagger
 * /api/subscriptions/verify:
 *   post:
 *     summary: Verify payment after client-side payment completion
 *     description: |
 *       Enhanced payment verification with automatic Telegram integration:
 *       - Validates payment signature and amount
 *       - Creates active subscriptions with coupon support
 *       - Automatically generates Telegram invite links for portfolio subscriptions
 *       - Sends confirmation emails with group access
 *       - Generates and sends bills with coupon details
 *       - Supports both single payments and cart checkout
 *     tags: [Subscriptions, Telegram Management]
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
 *                 description: Razorpay order ID
 *                 example: "order_ABC123xyz"
 *               paymentId:
 *                 type: string
 *                 description: Razorpay payment ID
 *                 example: "pay_DEF456uvw"
 *               signature:
 *                 type: string
 *                 description: Razorpay payment signature for verification
 *                 example: "sha256_signature_string"
 *     responses:
 *       200:
 *         description: Payment verified and subscription activated with Telegram integration
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
 *                   example: "Portfolio payment verified with coupon WELCOME10"
 *                 subscriptionId:
 *                   type: string
 *                   example: "615a2d4b87d9c34f7d4f8a12"
 *                 category:
 *                   type: string
 *                   example: "premium"
 *                 originalAmount:
 *                   type: number
 *                   example: 1999.00
 *                 discountApplied:
 *                   type: number
 *                   example: 199.90
 *                 finalAmount:
 *                   type: number
 *                   example: 1799.10
 *                 savings:
 *                   type: number
 *                   example: 199.90
 *                 couponUsed:
 *                   type: object
 *                   properties:
 *                     code:
 *                       type: string
 *                       example: "WELCOME10"
 *                     discountApplied:
 *                       type: number
 *                       example: 199.90
 *                     savings:
 *                       type: number
 *                       example: 199.90
 *                 billGenerated:
 *                   type: boolean
 *                   example: true
 *                 billNumber:
 *                   type: string
 *                   example: "BILL_2025_001234"
 *                 telegramInviteLinks:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       productId:
 *                         type: string
 *                         example: "615a2d4b87d9c34f7d4f8a12"
 *                       product_name:
 *                         type: string
 *                         example: "Growth Portfolio"
 *                       invite_link:
 *                         type: string
 *                         example: "https://t.me/+ABC123xyz"
 *                       expires_at:
 *                         type: string
 *                         format: date-time
 *                         example: "2025-10-04T12:00:00.000Z"
 *                 telegramMessage:
 *                   type: string
 *                   example: "You have access to 1 Telegram group. Check your email for invite links."
 *       400:
 *         description: Invalid verification data or payment amount mismatch
 *       404:
 *         description: Order/Subscription not found
 *       409:
 *         description: Payment already processed
 *       500:
 *         description: Payment verification failed
 */
// Add request logging middleware for better debugging
router.post("/verify", requireAuth, (req, res, next) => {
  console.log(`🔍 Processing payment verification for user ${req.user?._id} | Payment ID: ${req.body?.paymentId || 'N/A'} | Order ID: ${req.body?.orderId || 'N/A'}`);
  next();
}, subscriptionController.verifyPayment);

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
router.get("/history", requireAuth, validateSubscriptions, subscriptionController.getHistory);

/**
 * @swagger
 * /api/subscriptions/emandate:
 *   get:
 *     summary: Get emandate information (method not allowed)
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       405:
 *         description: Method not allowed - use POST to create emandate
 */
router.get("/emandate", requireAuth, validateSubscriptions, (req, res) => {
  return res.status(405).json({
    success: false,
    error: "Method not allowed. Use POST to create emandate subscription.",
    code: "METHOD_NOT_ALLOWED"
  });
});

/**
 * @swagger
 * /api/subscriptions/emandate:
 *   post:
 *     summary: Create eMandate for recurring payments with flexible intervals
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
 *               emandateType:
 *                 type: string
 *                 enum: 
 *                   - monthly
 *                   - quarterly
 *                   - yearly
 *                 example: "monthly"
 *                 description: |
 *                   Emandate billing interval:
 *                   - **monthly**: Charged every 1 month, continues indefinitely until cancelled
 *                   - **quarterly**: Charged every 3 months, continues indefinitely until cancelled
 *                   - **yearly**: Charged once per year, continues indefinitely until cancelled
 *               couponCode:
 *                 type: string
 *                 example: "WELCOME10"
 *                 description: Optional coupon code for discount
 *     responses:
 *       201:
 *         description: eMandate created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 subscriptionId:
 *                   type: string
 *                   description: Razorpay subscription ID
 *                 setupUrl:
 *                   type: string
 *                   description: URL for customer to complete emandate setup
 *                 amount:
 *                   type: number
 *                   description: Amount per billing cycle
 *                 emandateType:
 *                   type: string
 *                   enum: 
 *                     - monthly
 *                     - quarterly
 *                     - yearly
 *                   description: |
 *                     Billing interval:
 *                     - **monthly**: Charged every 1 month, continues indefinitely until cancelled
 *                     - **quarterly**: Charged every 3 months, continues indefinitely until cancelled
 *                     - **yearly**: Charged once per year, continues indefinitely until cancelled
 *                 interval:
 *                   type: number
 *                   description: Interval in months between charges
 *                 status:
 *                   type: string
 *                   description: Subscription status
 *       400:
 *         description: Invalid request parameters
 *       404:
 *         description: Product not found
 *       409:
 *         description: User already subscribed to this product
 *       503:
 *         description: Payment service unavailable
 */
router.post("/emandate", requireAuth, subscriptionController.createEmandate);

/**
 * @swagger
 * /api/subscriptions/emandate/verify:
 *   post:
 *     summary: Verify eMandate setup after customer authorization
 *     description: |
 *       Enhanced eMandate verification with comprehensive integration:
 *       - Verifies eMandate subscription status with Razorpay
 *       - Processes coupon discounts and tracks usage
 *       - Automatically generates Telegram invite links for portfolio subscriptions
 *       - Sends email notifications with group access details
 *       - Generates and sends bills with coupon information
 *       - Handles renewals with compensation logic
 *       - Manages user premium status updates
 *     tags: [Subscriptions, Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - subscription_id
 *             properties:
 *               subscription_id:
 *                 type: string
 *                 description: Razorpay subscription ID for eMandate
 *                 example: "sub_ABC123xyz"
 *     responses:
 *       200:
 *         description: eMandate verified and subscription activated with Telegram integration
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
 *                   example: "eMandate authenticated. Activated 1 subscriptions with coupon SAVE20"
 *                 subscriptionStatus:
 *                   type: string
 *                   example: "authenticated"
 *                 activatedSubscriptions:
 *                   type: number
 *                   example: 1
 *                 isRenewal:
 *                   type: boolean
 *                   example: false
 *                 telegramInviteLinks:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       productId:
 *                         type: string
 *                         example: "615a2d4b87d9c34f7d4f8a12"
 *                       invite_link:
 *                         type: string
 *                         example: "https://t.me/+ABC123xyz"
 *                       expires_at:
 *                         type: string
 *                         format: date-time
 *                         example: "2025-10-04T12:00:00.000Z"
 *                 requiresAction:
 *                   type: boolean
 *                   example: false
 *                 couponUsed:
 *                   type: object
 *                   properties:
 *                     code:
 *                       type: string
 *                       example: "SAVE20"
 *                     originalAmount:
 *                       type: number
 *                       example: 2499.00
 *                     discountApplied:
 *                       type: number
 *                       example: 499.80
 *                     finalAmount:
 *                       type: number
 *                       example: 1999.20
 *                     savings:
 *                       type: number
 *                       example: 499.80
 *       400:
 *         description: Invalid eMandate data or unknown subscription status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Subscription in pending_authentication state."
 *                 subscriptionStatus:
 *                   type: string
 *                   example: "pending_authentication"
 *                 requiresAction:
 *                   type: boolean
 *                   example: true
 *                 authenticationUrl:
 *                   type: string
 *                   example: "https://rzp.io/i/ABC123"
 *                 couponWillBeApplied:
 *                   type: object
 *                   properties:
 *                     code:
 *                       type: string
 *                       example: "SAVE20"
 *                     originalAmount:
 *                       type: number
 *                       example: 2499.00
 *                     discountApplied:
 *                       type: number
 *                       example: 499.80
 *                     finalAmount:
 *                       type: number
 *                       example: 1999.20
 *                     savings:
 *                       type: number
 *                       example: 499.80
 *       403:
 *         description: Unauthorized access to subscription
 *       404:
 *         description: eMandate/Subscription not found
 *       500:
 *         description: eMandate verification failed
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