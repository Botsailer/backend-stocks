const TelegramGroup = require('../models/TelegramGroup');
const TelegramUser = require('../models/TelegramUser');
const TelegramInviteLink = require('../models/TelegramInviteLink');
const User = require('../models/user');
const Subscription = require('../models/subscription');
const telegramBotService = require('../config/telegramBot');
const winston = require('winston');

class TelegramService {
  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          return `${timestamp} [${level.toUpperCase()}] Telegram Service: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
        })
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/telegram-service.log' })
      ]
    });
  }

  // Create or update telegram group mapping
  async createGroupMapping(groupData) {
    try {
      const {
        chatId,
        groupTitle,
        groupUsername,
        productType,
        productId,
        category,
        createdBy,
        welcomeMessage,
        maxMembers
      } = groupData;

      // Check if group already exists
      let telegramGroup = await TelegramGroup.findOne({ chatId });
      
      if (telegramGroup) {
        // Update existing group
        telegramGroup.groupTitle = groupTitle || telegramGroup.groupTitle;
        telegramGroup.groupUsername = groupUsername || telegramGroup.groupUsername;
        telegramGroup.productType = productType || telegramGroup.productType;
        telegramGroup.productId = productId || telegramGroup.productId;
        telegramGroup.category = category || telegramGroup.category;
        telegramGroup.welcomeMessage = welcomeMessage || telegramGroup.welcomeMessage;
        telegramGroup.maxMembers = maxMembers || telegramGroup.maxMembers;
        telegramGroup.isActive = true;
        
        await telegramGroup.save();
        this.logger.info('Telegram group updated', { groupId: telegramGroup._id });
      } else {
        // Create new group
        telegramGroup = new TelegramGroup({
          chatId,
          groupTitle,
          groupUsername,
          productType,
          productId,
          category: category || 'basic',
          createdBy,
          welcomeMessage: welcomeMessage || 'Welcome to the trading group!',
          maxMembers: maxMembers || null,
          botUserId: (await telegramBotService.getBot().getMe()).id.toString(),
          isActive: true
        });
        
        await telegramGroup.save();
        this.logger.info('Telegram group created', { groupId: telegramGroup._id });
      }

      return telegramGroup;
    } catch (error) {
      this.logger.error('Error creating group mapping', { error: error.message });
      throw error;
    }
  }

  // Generate access link for user
  async generateAccessLink(userId, productType, productId, subscriptionId) {
    try {
      // Find the associated telegram group
      const telegramGroup = await TelegramGroup.findOne({ 
        productType, 
        productId,
        isActive: true 
      });

      if (!telegramGroup) {
        throw new Error('No Telegram group found for this product');
      }

      // Get user's subscription
      const subscription = await Subscription.findById(subscriptionId)
        .populate('user');

      if (!subscription || subscription.user._id.toString() !== userId.toString()) {
        throw new Error('Invalid subscription');
      }

      if (subscription.status !== 'active') {
        throw new Error('Subscription is not active');
      }

      // Check if user already has an active link for this product
      const existingLink = await TelegramInviteLink.findOne({
        requestedBy: userId,
        telegramGroup: telegramGroup._id,
        status: 'active'
      });

      if (existingLink && existingLink.isValid) {
        this.logger.info('Returning existing active link', { 
          linkId: existingLink.linkId,
          userId 
        });
        return existingLink;
      }

      // Generate new invite link from Telegram
      const linkExpiry = new Date();
      linkExpiry.setHours(linkExpiry.getHours() + 24); // Link expires in 24 hours

      const telegramInviteUrl = await telegramBotService.generateInviteLink(
        telegramGroup.chatId,
        linkExpiry,
        1 // One-time use
      );

      // Create database record
      const inviteLink = new TelegramInviteLink({
        inviteLink: telegramInviteUrl,
        telegramGroup: telegramGroup._id,
        productType,
        productId,
        requestedBy: userId,
        subscription: subscriptionId,
        linkType: 'subscription_based',
        maxUses: 1,
        expiresAt: linkExpiry,
        subscriptionExpiresAt: subscription.expiresAt,
        status: 'active'
      });

      await inviteLink.save();

      this.logger.info('Access link generated', { 
        linkId: inviteLink.linkId,
        userId,
        productType,
        productId 
      });

      return inviteLink;
    } catch (error) {
      this.logger.error('Error generating access link', { 
        error: error.message,
        userId,
        productType,
        productId 
      });
      throw error;
    }
  }

  // Handle user joining via link
  async handleUserJoinedViaLink(linkId, telegramUserId, telegramUserData) {
    try {
      // Find the invite link
      const inviteLink = await TelegramInviteLink.findOne({ linkId })
        .populate('telegramGroup')
        .populate('subscription');

      if (!inviteLink || !inviteLink.isValid) {
        throw new Error('Invalid or expired link');
      }

      // Use the link
      await inviteLink.useLink(inviteLink.requestedBy, telegramUserId);

      // Find or create telegram user record
      let telegramUser = await TelegramUser.findOne({ 
        telegramUserId: telegramUserId.toString() 
      });

      if (!telegramUser) {
        telegramUser = new TelegramUser({
          user: inviteLink.requestedBy,
          telegramUserId: telegramUserId.toString(),
          username: telegramUserData.username,
          firstName: telegramUserData.first_name,
          lastName: telegramUserData.last_name
        });
      }

      // Add group membership
      await telegramUser.addGroupMembership({
        telegramGroup: inviteLink.telegramGroup._id,
        chatId: inviteLink.telegramGroup.chatId,
        joinedViaLink: inviteLink._id,
        subscription: inviteLink.subscription._id,
        subscriptionExpiresAt: inviteLink.subscription.expiresAt
      });

      // Update group member count
      const memberCount = await telegramBotService.getChatMembersCount(
        inviteLink.telegramGroup.chatId
      );
      
      await TelegramGroup.findByIdAndUpdate(inviteLink.telegramGroup._id, {
        totalMembers: memberCount,
        activeMembers: memberCount
      });

      this.logger.info('User joined via link', { 
        linkId,
        telegramUserId,
        groupId: inviteLink.telegramGroup._id 
      });

      return {
        success: true,
        telegramUser,
        group: inviteLink.telegramGroup
      };
    } catch (error) {
      this.logger.error('Error handling user joined via link', { 
        error: error.message,
        linkId,
        telegramUserId 
      });
      throw error;
    }
  }

  // Remove expired users from groups
  async removeExpiredUsers() {
    try {
      const now = new Date();
      
      // Find all users with expired subscriptions
      const expiredUsers = await TelegramUser.find({
        'groupMemberships.status': 'active',
        'groupMemberships.subscriptionExpiresAt': { $lt: now }
      }).populate('groupMemberships.telegramGroup');

      let removedCount = 0;

      for (const telegramUser of expiredUsers) {
        for (const membership of telegramUser.groupMemberships) {
          if (membership.status === 'active' && 
              membership.subscriptionExpiresAt < now) {
            
            try {
              // Kick user from Telegram group
              await telegramBotService.kickUserFromGroup(
                membership.chatId,
                parseInt(telegramUser.telegramUserId),
                'Subscription expired'
              );

              // Update membership status
              await telegramUser.removeGroupMembership(
                membership.telegramGroup._id, 
                'kicked'
              );

              // Cancel subscription
              await Subscription.findByIdAndUpdate(membership.subscription, {
                status: 'expired'
              });

              removedCount++;

              this.logger.info('Expired user removed from group', {
                telegramUserId: telegramUser.telegramUserId,
                groupId: membership.telegramGroup._id,
                reason: 'subscription_expired'
              });

            } catch (error) {
              this.logger.error('Error removing expired user', {
                error: error.message,
                telegramUserId: telegramUser.telegramUserId,
                groupId: membership.telegramGroup._id
              });
            }
          }
        }
      }

      this.logger.info('Expired users cleanup completed', { removedCount });
      return removedCount;
    } catch (error) {
      this.logger.error('Error during expired users cleanup', { error: error.message });
      throw error;
    }
  }

  // Remove users with failed payments
  async removeUsersWithFailedPayments(razorpaySubscriptionId) {
    try {
      // Find subscriptions with failed payments
      const failedSubscriptions = await Subscription.find({
        razorpaySubscriptionId,
        status: 'active'
      });

      let removedCount = 0;

      for (const subscription of failedSubscriptions) {
        // Find telegram users associated with this subscription
        const telegramUsers = await TelegramUser.find({
          'groupMemberships.subscription': subscription._id,
          'groupMemberships.status': 'active'
        }).populate('groupMemberships.telegramGroup');

        for (const telegramUser of telegramUsers) {
          for (const membership of telegramUser.groupMemberships) {
            if (membership.subscription.toString() === subscription._id.toString() &&
                membership.status === 'active') {
              
              try {
                // Kick user from Telegram group
                await telegramBotService.kickUserFromGroup(
                  membership.chatId,
                  parseInt(telegramUser.telegramUserId),
                  'Payment failed'
                );

                // Update membership status
                await telegramUser.removeGroupMembership(
                  membership.telegramGroup._id,
                  'kicked'
                );

                removedCount++;

                this.logger.info('User removed due to payment failure', {
                  telegramUserId: telegramUser.telegramUserId,
                  groupId: membership.telegramGroup._id,
                  subscriptionId: subscription._id
                });

              } catch (error) {
                this.logger.error('Error removing user due to payment failure', {
                  error: error.message,
                  telegramUserId: telegramUser.telegramUserId,
                  subscriptionId: subscription._id
                });
              }
            }
          }
        }

        // Update subscription status
        await Subscription.findByIdAndUpdate(subscription._id, {
          status: 'cancelled'
        });
      }

      this.logger.info('Payment failure cleanup completed', { removedCount });
      return removedCount;
    } catch (error) {
      this.logger.error('Error during payment failure cleanup', { error: error.message });
      throw error;
    }
  }

  // Get user's telegram groups
  async getUserGroups(userId) {
    try {
      const telegramUser = await TelegramUser.findOne({ user: userId })
        .populate({
          path: 'groupMemberships.telegramGroup',
          populate: {
            path: 'productId',
            refPath: 'productType'
          }
        })
        .populate('groupMemberships.subscription');

      if (!telegramUser) {
        return [];
      }

      return telegramUser.activeMemberships.map(membership => ({
        group: membership.telegramGroup,
        subscription: membership.subscription,
        joinedAt: membership.joinedAt,
        expiresAt: membership.subscriptionExpiresAt,
        status: membership.status
      }));
    } catch (error) {
      this.logger.error('Error getting user groups', { 
        error: error.message, 
        userId 
      });
      throw error;
    }
  }

  // Cleanup expired links
  async cleanupExpiredLinks() {
    try {
      const now = new Date();
      
      // Find expired links
      const expiredLinks = await TelegramInviteLink.find({
        $or: [
          { expiresAt: { $lt: now } },
          { subscriptionExpiresAt: { $lt: now } }
        ],
        status: 'active'
      });

      for (const link of expiredLinks) {
        // Revoke the Telegram invite link
        try {
          await telegramBotService.revokeInviteLink(link.inviteLink);
        } catch (error) {
          this.logger.warn('Could not revoke telegram link', { 
            linkId: link.linkId,
            error: error.message 
          });
        }

        // Update link status
        link.status = 'expired';
        await link.save();
      }

      this.logger.info('Expired links cleanup completed', { 
        expiredCount: expiredLinks.length 
      });
      
      return expiredLinks.length;
    } catch (error) {
      this.logger.error('Error during expired links cleanup', { error: error.message });
      throw error;
    }
  }
}

module.exports = new TelegramService();