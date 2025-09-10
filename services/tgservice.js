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
    new winston.transports.File({ filename: 'logs/telegram-service.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
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
        timeout: 90000, // Increased timeout to 90 seconds to handle slow responses
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
      logger.info('Creating product on Telegram API', { productData });
      const res = await this.api.post('/products', productData);
      logger.info('Product created successfully', { responseData: res.data });
      // Return the data directly, assuming the calling function will handle it
      return res.data;
    } catch (error) {
      logger.error('createProduct failed', { productData, error: error.message, responseData: error.response?.data });
      // Re-throw the error to be caught by the controller
      throw error;
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
      logger.info('Updating product on Telegram API', { productId, productData });
      const res = await this.api.put(`/products/${productId}`, productData);
      logger.info('Product updated successfully', { productId, responseData: res.data });
      return { success: true, data: res.data };
    } catch (error) {
      const status = error.response?.status;
      const responseData = error.response?.data || { message: error.message };
      logger.error('updateProduct failed', { productId, productData, error: error.message, status, responseData });
      return { success: false, error: { status, data: responseData } };
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

  async getGroupStatus(productId) {
    try {
      await this.initConfig();
      const res = await this.api.get(`/products/${productId}/group`);
      
      // Handle the response structure
      const groupData = res.data;
      
      return { 
        success: true, 
        group: {
          active: groupData?.is_active || groupData?.active || false,
          id: groupData?.telegram_group_id || groupData?.id || null,
          name: groupData?.telegram_group_name || groupData?.name || null,
          ...groupData
        }
      };
    } catch (error) {
      logger.error('getGroupStatus failed', { productId, error: error.message });
      
      // If the product doesn't have a group mapped, return a default inactive status
      if (error.response?.status === 404) {
        return { 
          success: true, 
          group: { 
            active: false, 
            id: null, 
            name: null 
          } 
        };
      }
      
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

  async createSubscription(subscriptionData, retryCount = 0) {
    try {
      await this.initConfig();
      const res = await this.api.post('/subscribe', subscriptionData);
      return { success: true, data: res.data };
    } catch (error) {
      // If the error is a timeout and we haven't retried too many times, try again
      if (error.message && error.message.includes('timeout') && retryCount < 2) {
        logger.warn(`Telegram API timeout, retrying (${retryCount + 1}/2)...`, { 
          subscriptionData: { email: subscriptionData.email, product_id: subscriptionData.product_id }
        });
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.createSubscription(subscriptionData, retryCount + 1);
      }
      
      logger.error('createSubscription failed', { 
        error: error.message, 
        retryAttempts: retryCount,
        subscriptionData: { email: subscriptionData.email, product_id: subscriptionData.product_id } 
      });
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
   * - product.externalId must exist (synced)
   * - subscription.expiresAt assumed to be a Date object (or convertible)
   */
  async generateInviteLink(user, product, subscription) {
    try {
      await this.initConfig();

      if (!product?.externalId) {
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
        product_id: product.externalId,
        expiration_datetime: expires.toISOString(),
      };

      const result = await this.createSubscription(subData);
      if (result.success) {
        logger.info('Successfully created Telegram subscription and obtained invite link', {
          userId: user._id,
          productId: product._id,
          telegramProductId: product.externalId,
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

      // Better error handling for missing parameters
      if (!userId || !productId) {
        logger.error('Missing userId or productId for kickUser', { userId, productId });
        return { success: false, error: 'Missing userId or productId' };
      }

      const user = await User.findById(userId);
      if (!user) {
        logger.error('User not found for kicking', { userId });
        return { success: false, error: 'User not found' };
      }

      // Try to find the product as either Portfolio or Bundle
      const product = (await Portfolio.findById(productId)) || (await Bundle.findById(productId));
      if (!product) {
        logger.error('Product not found for kicking', { productId });
        return { success: false, error: 'Product not found' };
      }

      if (!product.externalId) {
        logger.warn('Cannot kick user: product not synced with Telegram', { 
          productId, 
          productName: product.name,
          productType: product.hasOwnProperty('holdings') ? 'Portfolio' : 'Bundle' 
        });
        return { success: false, error: 'Product not synced with Telegram' };
      }

      if (!user.email) {
        logger.error('User has no email for kicking', { userId });
        return { success: false, error: 'User has no email' };
      }

      const result = await this.cancelSubscription(user.email, product.externalId);
      if (result.success) {
        logger.info(`Successfully kicked user ${user.email} from product ${product.name} (${product.externalId})`);
        return { success: true };
      } else {
        logger.error('Failed to kick user', { 
          userId: user._id,
          userEmail: user.email, 
          productId: product._id,
          productName: product.name,
          externalId: product.externalId,
          error: result.error 
        });
        return { success: false, error: result.error };
      }
    } catch (error) {
      logger.error('kickUser exception', { userId, productId, error: error.message, stack: error.stack });
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

      // 1. Fetch all remote products first to avoid duplicates
      const remoteProductsResult = await this.getAllProducts();
      if (!remoteProductsResult.success) {
        logger.error('syncWithTelegram failed: Could not fetch remote products.');
        return { success: false, error: 'Could not fetch remote products.' };
      }
      const remoteProductMap = new Map(remoteProductsResult.data.map(p => [p.name, p]));
      logger.info(`Found ${remoteProductMap.size} existing products on Telegram service.`);

      const portfolios = await Portfolio.find({}).select('name description subscriptionFee emandateSubriptionFees telegramProductId externalId');
      const bundles = await Bundle.find({}).select('name description monthlyPrice yearlyPrice telegramProductId externalId');

      let createdCount = 0;
      let updatedCount = 0;
      let failedCount = 0;

      const allItems = [
        ...portfolios.map(p => ({ ...p.toObject(), type: 'portfolio' })),
        ...bundles.map(b => ({ ...b.toObject(), type: 'bundle' }))
      ];

      const processItem = async (item, type) => {
        const model = type === 'portfolio' ? Portfolio : Bundle;
        try {
          let price = 0;
          if (type === 'portfolio') {
            const monthlyFee = Array.isArray(item.subscriptionFee) ? item.subscriptionFee.find(f => f.type === 'monthly') : null;
            if (monthlyFee?.price > 0) {
              price = monthlyFee.price;
            } else {
              const emandateMonthlyFee = Array.isArray(item.emandateSubriptionFees) ? item.emandateSubriptionFees.find(f => f.type === 'monthly') : null;
              if (emandateMonthlyFee?.price > 0) {
                price = emandateMonthlyFee.price;
              } else {
                const quarterlyFee = Array.isArray(item.subscriptionFee) ? item.subscriptionFee.find(f => f.type === 'quarterly') : null;
                if (quarterlyFee?.price > 0) {
                  price = Math.round(quarterlyFee.price / 3);
                } else {
                  price = item.subscriptionFee?.[0]?.price || item.emandateSubriptionFees?.[0]?.price || 0;
                }
              }
            }
          } else { // bundle
            price = item.monthlyPrice || Math.round(item.yearlyPrice / 12) || 0;
          }

          if (price <= 0 || price > 50000) {
            logger.warn(`Invalid price calculated for ${type}: ${price}, skipping item`, { itemName: item.name });
            // We don't count this as a failure, just a skip.
            return;
          }

          const description = item.description && item.description.length > 0
            ? (typeof item.description === 'string' ? item.description : item.description[0]?.value || `${item.name} description`)
            : `${item.name} description`;

          const productData = {
            name: item.name,
            description,
            // price, // Price is still disabled as per previous findings
          };

          // 2. Check if product exists on remote by name
          const existingRemoteProduct = remoteProductMap.get(item.name);
          const localExternalId = item.externalId;

          if (existingRemoteProduct) {
            logger.info(`Updating existing Telegram product by name: '${item.name}'`, { remoteId: existingRemoteProduct.id });
            const result = await this.updateProduct(existingRemoteProduct.id, productData);
            
            if (result.success) {
              updatedCount++;
              logger.info(`Successfully updated Telegram product`, { itemName: item.name });
              // 3. Ensure local ID matches the remote ID
              if (String(localExternalId) !== String(existingRemoteProduct.id)) {
                await model.findByIdAndUpdate(item._id, { externalId: existingRemoteProduct.id, telegramProductId: null });
                logger.info(`Corrected local externalId for '${item.name}' to ${existingRemoteProduct.id}`);
              }
            } else {
              failedCount++;
              logger.error(`Failed to update telegram product`, { itemName: item.name, error: result.error });
            }
          } else {
            // 4. If it doesn't exist remotely, create it
            logger.info(`Creating new Telegram product`, { itemName: item.name });
            const newProduct = await this.createProduct(productData);
            if (newProduct && newProduct.id) {
              createdCount++;
              await model.findByIdAndUpdate(item._id, { externalId: newProduct.id, telegramProductId: null });
              logger.info(`Successfully created Telegram product`, { itemName: item.name, newId: newProduct.id });
            } else {
              failedCount++;
              logger.error(`Failed to create Telegram product for item`, { itemName: item.name, error: newProduct });
            }
          }
        } catch (e) {
          failedCount++;
          logger.error(`Exception while syncing item`, { itemName: item.name, error: e.message });
        }
      };

      for (const item of allItems) {
        await processItem(item, item.type);
      }

      const success = failedCount === 0;
      const summary = {
        success,
        created: createdCount,
        updated: updatedCount,
        failed: failedCount,
        total: allItems.length,
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

  /**
   * Test Telegram webhook configuration by calling getWebhookInfo
   */
  async testWebhook() {
    try {
      await this.initConfig();
      
      // Use direct axios call to Telegram Bot API
      const botApiUrl = `https://api.telegram.org/bot${this.authToken}/getWebhookInfo`;
      const res = await axios.get(botApiUrl);
      
      if (res.data.ok) {
        return { 
          success: true, 
          ...res.data.result 
        };
      } else {
        logger.error('Telegram Bot API returned not ok', { response: res.data });
        return { success: false, error: 'Telegram Bot API returned error' };
      }
    } catch (error) {
      logger.error('Error testing webhook', { error: error.message });
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  /* ============================
     Missing Functions Implementation
  ============================ */

  /**
   * Get product by ID
   */
  async getProductById(productId) {
    try {
      await this.initConfig();
      const res = await this.api.get(`/products/${productId}`);
      return { success: true, data: res.data };
    } catch (error) {
      logger.error('getProductById failed', { productId, error: error.message });
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  /**
   * Get all users/subscriptions
   */
  async getAllUsers() {
    try {
      await this.initConfig();
      const res = await this.api.get('/users');
      const payload = Array.isArray(res.data) ? res.data : res.data?.data || res.data;
      return { success: true, data: payload };
    } catch (error) {
      logger.error('getAllUsers failed', { error: error.message });
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  /**
   * Get all subscriptions with optional filters
   */
  async getAllSubscriptions(options = {}) {
    try {
      await this.initConfig();
      
      // Build query parameters
      const queryParams = new URLSearchParams();
      if (options.email) queryParams.append('email', options.email);
      if (options.product_id) queryParams.append('product_id', options.product_id);
      if (options.status) queryParams.append('status', options.status);
      
      const queryString = queryParams.toString();
      const url = queryString ? `/subscriptions?${queryString}` : '/subscriptions';
      
      const res = await this.api.get(url);
      const payload = Array.isArray(res.data) ? res.data : res.data?.data || res.data;
      return { success: true, data: payload };
    } catch (error) {
      logger.error('getAllSubscriptions failed', { options, error: error.message });
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  /**
   * Cancel subscription by email
   */
  async cancelSubscriptionByEmail(email, productId) {
    try {
      await this.initConfig();
      const res = await this.api.delete('/subscriptions', {
        data: { email, product_id: productId }
      });
      return { success: true, data: res.data };
    } catch (error) {
      logger.error('cancelSubscriptionByEmail failed', { email, productId, error: error.message });
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  /**
   * Cancel subscription by ID
   */
  async cancelSubscriptionById(subscriptionId) {
    try {
      await this.initConfig();
      const res = await this.api.delete(`/subscriptions/${subscriptionId}`);
      return { success: true, data: res.data };
    } catch (error) {
      logger.error('cancelSubscriptionById failed', { subscriptionId, error: error.message });
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  /**
   * Create a new group
   */
  async createGroup(groupData) {
    try {
      await this.initConfig();
      logger.info('Creating group on Telegram API', { groupData });
      const res = await this.api.post('/groups', groupData);
      logger.info('Group created successfully', { responseData: res.data });
      return { success: true, data: res.data };
    } catch (error) {
      logger.error('createGroup failed', { groupData, error: error.message });
      return { success: false, error: error.response?.data || { message: error.message } };
    }
  }

  /**
   * Process webhook data
   */
  async processWebhook(token, updateData) {
    try {
      await this.initConfig();
      
      // Verify token
      if (token !== this.authToken) {
        logger.warn('Invalid webhook token received');
        return { success: false, error: 'Invalid token' };
      }
      
      logger.info('Processing webhook update', { updateData });
      
      // Process the webhook data according to your business logic
      // This is a placeholder - implement based on what webhooks you expect
      return { success: true, message: 'Webhook processed successfully' };
    } catch (error) {
      logger.error('processWebhook failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }
}

module.exports = new TelegramService();
