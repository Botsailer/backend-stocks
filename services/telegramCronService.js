const cron = require('node-cron');
const telegramService = require('./telegramService');
const winston = require('winston');

class TelegramCronService {
  constructor() {
    this.jobs = new Map();
    this.isRunning = false;
    
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          return `${timestamp} [${level.toUpperCase()}] Telegram Cron: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
        })
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/telegram-cron.log' })
      ]
    });
  }

  start() {
    if (this.isRunning) {
      this.logger.warn('Telegram cron service is already running');
      return;
    }

    try {
      // Remove expired users every 30 minutes
      this.jobs.set('expiredUsers', cron.schedule('*/30 * * * *', async () => {
        try {
          this.logger.info('Starting expired users cleanup');
          const removedCount = await telegramService.removeExpiredUsers();
          this.logger.info('Expired users cleanup completed', { removedCount });
        } catch (error) {
          this.logger.error('Error during expired users cleanup', { error: error.message });
        }
      }, {
        scheduled: true,
        timezone: "Asia/Kolkata" // Adjust timezone as needed
      }));

      // Cleanup expired links every hour
      this.jobs.set('expiredLinks', cron.schedule('0 * * * *', async () => {
        try {
          this.logger.info('Starting expired links cleanup');
          const expiredCount = await telegramService.cleanupExpiredLinks();
          this.logger.info('Expired links cleanup completed', { expiredCount });
        } catch (error) {
          this.logger.error('Error during expired links cleanup', { error: error.message });
        }
      }, {
        scheduled: true,
        timezone: "Asia/Kolkata"
      }));

      // Daily subscription expiry check (runs at 9 AM daily)
      this.jobs.set('dailySubscriptionCheck', cron.schedule('0 9 * * *', async () => {
        try {
          this.logger.info('Starting daily subscription expiry check');
          const removedCount = await telegramService.removeExpiredUsers();
          this.logger.info('Daily subscription check completed', { removedCount });
          
          // Also cleanup links
          const expiredLinksCount = await telegramService.cleanupExpiredLinks();
          this.logger.info('Daily links cleanup completed', { expiredLinksCount });
        } catch (error) {
          this.logger.error('Error during daily subscription check', { error: error.message });
        }
      }, {
        scheduled: true,
        timezone: "Asia/Kolkata"
      }));

      // Send subscription expiry reminders (runs at 10 AM daily)
      this.jobs.set('subscriptionReminders', cron.schedule('0 10 * * *', async () => {
        try {
          this.logger.info('Starting subscription expiry reminders');
          await this.sendSubscriptionReminders();
        } catch (error) {
          this.logger.error('Error sending subscription reminders', { error: error.message });
        }
      }, {
        scheduled: true,
        timezone: "Asia/Kolkata"
      }));

      // Update group member counts every 6 hours
      this.jobs.set('updateMemberCounts', cron.schedule('0 */6 * * *', async () => {
        try {
          this.logger.info('Starting member count update');
          await this.updateGroupMemberCounts();
        } catch (error) {
          this.logger.error('Error updating member counts', { error: error.message });
        }
      }, {
        scheduled: true,
        timezone: "Asia/Kolkata"
      }));

      this.isRunning = true;
      this.logger.info('Telegram cron service started successfully', { 
        jobs: Array.from(this.jobs.keys()) 
      });

    } catch (error) {
      this.logger.error('Failed to start telegram cron service', { error: error.message });
      throw error;
    }
  }

  stop() {
    if (!this.isRunning) {
      this.logger.warn('Telegram cron service is not running');
      return;
    }

    try {
      this.jobs.forEach((job, name) => {
        job.stop();
        this.logger.info('Stopped cron job', { jobName: name });
      });

      this.jobs.clear();
      this.isRunning = false;
      this.logger.info('Telegram cron service stopped successfully');

    } catch (error) {
      this.logger.error('Error stopping telegram cron service', { error: error.message });
      throw error;
    }
  }

  restart() {
    this.logger.info('Restarting telegram cron service');
    this.stop();
    this.start();
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      activeJobs: Array.from(this.jobs.keys()),
      jobCount: this.jobs.size
    };
  }

  async sendSubscriptionReminders() {
    try {
      const TelegramUser = require('../models/TelegramUser');
      const telegramBotService = require('../config/telegramBot');
      
      // Find users whose subscriptions expire in 3 days
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
      
      const usersToRemind = await TelegramUser.find({
        'groupMemberships.status': 'active',
        'groupMemberships.subscriptionExpiresAt': {
          $gte: new Date(),
          $lte: threeDaysFromNow
        },
        'notifications.subscriptionReminders': true
      }).populate('groupMemberships.telegramGroup');

      let remindersSent = 0;

      for (const telegramUser of usersToRemind) {
        try {
          const expiringMemberships = telegramUser.groupMemberships.filter(m => 
            m.status === 'active' && 
            m.subscriptionExpiresAt <= threeDaysFromNow &&
            m.subscriptionExpiresAt >= new Date()
          );

          if (expiringMemberships.length > 0) {
            const daysLeft = Math.ceil(
              (expiringMemberships[0].subscriptionExpiresAt - new Date()) / (1000 * 60 * 60 * 24)
            );

            const reminderMessage = `
⚠️ *Subscription Expiry Reminder*

Your subscription for the following groups will expire in ${daysLeft} day(s):

${expiringMemberships.map(m => `• ${m.telegramGroup.groupTitle}`).join('\n')}

Please renew your subscription to continue accessing these premium groups.

Visit our platform to renew: [Renew Subscription](${process.env.FRONTEND_URL || 'https://yourplatform.com'})
            `;

            // Send direct message to user
            await telegramBotService.sendMessage(
              telegramUser.telegramUserId,
              reminderMessage,
              { parse_mode: 'Markdown' }
            );

            remindersSent++;
          }
        } catch (error) {
          this.logger.error('Error sending reminder to user', {
            error: error.message,
            telegramUserId: telegramUser.telegramUserId
          });
        }
      }

      this.logger.info('Subscription reminders sent', { remindersSent });
      return remindersSent;

    } catch (error) {
      this.logger.error('Error in sendSubscriptionReminders', { error: error.message });
      throw error;
    }
  }

  async updateGroupMemberCounts() {
    try {
      const TelegramGroup = require('../models/TelegramGroup');
      const telegramBotService = require('../config/telegramBot');

      const activeGroups = await TelegramGroup.find({ isActive: true });
      let updatedCount = 0;

      for (const group of activeGroups) {
        try {
          const memberCount = await telegramBotService.getChatMembersCount(group.chatId);
          
          await TelegramGroup.findByIdAndUpdate(group._id, {
            totalMembers: memberCount,
            activeMembers: memberCount // Simplified - you might want to calculate active differently
          });

          updatedCount++;
        } catch (error) {
          this.logger.error('Error updating member count for group', {
            error: error.message,
            groupId: group._id,
            chatId: group.chatId
          });
        }
      }

      this.logger.info('Group member counts updated', { updatedCount });
      return updatedCount;

    } catch (error) {
      this.logger.error('Error in updateGroupMemberCounts', { error: error.message });
      throw error;
    }
  }

  // Manual trigger methods for testing
  async triggerExpiredUsersCleanup() {
    this.logger.info('Manually triggering expired users cleanup');
    return await telegramService.removeExpiredUsers();
  }

  async triggerExpiredLinksCleanup() {
    this.logger.info('Manually triggering expired links cleanup');
    return await telegramService.cleanupExpiredLinks();
  }

  async triggerSubscriptionReminders() {
    this.logger.info('Manually triggering subscription reminders');
    return await this.sendSubscriptionReminders();
  }

  async triggerMemberCountUpdate() {
    this.logger.info('Manually triggering member count update');
    return await this.updateGroupMemberCounts();
  }
}

// Singleton instance
const telegramCronService = new TelegramCronService();

module.exports = telegramCronService;