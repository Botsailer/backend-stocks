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
 * tags:
 *   name: AdminSubscriptions
 *   description: Admin-only subscription management
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Subscription:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: MongoDB subscription ID
 *         user:
 *           $ref: '#/components/schemas/User'
 *           description: Full user data
 *         portfolio:
 *           $ref: '#/components/schemas/Portfolio'
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
 *         expiryDate:
 *           type: string
 *           format: date-time
 *           description: Expiry date of subscription
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Creation timestamp
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
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
 *               $ref: '#/components/schemas/SubscriptionListResponse'
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
 *               $ref: '#/components/schemas/Subscription'
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
 *                 error:
 *                   type: string
 *                   example: Subscription not found
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Failed to retrieve subscription
 */
router.get('/:id', adminCtl.getSubscription);

/**
 * @swagger
 * /api/admin/subscriptions/{id}/invoice:
 *   get:
 *     summary: Generate invoice for a subscription
 *     description: Generate and return invoice data for a specific subscription
 *     tags: [AdminSubscriptions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Subscription ID
 *     responses:
 *       200:
 *         description: Invoice generated successfully
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
 *                       example: "INV-12345678-987654"
 *                     customerName:
 *                       type: string
 *                       example: "John Doe"
 *                     customerEmail:
 *                       type: string
 *                       example: "john@example.com"
 *                     productName:
 *                       type: string
 *                       example: "Premium Portfolio"
 *                     paymentType:
 *                       type: string
 *                       example: "Emandate"
 *                     amount:
 *                       type: number
 *                       example: 1200
 *                     paymentStatus:
 *                       type: string
 *                       example: "active"
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
 *     summary: Create a new subscription record
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
 *                 example: 60f72a9b1d2f3b0014b3c0f1
 *               portfolioId:
 *                 type: string
 *                 description: MongoDB portfolio ID
 *                 example: 60f72a9b1d2f3b0014b3c0f2
 *     responses:
 *       201:
 *         description: Subscription created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Subscription'
 *       400:
 *         description: Validation error
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Unable to create subscription
 */
router.post('/', adminCtl.createSubscription);

/**
 * @swagger
 * /api/admin/subscriptions/{id}:
 *   put:
 *     summary: Update a subscription by ID
 *     description: Modify subscription details such as active status or missed cycles
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
 *               isActive:
 *                 type: boolean
 *                 description: Activate/deactivate subscription
 *               missedCycles:
 *                 type: number
 *                 description: Number of missed payment cycles
 *               lastRenewed:
 *                 type: string
 *                 format: date-time
 *                 description: Date of last renewal
 *               expiryDate:
 *                 type: string
 *                 format: date-time
 *                 description: Expiry date of subscription
 *     responses:
 *       200:
 *         description: Updated subscription
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Subscription'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
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
 *                 error:
 *                   type: string
 *                   example: Subscription not found
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Failed to update subscription
 */
router.put('/:id', adminCtl.updateSubscription);

/**
 * @swagger
 * /api/admin/subscriptions/{id}:
 *   delete:
 *     summary: Delete a subscription by ID
 *     description: Permanently removes a subscription record
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
 *         description: Deletion confirmation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Subscription deleted
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
 *                 error:
 *                   type: string
 *                   example: Subscription not found
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Failed to delete subscription
 */
router.delete('/:id', adminCtl.deleteSubscription);

module.exports = router;
