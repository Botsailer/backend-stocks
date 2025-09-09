const axios = require('axios');
const winston = require('winston');
const Portfolio = require('../models/modelPortFolio');
const Bundle = require('../models/bundle');
const User = require('../models/user');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/telegram-service.log' })
  ],
});

class TelegramService {
  constructor() {
    const baseURL = process.env.TELEGRAM_API_BASE_URL;
    const apiToken = process.env.TELEGRAM_API_TOKEN;

    if (!baseURL || !apiToken) {
      logger.error('Telegram service is not configured. Please set TELEGRAM_API_BASE_URL and TELEGRAM_API_TOKEN environment variables.');
      // Fallback to a dummy client to prevent crashes
      this.api = {
        post: () => Promise.reject(new Error('Telegram service not configured')),
        get: () => Promise.reject(new Error('Telegram service not configured')),
        put: () => Promise.reject(new Error('Telegram service not configured')),
        delete: () => Promise.reject(new Error('Telegram service not configured')),
      };
      this.isConfigured = false;
    } else {
        this.api = axios.create({
            baseURL,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiToken}`
            }
        });

        this.api.interceptors.response.use(
            response => response,
            error => {
                const { config, response } = error;
                const logData = {
                    url: config.url,
                    method: config.method,
                    status: response?.status,
                    data: response?.data,
                };
                logger.error('Telegram API Error', logData);
                return Promise.reject(error);
            }
        );
        this.isConfigured = true;
    }
  }

  // ===== Product API =====

  async createProduct(productData) {
    if (!this.isConfigured) return { success: false, error: 'Telegram service not configured' };
    try {
      const response = await this.api.post('/products', productData);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  async getProduct(productId) {
    if (!this.isConfigured) return { success: false, error: 'Telegram service not configured' };
    try {
      const response = await this.api.get(`/products/${productId}`);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  async updateProduct(productId, productData) {
    if (!this.isConfigured) return { success: false, error: 'Telegram service not configured' };
    try {
      const response = await this.api.put(`/products/${productId}`, productData);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  async deleteProduct(productId) {
    if (!this.isConfigured) return { success: false, error: 'Telegram service not configured' };
    try {
      await this.api.delete(`/products/${productId}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  // ===== Group API =====

  async getAllGroups() {
    if (!this.isConfigured) return { success: false, error: 'Telegram service not configured' };
    try {
      const response = await this.api.get('/groups');
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  async getUnmappedGroups() {
    if (!this.isConfigured) return { success: false, error: 'Telegram service not configured' };
    try {
      const response = await this.api.get('/groups/unmapped');
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  async mapProductToGroup(productId, groupData) {
    if (!this.isConfigured) return { success: false, error: 'Telegram service not configured' };
    try {
      const response = await this.api.post(`/products/${productId}/map`, groupData);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  async unmapProductFromGroup(productId) {
    if (!this.isConfigured) return { success: false, error: 'Telegram service not configured' };
    try {
      await this.api.delete(`/products/${productId}/unmap`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  // ===== Subscription API =====

  async createSubscription(subscriptionData) {
    if (!this.isConfigured) return { success: false, error: 'Telegram service not configured' };
    try {
      const response = await this.api.post('/subscribe', subscriptionData);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  async cancelSubscription(email, productId) {
    if (!this.isConfigured) return { success: false, error: 'Telegram service not configured' };
    try {
      const response = await this.api.delete('/subscriptions', {
        data: { email, product_id: productId }
      });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  // ===== High-level Business Logic =====

  async generateInviteLink(user, product, subscription) {
    if (!this.isConfigured) return { success: false, error: 'Telegram service not configured' };
    if (!product.telegramProductId) {
      logger.warn('Cannot generate invite link: product is not synced with Telegram service.', { productId: product._id });
      return { success: false, error: 'Product not synced with Telegram' };
    }

    const subData = {
      email: user.email,
      product_id: product.telegramProductId,
      expiration_datetime: subscription.expiresAt.toISOString(),
    };

    const result = await this.createSubscription(subData);

    if (result.success) {
      logger.info('Successfully created Telegram subscription and got invite link.', {
        userId: user._id,
        productId: product._id,
        telegramProductId: product.telegramProductId,
      });
      return {
        success: true,
        invite_link: result.data.invite_link,
        expires_at: new Date(result.data.invite_expires_at),
      };
    } else {
      logger.error('Failed to create Telegram subscription.', {
        userId: user._id,
        productId: product._id,
        telegramProductId: product.telegramProductId,
        error: result.error,
      });
      return { success: false, error: result.error };
    }
  }

  async kickUser(userId, productId) {
    if (!this.isConfigured) return { success: false, error: 'Telegram service not configured' };
    const user = await User.findById(userId);
    const product = await Portfolio.findById(productId) || await Bundle.findById(productId);

    if (!user || !product) {
        logger.error('Could not find user or product for kicking.', { userId, productId });
        return { success: false, error: 'User or Product not found' };
    }

    if (!product.telegramProductId) {
        logger.warn('Cannot kick user: product is not synced with Telegram.', { productId });
        return { success: false, error: 'Product not synced with Telegram' };
    }
    const result = await this.cancelSubscription(user.email, product.telegramProductId);
    if (result.success) {
      logger.info(`Successfully kicked user ${user.email} from product ${product.telegramProductId}.`);
    } else {
      logger.error(`Failed to kick user ${user.email} from product ${product.telegramProductId}.`, { error: result.error });
    }
    return { success: result.success };
  }

  async syncWithTelegram() {
    if (!this.isConfigured) return { success: false, error: 'Telegram service not configured' };
    const portfolios = await Portfolio.find({}).select('name description subscriptionFee emandateSubriptionFees telegramProductId');
    const bundles = await Bundle.find({}).select('name description monthlyPrice yearlyPrice telegramProductId');
    
    let createdCount = 0;
    let updatedCount = 0;
    let failedCount = 0;

    const processItem = async (item, type) => {
      let price = 0;
      if (type === 'portfolio') {
          const monthlyFee = item.subscriptionFee.find(f => f.type === 'monthly');
          const emandateMonthlyFee = item.emandateSubriptionFees.find(f => f.type === 'monthly');
          price = monthlyFee?.price || emandateMonthlyFee?.price || item.subscriptionFee[0]?.price || 0;
      } else { // bundle
          price = item.monthlyPrice || item.yearlyPrice || 0;
      }

      const productData = {
        name: item.name,
        description: item.description && item.description.length > 0 ? (typeof item.description === 'string' ? item.description : item.description[0].value) : `${item.name} description`,
        price: price,
      };

      try {
        let result;
        if (item.telegramProductId) {
          result = await this.updateProduct(item.telegramProductId, productData);
          if(result.success) updatedCount++;
          else failedCount++;
        } else {
          result = await this.createProduct(productData);
          if (result.success && result.data.id) {
            item.telegramProductId = result.data.id;
            await item.save();
            createdCount++;
          } else {
            failedCount++;
            logger.error(`Failed to create Telegram product for ${type} ${item.name}`, { error: result.error });
          }
        }
      } catch (e) {
        failedCount++;
        logger.error(`Exception while syncing ${type} ${item.name}`, { error: e.message });
      }
    };

    for (const portfolio of portfolios) {
      await processItem(portfolio, 'portfolio');
    }
    for (const bundle of bundles) {
      await processItem(bundle, 'bundle');
    }

    const summary = {
        success: failedCount === 0,
        created: createdCount,
        updated: updatedCount,
        failed: failedCount,
        total: portfolios.length + bundles.length,
    };
    logger.info('Telegram sync completed.', summary);
    return summary;
  }

  /**
   * Get all telegram groups
   */
  async getAllGroups() {
    try {
      if (!this.baseURL) {
        throw new Error('Telegram API base URL not configured');
      }

      const response = await axios.get(`${this.baseURL}/groups`, {
        headers: this.getHeaders()
      });

      if (response.data && Array.isArray(response.data.data)) {
        return {
          success: true,
          data: response.data.data
        };
      }

      logger.error('Invalid response format from Telegram API getAllGroups', {
        response: response.data
      });
      return {
        success: false,
        error: 'Invalid response format from Telegram API'
      };

    } catch (error) {
      logger.error('Error fetching telegram groups:', {
        error: error.message,
        stack: error.stack
      });
      return {
        success: false,
        error: error.message || 'Failed to fetch telegram groups'
      };
    }
  }

  /**
   * Get all telegram products
   */
  async getAllProducts() {
    try {
      if (!this.baseURL) {
        throw new Error('Telegram API base URL not configured');
      }

      const response = await axios.get(`${this.baseURL}/products`, {
        headers: this.getHeaders()
      });

      if (response.data && Array.isArray(response.data.data)) {
        return {
          success: true,
          data: response.data.data
        };
      }

      logger.error('Invalid response format from Telegram API getAllProducts', {
        response: response.data
      });
      return {
        success: false,
        error: 'Invalid response format from Telegram API'
      };

    } catch (error) {
      logger.error('Error fetching telegram products:', {
        error: error.message,
        stack: error.stack
      });
      return {
        success: false,
        error: error.message || 'Failed to fetch telegram products'
      };
    }
  }
}

module.exports = new TelegramService();