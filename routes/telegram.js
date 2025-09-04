const express = require('express');
const router = express.Router();
const requireAdmin = require('../middleware/requirreAdmin');
const telegramController = require('../controllers/telegramController');

/**
 * @swagger
 * /api/admin/telegram/sync-with-telegram:
 *   post:
 *     summary: Sync all portfolios and bundles with Telegram
 *     tags: [Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sync completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *       500:
 *         description: Server error
 */
router.post('/sync-with-telegram', requireAdmin, telegramController.syncWithTelegram);

/**
 * @swagger
 * /api/admin/telegram/groups:
 *   get:
 *     summary: Get all Telegram groups
 *     tags: [Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Groups retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       telegram_group_id:
 *                         type: string
 *                       telegram_group_name:
 *                         type: string
 *       500:
 *         description: Server error
 */
router.get('/groups', requireAdmin, telegramController.getAllGroups);

/**
 * @swagger
 * /api/admin/telegram/groups/unmapped:
 *   get:
 *     summary: Get unmapped Telegram groups
 *     tags: [Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unmapped groups retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       telegram_group_id:
 *                         type: string
 *                       telegram_group_name:
 *                         type: string
 *       500:
 *         description: Server error
 */
router.get('/groups/unmapped', requireAdmin, telegramController.getUnmappedGroups);

/**
 * @swagger
 * /api/admin/telegram/groups:
 *   post:
 *     summary: Create a new Telegram group
 *     tags: [Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Group name
 *               description:
 *                 type: string
 *                 description: Group description
 *               telegram_group_id:
 *                 type: string
 *                 description: Telegram group ID (optional, can be generated)
 *     responses:
 *       201:
 *         description: Group created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                 message:
 *                   type: string
 *                   example: "Group created successfully"
 *       400:
 *         description: Invalid request data
 *       500:
 *         description: Server error
 */
router.post('/groups', requireAdmin, telegramController.createGroup);

/**
 * @swagger
 * /api/admin/telegram/products/{productId}/map:
 *   post:
 *     summary: Map a product to a Telegram group
 *     tags: [Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID to map
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - telegram_group_id
 *               - telegram_group_name
 *             properties:
 *               telegram_group_id:
 *                 type: string
 *                 description: Telegram group ID
 *               telegram_group_name:
 *                 type: string
 *                 description: Telegram group name
 *     responses:
 *       200:
 *         description: Product mapped successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       400:
 *         description: Invalid request data
 *       500:
 *         description: Server error
 */
router.post('/products/:productId/map', requireAdmin, telegramController.mapProductToGroup);

/**
 * @swagger
 * /api/admin/telegram/products/{productId}/unmap:
 *   delete:
 *     summary: Unmap a product from its Telegram group
 *     tags: [Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID to unmap
 *     responses:
 *       200:
 *         description: Product unmapped successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       500:
 *         description: Server error
 */
router.delete('/products/:productId/unmap', requireAdmin, telegramController.unmapProductFromGroup);

/**
 * @swagger
 * /api/admin/telegram/products/{productId}/group:
 *   get:
 *     summary: Get Telegram group mapping for a product
 *     tags: [Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     responses:
 *       200:
 *         description: Group mapping retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     telegram_group_id:
 *                       type: string
 *                     telegram_group_name:
 *                       type: string
 *       500:
 *         description: Server error
 */
router.get('/products/:productId/group', requireAdmin, telegramController.getProductGroupMapping);

/**
 * @swagger
 * /api/admin/telegram/products:
 *   get:
 *     summary: Get all Telegram products
 *     tags: [Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Products retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 1
 *                       name:
 *                         type: string
 *                         example: "Test Product"
 *                       description:
 *                         type: string
 *                         example: "Test Description"
 *                       telegram_group:
 *                         type: object
 *                         nullable: true
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                       updated_at:
 *                         type: string
 *                         format: date-time
 *                 total:
 *                   type: integer
 *                   example: 4
 *       500:
 *         description: Server error
 */
router.get('/products', requireAdmin, telegramController.getAllProducts);

