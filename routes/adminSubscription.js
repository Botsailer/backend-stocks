/*
 * routes/adminSubscriptions.js
 * ------------------------------------------
 * Express routes for admin subscription management with Swagger docs
 */
const express = require('express');
const passport = require('passport');
const adminCtl = require('../controllers/adminSubscriptionController');
const router = express.Router();
const requireAdmin = require('../middleware/requirreAdmin');

// Apply JWT auth and admin check for all admin subscription routes
router.use(passport.authenticate('jwt', { session: false }), requireAdmin);

/**
 * @swagger
 * components:
 *   schemas:
 *     AdminSubscription:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: MongoDB subscription ID
 *         user:
 *           type: object
 *           description: Full user data
 *         portfolio:
 *           type: object
 *           description: Full portfolio data
 *         isActive:
 *           type: boolean
 *           description: Whether subscription is currently active
 *         missedCycles:
 *           type: number
 *           description: Count of missed payment cycles
 *         lastRenewed:
 *           type: string
 *           format: date-time
 *           description: Last renewal date
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Creation timestamp
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *     AdminSubscriptionList:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         count:
 *           type: integer
 *           description: Total number of subscriptions
 *           example: 25
 *         subscriptions:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AdminSubscription'
 */

/**
 * @swagger
 * /api/admin/subscriptions:
 *   get:
 *     summary: List all subscriptions
 *     description: Returns a list of all subscriptions with full user and portfolio details, sorted by creation date (newest first)
 *     tags: [AdminSubscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully retrieved subscriptions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminSubscriptionList'
 *       401:
 *         description: Unauthorized - invalid or missing authentication
 *       403:
 *         description: Forbidden - user does not have admin privileges
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 details:
 *                   type: string
 */
router.get('/', adminCtl.listSubscriptions);

/**
 * @swagger
 * /api/admin/subscriptions/{id}:
 *   get:
 *     summary: Get a subscription by ID
 *     description: Returns detailed information about a specific subscription including user, portfolio and payment history
 *     tags: [AdminSubscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB subscription ID
 *     responses:
 *       200:
 *         description: Subscription object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminSubscription'
 *       401:
 *         description: Unauthorized - invalid or missing authentication
 *       403:
 *         description: Forbidden - user does not have admin privileges
 *       404:
 *         description: Subscription not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Subscription not found"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Failed to generate invoice"
 *                 details:
 *                   type: string
 */
router.get('/:id', adminCtl.getSubscription);

/**
 * @swagger
 * /api/admin/subscriptions/{id}/invoice:
 *   get:
 *     summary: Generate invoice for a subscription
 *     description: Creates a detailed invoice PDF for a specific subscription
 *     tags: [AdminSubscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB subscription ID
 *     responses:
 *       200:
 *         description: Invoice data generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 invoice:
 *                   type: object
 *                   properties:
 *                     invoiceNumber:
 *                       type: string
 *                       example: "INV-12345678-123456"
 *                     customerName:
 *                       type: string
 *                       example: "John Doe"
 *                     customerEmail:
 *                       type: string
 *                       example: "john@example.com"
 *                     productName:
 *                       type: string
 *                       example: "Premium Portfolio"
 *                     amount:
 *                       type: number
 *                       example: 999.99
 *                     paymentDate:
 *                       type: string
 *                       format: date-time
 *                       example: "2024-01-15T10:30:00.000Z"
 *       401:
 *         description: Unauthorized - invalid or missing authentication
 *       403:
 *         description: Forbidden - user does not have admin privileges
 *       404:
 *         description: Subscription not found
 *       500:
 *         description: Server error
 */
router.get('/:id/invoice', adminCtl.generateInvoice);

/**
 * @swagger
 * /api/admin/subscriptions:
 *   post:
 *     summary: Create a new subscription
 *     description: Creates a subscription relationship between a user and portfolio
 *     tags: [AdminSubscriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, portfolioId]
 *             properties:
 *               userId:
 *                 type: string
 *                 description: MongoDB user ID
 *                 example: "507f1f77bcf86cd799439011"
 *               portfolioId:
 *                 type: string
 *                 description: MongoDB portfolio ID
 *                 example: "507f1f77bcf86cd799439012"
 *     responses:
 *       201:
 *         description: Subscription created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminSubscription'
 *       400:
 *         description: Bad request - missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: userId and portfolioId are required
 *       401:
 *         description: Unauthorized - invalid or missing authentication
 *       403:
 *         description: Forbidden - user does not have admin privileges
 *       500:
 *         description: Server error
 */
router.post('/', adminCtl.createSubscription);

/**
 * @swagger
 * /api/admin/subscriptions/{id}:
 *   put:
 *     summary: Update a subscription
 *     description: Updates an existing subscription with new data
 *     tags: [AdminSubscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB subscription ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, cancelled, expired, pending]
 *                 description: New subscription status
 *               amount:
 *                 type: number
 *                 description: Updated subscription amount
 *     responses:
 *       200:
 *         description: Subscription updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminSubscription'
 *       401:
 *         description: Unauthorized - invalid or missing authentication
 *       403:
 *         description: Forbidden - user does not have admin privileges
 *       404:
 *         description: Subscription not found
 *       500:
 *         description: Server error
 */
router.put('/:id', adminCtl.updateSubscription);

/**
 * @swagger
 * /api/admin/subscriptions/{id}:
 *   delete:
 *     summary: Delete a subscription
 *     description: Permanently deletes a subscription
 *     tags: [AdminSubscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB subscription ID
 *     responses:
 *       200:
 *         description: Subscription deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Subscription deleted"
 *       401:
 *         description: Unauthorized - invalid or missing authentication
 *       403:
 *         description: Forbidden - user does not have admin privileges
 *       404:
 *         description: Subscription not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', adminCtl.deleteSubscription);

/**
 * @swagger
 * /admin/subscriptions/process-expired:
 *   post:
 *     tags: [AdminSubscriptions]
 *     summary: Force process expired subscriptions
 *     description: Manually triggers the processing of expired subscriptions to kick users from Telegram groups
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Expired subscription processing triggered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Expired subscription processing triggered successfully
 *                 result:
 *                   type: object
 *                   properties:
 *                     success:
 *                       type: boolean
 *                       example: true
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin only
 *       500:
 *         description: Server error
 */
router.post('/process-expired', adminCtl.processExpiredSubscriptions);

module.exports = router;
