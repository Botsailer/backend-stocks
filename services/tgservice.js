const axios = require('axios');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/telegram-service.log' })
  ]
});

const TELEGRAM_BOT_API_URL = process.env.TELEGRAM_BOT_API_URL || 'http://89.116.121.11:5000';
const INVITE_EXPIRY_DAYS = process.env.TELEGRAM_INVITE_EXPIRY_DAYS || 7;

class TelegramService {
  /**
   * Get Telegram group mapping for a product
   * @param {string} productId - Product ID
   * @returns {Promise<Object|null>} Telegram group info
   */
  static async getGroupMapping(productId) {
    try {
      const response = await axios.get(`${TELEGRAM_BOT_API_URL}/products/${productId}`);
      
      if (response.data && response.data.telegram_group) {
        return response.data.telegram_group;
      }
      return null;
    } catch (error) {
      this.handleError(error, `getGroupMapping for product ${productId}`);
      return null;
    }
  }

  /**
   * Generate Telegram invite link
   * @param {string} productId - Product ID
   * @returns {Promise<Object>} Invite link data
   */
  static async generateInviteLink(productId) {
    try {
      const response = await axios.post(
        `${TELEGRAM_BOT_API_URL}/telegram/invite/regenerate`,
        { product_id: productId }
      );
      
      return {
        success: true,
        invite_link: response.data.invite_link,
        expires_at: new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
      };
    } catch (error) {
      this.handleError(error, `generateInviteLink for product ${productId}`);
      return {
        success: false,
        error: 'Failed to generate Telegram invite'
      };
    }
  }

  /**
   * Kick user from Telegram group
   * @param {string} productId - Product ID
   * @param {string} telegramUserId - Telegram user ID
   * @returns {Promise<Object>} Operation result
   */
  static async kickUser(productId, telegramUserId) {
    try {
      const response = await axios.post(
        `${TELEGRAM_BOT_API_URL}/telegram/kick-user`,
        {
          product_id: productId,
          telegram_user_id: telegramUserId
        },
        {
          timeout: 10000 // 10 seconds timeout
        }
      );
        logger.info(`Telegram kickUser response for product ${productId}:`, response.data);

      if (response.data && response.data.success) {
        return { success: true };
      }


      
      return {
        success: false,
        error: response.data?.message || 'Unknown error'
      };
    } catch (error) {
      let errorMessage = 'Network error';
      
      if (error.response) {
        errorMessage = `API error: ${error.response.status} - ${error.response.data?.error || 'No details'}`;
      } else if (error.request) {
        errorMessage = 'No response from Telegram API';
      }
      
      logger.error(`Telegram kickUser failed:`, {
        productId,
        telegramUserId,
        error: errorMessage
      });
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Handle API errors consistently
   * @param {Error} error - Original error
   * @param {string} context - Operation context
   */
  static handleError(error, context) {
    const errorData = {
      context,
      message: error.message,
      stack: error.stack
    };
    
    if (error.response) {
      errorData.status = error.response.status;
      errorData.responseData = error.response.data;
    }
    
    logger.error('Telegram API Error', errorData);
  }
}

module.exports = TelegramService;