/**
 * @swagger
 * /api/admin/telegram/products/{productId}:
 *   get:
 *     summary: Get a specific Telegram product by ID
 *     tags: [Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     responses:
 *       200:
 *         description: Product retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       example: 1
 *                     name:
 *                       type: string
 *                       example: "Test Product"
 *                     description:
 *                       type: string
 *                       example: "Test Description"
 *                     telegram_group:
 *                       type: object
 *                       nullable: true
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *                     updated_at:
 *                       type: string
 *                       format: date-time
 *       500:
 *         description: Server error
 */
router.get('/products/:productId', requireAdmin, telegramController.getProductById);

/**
 * @swagger
 * /api/admin/telegram/products:
 *   post:
 *     summary: Create a new Telegram product
 *     tags: [Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - description
 *             properties:
 *               name:
 *                 type: string
 *                 description: Product name
 *               description:
 *                 type: string
 *                 description: Product description
 *               price:
 *                 type: number
 *                 description: Product price
 *               category:
 *                 type: string
 *                 description: Product category
 *     responses:
 *       201:
 *         description: Product created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                 message:
 *                   type: string
 *                   example: "Product created successfully"
 *       400:
 *         description: Invalid request data
 *       500:
 *         description: Server error
 */
router.post('/products', requireAdmin, telegramController.createProduct);

/**
 * @swagger
 * /api/admin/telegram/products/{productId}:
 *   put:
 *     summary: Update a Telegram product
 *     tags: [Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Product name
 *               description:
 *                 type: string
 *                 description: Product description
 *               price:
 *                 type: number
 *                 description: Product price
 *               category:
 *                 type: string
 *                 description: Product category
 *     responses:
 *       200:
 *         description: Product updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                 message:
 *                   type: string
 *                   example: "Product updated successfully"
 *       400:
 *         description: Invalid request data
 *       500:
 *         description: Server error
 */
router.put('/products/:productId', requireAdmin, telegramController.updateProduct);

/**
 * @swagger
 * /api/admin/telegram/products/{productId}:
 *   delete:
 *     summary: Delete a Telegram product
 *     tags: [Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     responses:
 *       200:
 *         description: Product deleted successfully
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
 *                   example: "Product deleted successfully"
 *       500:
 *         description: Server error
 */
router.delete('/products/:productId', requireAdmin, telegramController.deleteProduct);

// Temporary public routes for testing (remove after debugging)
/**
 * @swagger
 * /api/admin/telegram/public/products:
 *   get:
 *     summary: Get all Telegram products (Public - for testing)
 *     tags: [Telegram Management]
 *     responses:
 *       200:
 *         description: Products retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 1
 *                       name:
 *                         type: string
 *                         example: "Test Product"
 *                       description:
 *                         type: string
 *                         example: "Test Description"
 *                       telegram_group:
 *                         type: object
 *                         nullable: true
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                       updated_at:
 *                         type: string
 *                         format: date-time
 *                 total:
 *                   type: integer
 *                   example: 4
 */
router.get('/public/products', telegramController.getAllProducts);

/**
 * @swagger
 * /api/admin/telegram/public/products/{productId}:
 *   get:
 *     summary: Get a specific Telegram product by ID (Public - for testing)
 *     tags: [Telegram Management]
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     responses:
 *       200:
 *         description: Product retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       example: 1
 *                     name:
 *                       type: string
 *                       example: "Test Product"
 *                     description:
 *                       type: string
 *                       example: "Test Description"
 *                     telegram_group:
 *                       type: object
 *                       nullable: true
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *                     updated_at:
 *                       type: string
 *                       format: date-time
 */
router.get('/public/products/:productId', telegramController.getProductById);

/**
 * @swagger
 * /api/admin/telegram/subscriptions:
 *   get:
 *     summary: Get all subscriptions with filtering and pagination
 *     tags: [Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: per_page
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 100
 *         description: Items per page
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           default: "created_at"
 *         description: Field to sort by
 *       - in: query
 *         name: sort_order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: "desc"
 *         description: Sort direction
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by subscription status
 *       - in: query
 *         name: product_id
 *         schema:
 *           type: string
 *         description: Filter by product ID
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: string
 *         description: Filter by user ID
 *     responses:
 *       200:
 *         description: Subscriptions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 per_page:
 *                   type: integer
 *                 pages:
 *                   type: integer
 *       500:
 *         description: Server error
 */
