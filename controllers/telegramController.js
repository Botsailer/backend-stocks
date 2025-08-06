const telegramService = require('../services/telegramService');
const telegramBotService = require('../config/telegramBot');
const TelegramGroup = require('../models/TelegramGroup');
const TelegramInviteLink = require('../models/TelegramInviteLink');
const TelegramUser = require('../models/TelegramUser');
const Subscription = require('../models/subscription');
const Bundle = require('../models/bundle');
const Portfolio = require('../models/modelPortFolio');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level.toUpperCase()}] Telegram Controller: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/telegram-controller.log' })
  ]
});

/**
 * @swagger
 * tags:
 *   name: Telegram
 *   description: Telegram bot integration APIs
 */

/**
 * @swagger
 * /api/telegram/groups:
 *   post:
 *     summary: Create or update Telegram group mapping
 *     tags: [Telegram]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - chatId
 *               - groupTitle
 *               - productType
 *               - productId
 *             properties:
 *               chatId:
 *                 type: string
 *                 description: Telegram chat ID
 *               groupTitle:
 *                 type: string
 *                 description: Group title
 *               groupUsername:
 *                 type: string
 *                 description: Group username (optional)
 *               productType:
 *                 type: string
 *                 enum: [Portfolio, Bundle]
 *                 description: Type of product
 *               productId:
 *                 type: string
 *                 description: Portfolio or Bundle ID
 *               category:
 *                 type: string
 *                 enum: [basic, premium]
 *                 default: basic
 *               welcomeMessage:
 *                 type: string
 *                 description: Custom welcome message
 *               maxMembers:
 *                 type: number
 *                 description: Maximum group members
 *     responses:
 *       201:
 *         description: Group mapping created/updated successfully
 *       400:
 *         description: Invalid request data
 *       500:
 *         description: Server error
 */
exports.createGroupMapping = async (req, res) => {
  try {
    const {
      chatId,
      groupTitle,
      groupUsername,
      productType,
      productId,
      category,
      welcomeMessage,
      maxMembers
    } = req.body;

    // Validate required fields
    if (!chatId || !groupTitle || !productType || !productId) {
      return res.status(400).json({
        error: 'Missing required fields: chatId, groupTitle, productType, productId'
      });
    }

    // Validate productType
    if (!['Portfolio', 'Bundle'].includes(productType)) {
      return res.status(400).json({
        error: 'productType must be either "Portfolio" or "Bundle"'
      });
    }

    // Verify product exists
    let product;
    if (productType === 'Portfolio') {
      product = await Portfolio.findById(productId);
    } else {
      product = await Bundle.findById(productId);
    }

    if (!product) {
      return res.status(404).json({
        error: `${productType} not found`
      });
    }

    // Create group mapping
    const telegramGroup = await telegramService.createGroupMapping({
      chatId: chatId.toString(),
      groupTitle,
      groupUsername,
      productType,
      productId,
      category: category || 'basic',
      createdBy: req.user._id,
      welcomeMessage,
      maxMembers
    });

    logger.info('Group mapping created/updated', {
      groupId: telegramGroup._id,
      chatId,
      productType,
      productId,
      createdBy: req.user._id
    });

    res.status(201).json({
      success: true,
      message: 'Group mapping created successfully',
      data: telegramGroup
    });

  } catch (error) {
    logger.error('Error creating group mapping', { error: error.message });
    res.status(500).json({
      error: 'Failed to create group mapping',
      details: error.message
    });
  }
};

/**
 * @swagger
 * /api/telegram/generate-link:
 *   post:
 *     summary: Generate access link for user's subscription
 *     tags: [Telegram]
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
 *               productId:
 *                 type: string
 *                 description: Portfolio or Bundle ID
 *     responses:
 *       200:
 *         description: Access link generated successfully
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
 *                   properties:
 *                     linkId:
 *                       type: string
 *                     inviteLink:
 *                       type: string
 *                     expiresAt:
 *                       type: string
 *                       format: date-time
 *                     subscriptionExpiresAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid request or no active subscription
 *       404:
 *         description: Product or group not found
 *       500:
 *         description: Server error
 */
