const express = require('express');
const router = express.Router();
const telegramController = require('../controllers/telegramController');
const authMiddleware = require('../middleware/authMiddleware'); // Assuming you have auth middleware
const requireAdmin = require('../middleware/requirreAdmin'); // Your admin middleware

/**
 * @swagger
 * /api/telegram/health:
 *   get:
 *     summary: Check Telegram bot health status
 *     description: Returns the current status of the Telegram bot service
 *     tags: [Telegram]
 *     responses:
 *       200:
 *         description: Health check successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 botInitialized:
 *                   type: boolean
 *                   description: Whether the bot is initialized and running
 *                 hasToken:
 *                   type: boolean
 *                   description: Whether the bot token is configured
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   description: Current server timestamp
 */
// Health check endpoint (no auth required)
router.get('/health', (req, res) => {
  const telegramBotService = require('../config/telegramBot');
  res.json({
    success: true,
    botInitialized: telegramBotService.isInitialized(),
    hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
    timestamp: new Date().toISOString()
  });
});

// User routes (require authentication)
router.use(authMiddleware);

/**
 * User endpoints
 */
// Generate access link for user's subscription
router.post('/generate-link', telegramController.generateAccessLink);

// Get user's Telegram groups
router.get('/user/groups', telegramController.getUserGroups);

// Revoke user's access link
router.post('/links/:linkId/revoke', telegramController.revokeAccessLink);

/**
 * Admin endpoints (require admin role)
 */
router.use(requireAdmin);

// Group management
router.post('/groups', telegramController.createGroupMapping);
router.get('/admin/groups', telegramController.getAllGroups);
router.put('/admin/groups/:groupId', telegramController.updateGroup);

// Cleanup operations
router.post('/admin/cleanup/expired', telegramController.cleanupExpiredUsers);
router.post('/admin/cleanup/links', telegramController.cleanupExpiredLinks);

// User management
router.post('/admin/users/:telegramUserId/kick', telegramController.kickUser);

// Statistics
router.get('/admin/stats', telegramController.getStatistics);

module.exports = router;