router.get('/subscriptions', requireAdmin, telegramController.getAllSubscriptions);

/**
 * @swagger
 * /api/admin/telegram/subscribe:
 *   post:
 *     summary: Create a new subscription
 *     tags: [Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - expiration_datetime
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User email address
 *               product_id:
 *                 type: string
 *                 description: Product ID (alternative to product_name)
 *               product_name:
 *                 type: string
 *                 description: Product name (alternative to product_id)
 *               expiration_datetime:
 *                 type: string
 *                 format: date-time
 *                 description: Subscription expiration datetime
 *     responses:
 *       201:
 *         description: Subscription created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                 message:
 *                   type: string
 *                   example: "Subscription created successfully"
 *                 invite_link:
 *                   type: string
 *                   example: "https://t.me/joinchat/abcdefg"
 *                 invite_expires_at:
 *                   type: string
 *                   format: date-time
 *                 subscription_expires_at:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid request data
 *       500:
 *         description: Server error
 */
router.post('/subscribe', requireAdmin, telegramController.createSubscription);

/**
 * @swagger
 * /api/admin/telegram/subscriptions:
 *   delete:
 *     summary: Cancel subscription by email and product ID
 *     tags: [Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - product_id
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User email address
 *               product_id:
 *                 type: string
 *                 description: Product ID
 *     responses:
 *       200:
 *         description: Subscription cancelled successfully
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
 *                   example: "Subscription cancelled successfully"
 *       400:
 *         description: Invalid request data
 *       500:
 *         description: Server error
 */
router.delete('/subscriptions', requireAdmin, telegramController.cancelSubscriptionByEmail);

/**
 * @swagger
 * /api/admin/telegram/users:
 *   get:
 *     summary: Get all users
 *     tags: [Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Users retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       email:
 *                         type: string
 *       500:
 *         description: Server error
 */
router.get('/users', requireAdmin, telegramController.getAllUsers);

/**
 * @swagger
 * /api/admin/telegram/subscriptions/{subscriptionId}/cancel:
 *   post:
 *     summary: Cancel subscription by ID
 *     tags: [Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: subscriptionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Subscription ID
 *     responses:
 *       200:
 *         description: Subscription cancelled successfully
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
 *                   example: "Subscription cancelled successfully"
 *       400:
 *         description: Invalid subscription ID
 *       500:
 *         description: Server error
 */
router.post('/subscriptions/:subscriptionId/cancel', requireAdmin, telegramController.cancelSubscriptionById);

/**
 * @swagger
 * /api/admin/telegram/webhook/{token}:
 *   post:
 *     summary: Process Telegram webhook updates
 *     tags: [Telegram Management]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Telegram bot token for verification
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Telegram Update object
 *     responses:
 *       200:
 *         description: Update processed successfully
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
 *                   example: "Update processed successfully"
 *       401:
 *         description: Invalid token
 *       500:
 *         description: Error processing update
 */
router.post('/webhook/:token', telegramController.processWebhook);

/**
 * @swagger
 * /api/admin/telegram/webhook/test:
 *   get:
 *     summary: Test Telegram webhook configuration
 *     tags: [Telegram Management]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Webhook info retrieved successfully
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
 *                   example: "Webhook info retrieved successfully"
 *                 webhook_url:
 *                   type: string
 *                   example: "https://example.com/telegram/webhook/token"
 *                 has_custom_certificate:
 *                   type: boolean
 *                   example: false
 *                 pending_update_count:
 *                   type: integer
 *                   example: 0
 *                 last_error_date:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 last_error_message:
 *                   type: string
 *                   nullable: true
 *                 max_connections:
 *                   type: integer
 *                   example: 40
 *       500:
 *         description: Error getting webhook info
 */
router.get('/webhook/test', requireAdmin, telegramController.testWebhook);

module.exports = router;
