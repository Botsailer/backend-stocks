// services/telegramService.js

const axios = require('axios');
const winston = require('winston');
const Portfolio = require('../models/modelPortFolio');
const Bundle = require('../models/bundle');
const User = require('../models/user');
const { getConfig } = require('../utils/configSettings');

/**
 * Logger setup
 */
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

/**
 * TelegramService
 * Single exported instance intended to manage interaction with the remote Telegram-based API.
 */
class TelegramService {
  constructor() {
    this.api = null;
    this.baseURL = null;
    this.authToken = null;
    this.isConfigured = false;
  }

  /**
   * Initialize configuration and axios instance (idempotent).
   */
  async initConfig() {
    if (this.isConfigured) return;

    try {
      this.baseURL = await getConfig('TELEGRAM_BOT_API_URL');
      this.authToken = await getConfig('TELEGRAM_BOT_TOKEN');

      if (!this.baseURL || !this.authToken) {
        logger.error('Telegram service configuration missing TELEGRAM_BOT_API_URL or TELEGRAM_BOT_TOKEN');
        throw new Error('Telegram service not configured');
      }

      // create axios instance
      this.api = axios.create({
        baseURL: this.baseURL,
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`,
        },
      });

      // request interceptor - could be extended later
      this.api.interceptors.request.use(config => config, error => Promise.reject(error));

      // response interceptor - log errors
      this.api.interceptors.response.use(
        response => response,
        error => {
          const { config = {}, response = {} } = error || {};
          const logData = {
            url: config.url,
            method: config.method,
            status: response.status,
            responseData: response.data,
            message: error.message,
          };
          logger.error('Telegram API Error', logData);
          return Promise.reject(error);
        }
      );

      this.isConfigured = true;
      logger.info('TelegramService configured', { baseURL: this.baseURL });
    } catch (err) {
      logger.error('Failed to initialize TelegramService config', { error: err.message });
      throw err;
    }
  }

  validateConfig() {
    if (!this.isConfigured || !this.api) {
      throw new Error('Telegram service not configured');
    }
  }

  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.authToken}`,
    };
  }

  /* ============================
     Product API
  ============================ */

  async createProduct(productData) {
    try {
      await this.initConfig();
      const res = await this.api.post('/products', productData);
      return { success: true, data: res.data };
    } catch (error) {
      logger.error('createProduct failed', { error: error.message });
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  async getProduct(productId) {
    try {
      await this.initConfig();
      const res = await this.api.get(`/products/${productId}`);
      return { success: true, data: res.data };
    } catch (error) {
      logger.error('getProduct failed', { productId, error: error.message });
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  async updateProduct(productId, productData) {
    try {
      await this.initConfig();
      const res = await this.api.put(`/products/${productId}`, productData);
      return { success: true, data: res.data };
    } catch (error) {
      logger.error('updateProduct failed', { productId, error: error.message });
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  async deleteProduct(productId) {
    try {
      await this.initConfig();
      await this.api.delete(`/products/${productId}`);
      return { success: true };
    } catch (error) {
      logger.error('deleteProduct failed', { productId, error: error.message });
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  /* ============================
     Group API
  ============================ */

  async getAllGroups() {
    try {
      await this.initConfig();
      const res = await this.api.get('/groups');

      // Many APIs return { data: [...] } or directly [...]
      const payload = Array.isArray(res.data) ? res.data : res.data?.data || res.data;

      if (!Array.isArray(payload)) {
        logger.error('Invalid response format from Telegram API getAllGroups', { response: res.data });
        return { success: false, error: 'Invalid response format from Telegram API' };
      }

      logger.info('Retrieved all groups', { count: payload.length });
      return { success: true, data: payload };
    } catch (error) {
      logger.error('Error fetching telegram groups', { error: error.message });
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  async getUnmappedGroups() {
    try {
      await this.initConfig();
      const res = await this.api.get('/groups/unmapped');
      const payload = Array.isArray(res.data) ? res.data : res.data?.data || res.data;
      return { success: true, data: payload };
    } catch (error) {
      logger.error('getUnmappedGroups failed', { error: error.message });
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  /* ============================
     Mapping API
  ============================ */

  async mapProductToGroup(productId, groupData) {
    try {
      await this.initConfig();
      const res = await this.api.post(`/products/${productId}/map`, groupData);
      return { success: true, data: res.data };
    } catch (error) {
      logger.error('mapProductToGroup failed', { productId, error: error.message });
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  async unmapProductFromGroup(productId) {
    try {
      await this.initConfig();
      await this.api.delete(`/products/${productId}/unmap`);
      return { success: true };
    } catch (error) {
      logger.error('unmapProductFromGroup failed', { productId, error: error.message });
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  /* ============================
     Subscription API
  ============================ */

  async createSubscription(subscriptionData) {
    try {
      await this.initConfig();
      const res = await this.api.post('/subscribe', subscriptionData);
      return { success: true, data: res.data };
    } catch (error) {
      logger.error('createSubscription failed', { error: error.message });
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  async cancelSubscription(email, productId) {
    try {
      await this.initConfig();
      const res = await this.api.delete('/subscriptions', {
        data: { email, product_id: productId }
      });
      return { success: true, data: res.data };
    } catch (error) {
      logger.error('cancelSubscription failed', { email, productId, error: error.message });
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  /* ============================
     Business logic helpers
  ============================ */

  /**
   * generateInviteLink(user, product, subscription)
   * - product.telegramProductId must exist (synced)
   * - subscription.expiresAt assumed to be a Date object (or convertible)
   */
  async generateInviteLink(user, product, subscription) {
    try {
      await this.initConfig();

      if (!product?.telegramProductId) {
        logger.warn('Cannot generate invite link: product not synced with Telegram', { productId: product?._id });
        return { success: false, error: 'Product not synced with Telegram' };
      }

      const expires = subscription?.expiresAt ? new Date(subscription.expiresAt) : null;
      if (!expires || isNaN(expires.getTime())) {
        logger.warn('Invalid subscription expiresAt provided', { subscription });
        return { success: false, error: 'Invalid subscription expiration' };
      }

      const subData = {
        email: user.email,
        product_id: product.telegramProductId,
        expiration_datetime: expires.toISOString(),
      };

      const result = await this.createSubscription(subData);
      if (result.success) {
        logger.info('Successfully created Telegram subscription and obtained invite link', {
          userId: user._id,
          productId: product._id,
          telegramProductId: product.telegramProductId,
        });

        return {
          success: true,
          invite_link: result.data.invite_link || result.data.inviteLink || null,
          expires_at: result.data.invite_expires_at ? new Date(result.data.invite_expires_at) : expires,
        };
      } else {
        logger.error('Failed to create Telegram subscription', { error: result.error });
        return { success: false, error: result.error };
      }
    } catch (error) {
      logger.error('generateInviteLink exception', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * kickUser(userId, productId)
   * - looks up user by id and portfolio/bundle by id
   * - cancels subscription (kicks user)
   */
  async kickUser(userId, productId) {
    try {
      await this.initConfig();

      const user = await User.findById(userId);
      const product = (await Portfolio.findById(productId)) || (await Bundle.findById(productId));

      if (!user || !product) {
        logger.error('Could not find user or product for kicking', { userId, productId });
        return { success: false, error: 'User or Product not found' };
      }

      if (!product.telegramProductId) {
        logger.warn('Cannot kick user: product not synced with Telegram', { productId });
        return { success: false, error: 'Product not synced with Telegram' };
      }

      const result = await this.cancelSubscription(user.email, product.telegramProductId);
      if (result.success) {
        logger.info(`Successfully kicked user ${user.email} from product ${product.telegramProductId}`);
        return { success: true };
      } else {
        logger.error('Failed to kick user', { userEmail: user.email, error: result.error });
        return { success: false, error: result.error };
      }
    } catch (error) {
      logger.error('kickUser exception', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * syncWithTelegram
   * - iterates portfolios and bundles and ensures they exist on Telegram side
   * - preserves your original logic for pricing extraction and description handling
   */
  async syncWithTelegram() {
    try {
      await this.initConfig();

      const portfolios = await Portfolio.find({}).select('name description subscriptionFee emandateSubriptionFees telegramProductId');
      const bundles = await Bundle.find({}).select('name description monthlyPrice yearlyPrice telegramProductId');

      let createdCount = 0;
      let updatedCount = 0;
      let failedCount = 0;

      const processItem = async (item, type) => {
        try {
          let price = 0;
          if (type === 'portfolio') {
            const monthlyFee = Array.isArray(item.subscriptionFee) ? item.subscriptionFee.find(f => f.type === 'monthly') : null;
            const emandateMonthlyFee = Array.isArray(item.emandateSubriptionFees) ? item.emandateSubriptionFees.find(f => f.type === 'monthly') : null;
            price = monthlyFee?.price || emandateMonthlyFee?.price || item.subscriptionFee?.[0]?.price || 0;
          } else { // bundle
            price = item.monthlyPrice || item.yearlyPrice || 0;
          }

          const description = item.description && item.description.length > 0
            ? (typeof item.description === 'string' ? item.description : item.description[0]?.value || `${item.name} description`)
            : `${item.name} description`;

          const productData = {
            name: item.name,
            description,
            price,
          };

          let result;
          if (item.telegramProductId) {
            result = await this.updateProduct(item.telegramProductId, productData);
            if (result.success) updatedCount++;
            else {
              failedCount++;
              logger.error('Failed to update telegram product', { itemName: item.name, result });
            }
          } else {
            result = await this.createProduct(productData);
            if (result.success && (result.data?.id || result.data?.product_id || result.data?._id)) {
              // attempt common id fields returned by different APIs
              const newId = result.data.id || result.data.product_id || result.data._id;
              item.telegramProductId = newId;
              await item.save();
              createdCount++;
            } else {
              failedCount++;
              logger.error('Failed to create Telegram product for item', { itemName: item.name, error: result.error });
            }
          }
        } catch (err) {
          failedCount++;
          logger.error('Exception while syncing item', { itemName: item.name, error: err.message });
        }
      };

      for (const p of portfolios) {
        // sequential to avoid spamming remote API — change to Promise.all with concurrency if desired
        // Keep sequential to be safe with rate limits.
        // If you want concurrency, consider using p-map or Promise.allSettled with a concurrency limiter.
        // For now stick to sequential.
        // eslint-disable-next-line no-await-in-loop
        await processItem(p, 'portfolio');
      }

      for (const b of bundles) {
        // eslint-disable-next-line no-await-in-loop
        await processItem(b, 'bundle');
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
    } catch (error) {
      logger.error('syncWithTelegram failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /* ============================
     Convenience methods (backwards-compatible static style)
     If some other modules call TelegramService.getAllProducts() as static,
     they should be refactored to import the instance and call instance.getAllProducts()
  ============================ */

  async getAllProducts() {
    try {
      await this.initConfig();
      const res = await this.api.get('/products');
      const payload = Array.isArray(res.data) ? res.data : res.data?.data || res.data;
      if (!Array.isArray(payload)) {
        logger.error('Invalid response format from Telegram API getAllProducts', { response: res.data });
        return { success: false, error: 'Invalid response format from Telegram API' };
      }
      return { success: true, data: payload, total: payload.length };
    } catch (error) {
      logger.error('Error fetching telegram products', { error: error.message });
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }
}

module.exports = new TelegramService();