exports.generateAccessLink = async (req, res) => {
  try {
    const { productType, productId } = req.body;
    const userId = req.user._id;

    // Validate required fields
    if (!productType || !productId) {
      return res.status(400).json({
        error: 'Missing required fields: productType, productId'
      });
    }

    // Find user's active subscription for this product
    const subscription = await Subscription.findOne({
      user: userId,
      productType,
      productId,
      status: 'active'
    });

    if (!subscription) {
      return res.status(400).json({
        error: 'No active subscription found for this product'
      });
    }

    // Check if subscription is expired
    if (subscription.expiresAt < new Date()) {
      return res.status(400).json({
        error: 'Subscription has expired'
      });
    }

    // Generate access link
    const inviteLink = await telegramService.generateAccessLink(
      userId,
      productType,
      productId,
      subscription._id
    );

    logger.info('Access link generated', {
      userId,
      productType,
      productId,
      linkId: inviteLink.linkId
    });

    res.json({
      success: true,
      message: 'Access link generated successfully',
      data: {
        linkId: inviteLink.linkId,
        inviteLink: inviteLink.inviteLink,
        expiresAt: inviteLink.expiresAt,
        subscriptionExpiresAt: inviteLink.subscriptionExpiresAt,
        maxUses: inviteLink.maxUses,
        currentUses: inviteLink.currentUses
      }
    });

  } catch (error) {
    logger.error('Error generating access link', {
      error: error.message,
      userId: req.user._id
    });

    if (error.message.includes('No Telegram group found')) {
      return res.status(404).json({
        error: 'No Telegram group configured for this product'
      });
    }

    res.status(500).json({
      error: 'Failed to generate access link',
      details: error.message
    });
  }
};

/**
 * @swagger
 * /api/telegram/user/groups:
 *   get:
 *     summary: Get user's Telegram groups
 *     tags: [Telegram]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's Telegram groups retrieved successfully
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
 *       500:
 *         description: Server error
 */
exports.getUserGroups = async (req, res) => {
  try {
    const userId = req.user._id;
    const groups = await telegramService.getUserGroups(userId);

    res.json({
      success: true,
      data: groups
    });

  } catch (error) {
    logger.error('Error getting user groups', {
      error: error.message,
      userId: req.user._id
    });

    res.status(500).json({
      error: 'Failed to get user groups',
      details: error.message
    });
  }
};

/**
 * @swagger
 * /api/telegram/links/{linkId}/revoke:
 *   post:
 *     summary: Revoke an access link
 *     tags: [Telegram]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: linkId
 *         required: true
 *         schema:
 *           type: string
 *         description: Link ID to revoke
 *     responses:
 *       200:
 *         description: Link revoked successfully
 *       404:
 *         description: Link not found
 *       403:
 *         description: Unauthorized to revoke this link
 *       500:
 *         description: Server error
 */
exports.revokeAccessLink = async (req, res) => {
  try {
    const { linkId } = req.params;
    const userId = req.user._id;

    const inviteLink = await TelegramInviteLink.findOne({
      linkId,
      requestedBy: userId
    });

    if (!inviteLink) {
      return res.status(404).json({
        error: 'Access link not found'
      });
    }

    if (inviteLink.status !== 'active') {
      return res.status(400).json({
        error: 'Link is already inactive'
      });
    }

    // Revoke the Telegram invite link
    try {
      await telegramBotService.revokeInviteLink(inviteLink.inviteLink);
    } catch (error) {
      logger.warn('Could not revoke Telegram link', {
        linkId,
        error: error.message
      });
    }

    // Update link status
    inviteLink.status = 'cancelled';
    await inviteLink.save();

    logger.info('Access link revoked', { linkId, userId });

    res.json({
      success: true,
      message: 'Access link revoked successfully'
    });

  } catch (error) {
    logger.error('Error revoking access link', {
      error: error.message,
      linkId: req.params.linkId,
      userId: req.user._id
    });

    res.status(500).json({
      error: 'Failed to revoke access link',
      details: error.message
    });
  }
};

// Admin endpoints

/**
 * @swagger
 * /api/telegram/admin/groups:
 *   get:
 *     summary: Get all Telegram groups (Admin only)
 *     tags: [Telegram]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All Telegram groups retrieved successfully
 *       500:
 *         description: Server error
 */
exports.getAllGroups = async (req, res) => {
  try {
    const groups = await TelegramGroup.find()
      .populate('productId')
      .populate('createdBy', 'name email')
      .sort('-createdAt');

    res.json({
      success: true,
      data: groups
    });

  } catch (error) {
    logger.error('Error getting all groups', { error: error.message });
    res.status(500).json({
      error: 'Failed to get groups',
      details: error.message
    });
  }
};

/**
 * @swagger
 * /api/telegram/admin/groups/{groupId}:
 *   put:
 *     summary: Update Telegram group (Admin only)
 *     tags: [Telegram]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               groupTitle:
 *                 type: string
 *               welcomeMessage:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *               maxMembers:
 *                 type: number
 *     responses:
 *       200:
 *         description: Group updated successfully
 *       404:
 *         description: Group not found
 *       500:
 *         description: Server error
 */
