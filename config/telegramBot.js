const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const winston = require('winston');

// Models
const TelegramGroup = require('../models/TelegramGroup');
const TelegramUser = require('../models/TelegramUser');
const TelegramInviteLink = require('../models/TelegramInviteLink');
const User = require('../models/user');
const Subscription = require('../models/subscription');

class TelegramBotService {
  constructor() {
    this.bot = null;
    this._isInitialized = false;
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          return `${timestamp} [${level.toUpperCase()}] Telegram Bot: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
        })
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/telegram-bot.log' })
      ]
    });
  }

  async initialize() {
    try {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) {
        throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
      }

      // First, try to delete webhook to ensure clean polling
      try {
        const tempBot = new TelegramBot(token);
        await tempBot.deleteWebhook();
        tempBot.close();
      } catch (webhookError) {
        this.logger.warn('Could not delete webhook', { error: webhookError.message });
      }

      // Initialize bot with polling and proper error handling
      this.bot = new TelegramBot(token, { 
        polling: {
          autoStart: false,
          params: {
            timeout: 10
          }
        }
      });

      this.setupEventHandlers();
      
      // Start polling with retry logic
      await this.startPolling();
      
      this._isInitialized = true;
      this.logger.info('Telegram bot initialized successfully');
      
      // Get bot info
      const me = await this.bot.getMe();
      this.logger.info('Bot info', { username: me.username, id: me.id });
      
      return true;
    } catch (error) {
      this.logger.error('Failed to initialize Telegram bot', { error: error.message });
      throw error;
    }
  }

  async startPolling() {
    try {
      await this.bot.startPolling();
      this.logger.info('Bot polling started successfully');
    } catch (error) {
      if (error.message.includes('409 Conflict')) {
        this.logger.warn('Bot polling conflict detected, retrying in 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        await this.startPolling();
      } else {
        throw error;
      }
    }
  }

  async stop() {
    if (this.bot) {
      try {
        await this.bot.stopPolling();
        this.bot.close();
        this._isInitialized = false;
        this.logger.info('Telegram bot stopped successfully');
      } catch (error) {
        this.logger.error('Error stopping bot', { error: error.message });
      }
    }
  }

  setupEventHandlers() {
    // Handle new chat members
    this.bot.on('new_chat_members', async (msg) => {
      try {
        await this.handleNewChatMembers(msg);
      } catch (error) {
        this.logger.error('Error handling new chat members', { error: error.message, chatId: msg.chat.id });
      }
    });

    // Handle when members leave
    this.bot.on('left_chat_member', async (msg) => {
      try {
        await this.handleLeftChatMember(msg);
      } catch (error) {
        this.logger.error('Error handling left chat member', { error: error.message, chatId: msg.chat.id });
      }
    });

    // Handle bot commands
    this.bot.onText(/\/start/, (msg) => this.handleStartCommand(msg));
    this.bot.onText(/\/help/, (msg) => this.handleHelpCommand(msg));
    this.bot.onText(/\/status/, (msg) => this.handleStatusCommand(msg));

    // Handle errors
    this.bot.on('error', (error) => {
      this.logger.error('Telegram bot error', { error: error.message });
    });

    // Handle polling errors
    this.bot.on('polling_error', (error) => {
      this.logger.error('Telegram bot polling error', { error: error.message });
    });
  }

  async handleNewChatMembers(msg) {
    const chatId = msg.chat.id.toString();
    const newMembers = msg.new_chat_members;

    for (const member of newMembers) {
      if (member.is_bot) continue; // Skip bots

      this.logger.info('New member joined', { 
        chatId, 
        userId: member.id, 
        username: member.username 
      });

      // Find the telegram group
      const telegramGroup = await TelegramGroup.findOne({ chatId });
      if (!telegramGroup) {
        this.logger.warn('Group not registered in database', { chatId });
        continue;
      }

      // Send welcome message
      if (telegramGroup.welcomeMessage) {
        try {
          await this.bot.sendMessage(chatId, telegramGroup.welcomeMessage);
        } catch (error) {
          this.logger.error('Failed to send welcome message', { error: error.message });
        }
      }
    }
  }

  async handleLeftChatMember(msg) {
    const chatId = msg.chat.id.toString();
    const leftMember = msg.left_chat_member;

    if (leftMember.is_bot) return; // Skip bots

    this.logger.info('Member left', { 
      chatId, 
      userId: leftMember.id, 
      username: leftMember.username 
    });

    // Update user's group membership status
    try {
      const telegramUser = await TelegramUser.findOne({ 
        telegramUserId: leftMember.id.toString() 
      });
      
      if (telegramUser) {
        const telegramGroup = await TelegramGroup.findOne({ chatId });
        if (telegramGroup) {
          await telegramUser.removeGroupMembership(telegramGroup._id, 'left');
          this.logger.info('Updated user membership status to left');
        }
      }
    } catch (error) {
      this.logger.error('Error updating left member status', { error: error.message });
    }
  }

  async handleStartCommand(msg) {
    const chatId = msg.chat.id;
    const welcomeText = `
🤖 *Welcome to Stock Trading Bot!*

This bot manages your access to premium trading groups based on your subscription status.

Available commands:
/help - Show this help message
/status - Check your subscription status
/groups - List your active groups

For support, contact our team.
    `;

    try {
      await this.bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' });
    } catch (error) {
      this.logger.error('Error sending start message', { error: error.message });
    }
  }

  async handleHelpCommand(msg) {
    const chatId = msg.chat.id;
    const helpText = `
📚 *Help & Commands*

*User Commands:*
/start - Start the bot
/help - Show this help
/status - Check subscription status
/groups - List your groups

*How it works:*
1. Subscribe to a portfolio/bundle on our platform
2. Get an invite link for the corresponding Telegram group  
3. Join the group using the link
4. Access expires automatically with your subscription

*Need Support?*
Contact our support team for assistance.
    `;

    try {
      await this.bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
    } catch (error) {
      this.logger.error('Error sending help message', { error: error.message });
    }
  }

  async handleStatusCommand(msg) {
    const chatId = msg.chat.id;
    const telegramUserId = msg.from.id.toString();

    try {
      const telegramUser = await TelegramUser.findOne({ telegramUserId })
        .populate('groupMemberships.telegramGroup')
        .populate('groupMemberships.subscription');

      if (!telegramUser) {
        await this.bot.sendMessage(chatId, 
          "❌ No account found. Please subscribe on our platform first.");
        return;
      }

      const activeMemberships = telegramUser.activeMemberships;
      
      if (activeMemberships.length === 0) {
        await this.bot.sendMessage(chatId, 
          "📊 You have no active group memberships.");
        return;
      }

      let statusText = "📊 *Your Active Memberships:*\n\n";
      
      for (const membership of activeMemberships) {
        const group = membership.telegramGroup;
        const expiryDate = new Date(membership.subscriptionExpiresAt);
        const daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
        
        statusText += `🏷️ *${group.groupTitle}*\n`;
        statusText += `📅 Expires: ${expiryDate.toLocaleDateString()}\n`;
        statusText += `⏰ Days left: ${daysLeft > 0 ? daysLeft : 'Expired'}\n`;
        statusText += `📈 Category: ${group.category}\n\n`;
      }

      await this.bot.sendMessage(chatId, statusText, { parse_mode: 'Markdown' });

    } catch (error) {
      this.logger.error('Error handling status command', { error: error.message });
      await this.bot.sendMessage(chatId, 
        "❌ Error retrieving status. Please try again later.");
    }
  }

  // Admin methods for group management
  async createGroup(groupData) {
    try {
      // Create the group in database
      const telegramGroup = new TelegramGroup(groupData);
      await telegramGroup.save();
      
      this.logger.info('Telegram group created in database', { 
        groupId: telegramGroup._id,
        chatId: groupData.chatId,
        productType: groupData.productType
      });
      
      return telegramGroup;
    } catch (error) {
      this.logger.error('Error creating telegram group', { error: error.message });
      throw error;
    }
  }

  async kickUserFromGroup(chatId, userId, reason = 'Subscription expired') {
    try {
      await this.bot.kickChatMember(chatId, userId);
      this.logger.info('User kicked from group', { chatId, userId, reason });
      
      // Immediately unban to allow rejoining with new subscription
      setTimeout(async () => {
        try {
          await this.bot.unbanChatMember(chatId, userId);
          this.logger.info('User unbanned from group', { chatId, userId });
        } catch (error) {
          this.logger.error('Error unbanning user', { error: error.message });
        }
      }, 5000); // Wait 5 seconds before unbanning
      
      return true;
    } catch (error) {
      this.logger.error('Error kicking user from group', { 
        error: error.message, 
        chatId, 
        userId 
      });
      throw error;
    }
  }

  async generateInviteLink(chatId, expireDate = null, memberLimit = 1) {
    try {
      const linkData = {
        expire_date: expireDate ? Math.floor(expireDate.getTime() / 1000) : undefined,
        member_limit: memberLimit
      };

      const inviteLink = await this.bot.createChatInviteLink(chatId, linkData);
      
      this.logger.info('Invite link generated', { 
        chatId, 
        inviteLink: inviteLink.invite_link,
        expireDate,
        memberLimit 
      });
      
      return inviteLink.invite_link;
    } catch (error) {
      this.logger.error('Error generating invite link', { 
        error: error.message, 
        chatId 
      });
      throw error;
    }
  }

  async revokeInviteLink(inviteLink) {
    try {
      await this.bot.revokeChatInviteLink(inviteLink);
      this.logger.info('Invite link revoked', { inviteLink });
      return true;
    } catch (error) {
      this.logger.error('Error revoking invite link', { 
        error: error.message, 
        inviteLink 
      });
      throw error;
    }
  }

  async sendMessage(chatId, message, options = {}) {
    try {
      return await this.bot.sendMessage(chatId, message, options);
    } catch (error) {
      this.logger.error('Error sending message', { 
        error: error.message, 
        chatId 
      });
      throw error;
    }
  }

  async getChatMembersCount(chatId) {
    try {
      return await this.bot.getChatMembersCount(chatId);
    } catch (error) {
      this.logger.error('Error getting chat members count', { 
        error: error.message, 
        chatId 
      });
      return 0;
    }
  }

  isInitialized() {
    return this._isInitialized;
  }

  getBot() {
    return this.bot;
  }
}

// Singleton instance
const telegramBotService = new TelegramBotService();

module.exports = telegramBotService;