exports.updateGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const updates = req.body;

    const telegramGroup = await TelegramGroup.findByIdAndUpdate(
      groupId,
      updates,
      { new: true, runValidators: true }
    ).populate('productId').populate('createdBy', 'name email');

    if (!telegramGroup) {
      return res.status(404).json({
        error: 'Telegram group not found'
      });
    }

    logger.info('Group updated', { groupId, updates });

    res.json({
      success: true,
      message: 'Group updated successfully',
      data: telegramGroup
    });

  } catch (error) {
    logger.error('Error updating group', {
      error: error.message,
      groupId: req.params.groupId
    });

    res.status(500).json({
      error: 'Failed to update group',
      details: error.message
    });
  }
};

/**
 * @swagger
 * /api/telegram/admin/cleanup/expired:
 *   post:
 *     summary: Remove expired users from groups (Admin only)
 *     tags: [Telegram]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cleanup completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 removedCount:
 *                   type: number
 *       500:
 *         description: Server error
 */
exports.cleanupExpiredUsers = async (req, res) => {
  try {
    const removedCount = await telegramService.removeExpiredUsers();

    logger.info('Manual expired users cleanup completed', {
      removedCount,
      triggeredBy: req.user._id
    });

    res.json({
      success: true,
      message: 'Expired users cleanup completed',
      removedCount
    });

  } catch (error) {
    logger.error('Error during manual expired users cleanup', {
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to cleanup expired users',
      details: error.message
    });
  }
};

/**
 * @swagger
 * /api/telegram/admin/cleanup/links:
 *   post:
 *     summary: Cleanup expired links (Admin only)
 *     tags: [Telegram]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Link cleanup completed successfully
 *       500:
 *         description: Server error
 */
exports.cleanupExpiredLinks = async (req, res) => {
  try {
    const expiredCount = await telegramService.cleanupExpiredLinks();

    logger.info('Manual expired links cleanup completed', {
      expiredCount,
      triggeredBy: req.user._id
    });

    res.json({
      success: true,
      message: 'Expired links cleanup completed',
      expiredCount
    });

  } catch (error) {
    logger.error('Error during manual expired links cleanup', {
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to cleanup expired links',
      details: error.message
    });
  }
};

/**
 * @swagger
 * /api/telegram/admin/users/{telegramUserId}/kick:
 *   post:
 *     summary: Kick user from all groups (Admin only)
 *     tags: [Telegram]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: telegramUserId
 *         required: true
 *         schema:
 *           type: string
 *         description: Telegram user ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for kicking user
 *     responses:
 *       200:
 *         description: User kicked successfully
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
exports.kickUser = async (req, res) => {
  try {
    const { telegramUserId } = req.params;
    const { reason = 'Admin action' } = req.body;

    const telegramUser = await TelegramUser.findOne({ telegramUserId })
      .populate('groupMemberships.telegramGroup');

    if (!telegramUser) {
      return res.status(404).json({
        error: 'Telegram user not found'
      });
    }

    let kickedCount = 0;

    for (const membership of telegramUser.activeMemberships) {
      try {
        await telegramBotService.kickUserFromGroup(
          membership.chatId,
          parseInt(telegramUserId),
          reason
        );

        await telegramUser.removeGroupMembership(
          membership.telegramGroup._id,
          'kicked'
        );

        kickedCount++;
      } catch (error) {
        logger.error('Error kicking user from group', {
          error: error.message,
          telegramUserId,
          groupId: membership.telegramGroup._id
        });
      }
    }

    logger.info('User kicked from groups', {
      telegramUserId,
      kickedCount,
      reason,
      triggeredBy: req.user._id
    });

    res.json({
      success: true,
      message: 'User kicked from groups',
      kickedCount
    });

  } catch (error) {
    logger.error('Error kicking user', {
      error: error.message,
      telegramUserId: req.params.telegramUserId
    });

    res.status(500).json({
      error: 'Failed to kick user',
      details: error.message
    });
  }
};

/**
 * @swagger
 * /api/telegram/admin/stats:
 *   get:
 *     summary: Get Telegram bot statistics (Admin only)
 *     tags: [Telegram]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *       500:
 *         description: Server error
 */
exports.getStatistics = async (req, res) => {
  try {
    const [
      totalGroups,
      activeGroups,
      totalUsers,
      activeLinks,
      expiredLinks
    ] = await Promise.all([
      TelegramGroup.countDocuments(),
      TelegramGroup.countDocuments({ isActive: true }),
      TelegramUser.countDocuments(),
      TelegramInviteLink.countDocuments({ status: 'active' }),
      TelegramInviteLink.countDocuments({ status: 'expired' })
    ]);

    const stats = {
      groups: {
        total: totalGroups,
        active: activeGroups,
        inactive: totalGroups - activeGroups
      },
      users: {
        total: totalUsers
      },
      links: {
        active: activeLinks,
        expired: expiredLinks,
        total: activeLinks + expiredLinks
      }
    };

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    logger.error('Error getting statistics', { error: error.message });
    res.status(500).json({
      error: 'Failed to get statistics',
      details: error.message
    });
  }
};