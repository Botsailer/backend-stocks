const axios = require('axios');
const winston = require('winston');
const { getConfig } = require('../utils/configSettings');

// Logger
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

// Config variables (lazy-loaded)
let TELEGRAM_BOT_API_URL = null;
let TELEGRAM_BOT_TOKEN = null;

async function initTelegramService() {
  if (!TELEGRAM_BOT_API_URL) {
    TELEGRAM_BOT_API_URL = await getConfig(
      'TELEGRAM_BOT_API_URL',
      'http://89.116.121.11:5000'
    );
    TELEGRAM_BOT_TOKEN = await getConfig('TELEGRAM_BOT_TOKEN', null);
    logger.info(`Telegram Service initialized with API URL: ${TELEGRAM_BOT_API_URL}`);
  }
}

// Custom error classes for better error handling
class TelegramAPIError extends Error {
  constructor(message, statusCode, originalError = null) {
    super(message);
    this.name = 'TelegramAPIError';
    this.statusCode = statusCode;
    this.originalError = originalError;
  }
}

class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

class TelegramService {
  /**
   * Create axios instance with default configuration
   */
  static async getAxiosInstance() {
    await initTelegramService();
    return axios.create({
      baseURL: TELEGRAM_BOT_API_URL,
      timeout: 30000, // 30 seconds
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Telegram-Group-Manager/1.0'
      }
    });
  }

  /**
   * Handle API errors consistently with detailed logging
   * @param {Error} error - Original error
   * @param {string} operation - Operation context
   * @param {Object} params - Additional parameters for logging
   */
  static handleError(error, operation, params = {}) {
    const errorData = {
      operation,
      timestamp: new Date().toISOString(),
      params,
      error: {
        message: error.message,
        name: error.name
      }
    };

    // Handle axios errors specifically
    if (error.response) {
      errorData.error.type = 'HTTP_ERROR';
      errorData.error.status = error.response.status;
      errorData.error.statusText = error.response.statusText;
      errorData.error.data = error.response.data;
      errorData.error.headers = error.response.headers;

      logger.error('Telegram API HTTP Error', errorData);
    } else if (error.request) {
      errorData.error.type = 'NETWORK_ERROR';
      errorData.error.request = error.request;

      logger.error('Telegram API Network Error', errorData);
    } else {
      errorData.error.type = 'UNKNOWN_ERROR';
      errorData.error.stack = error.stack;

      logger.error('Telegram API Unknown Error', errorData);
    }

    return errorData;
  }

  /**
   * Validate required parameters
   * @param {Object} params - Parameters to validate
   * @param {Array} required - Required parameter names
   */
  static validateParams(params, required) {
    const missing = required.filter(key => !params[key]);
    if (missing.length > 0) {
      throw new ValidationError(`Missing required parameters: ${missing.join(', ')}`);
    }
  }

  // ==================== PRODUCT API ====================

  /**
   * Get all products
   * @returns {Promise<Object>} Products data
   */
  static async getAllProducts() {
    try {
      const axiosInstance = await this.getAxiosInstance();
      const response = await axiosInstance.get('/products');

      logger.info('Retrieved all products', {
        count: Array.isArray(response.data) ? response.data.length : (response.data?.data?.length || 0)
      });

      // Handle different response formats
      let products = [];
      let total = 0;

      if (Array.isArray(response.data)) {
        // Direct array response
        products = response.data;
        total = response.data.length;
      } else if (response.data?.data && Array.isArray(response.data.data)) {
        // Nested data structure
        products = response.data.data;
        total = response.data.total || response.data.data.length;
      } else if (response.data) {
        // Single object or other format
        products = [response.data];
        total = 1;
      }

      return {
        success: true,
        data: products,
        total: total
      };
    } catch (error) {
      const errorData = this.handleError(error, 'getAllProducts');
      throw new TelegramAPIError(
        'Failed to retrieve products',
        error.response?.status || 500,
        error
      );
    }
  }

  /**
   * Get product by ID
   * @param {string|number} productId - Product ID
   * @returns {Promise<Object>} Product data
   */
  static async getProductById(productId) {
    try {
      this.validateParams({ productId }, ['productId']);

      const axiosInstance = await this.getAxiosInstance();
      const response = await axiosInstance.get(`/products/${productId}`);

      logger.info('Retrieved product by ID', { productId });

      // Handle different response formats
      let productData = response.data;

      // If the response has a nested data structure, extract it
      if (response.data?.data && typeof response.data.data === 'object') {
        productData = response.data.data;
      }

      return {
        success: true,
        data: productData
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      const errorData = this.handleError(error, 'getProductById', { productId });

      if (error.response?.status === 404) {
        throw new TelegramAPIError('Product not found', 404, error);
      }

      throw new TelegramAPIError(
        'Failed to retrieve product',
        error.response?.status || 500,
        error
      );
    }
  }

  /**
   * Create new product
   * @param {Object} productData - Product data
   * @returns {Promise<Object>} Created product data
   */
  static async createProduct(productData) {
    try {
      this.validateParams(productData, ['name', 'description']);

      const axiosInstance = await this.getAxiosInstance();
      const response = await axiosInstance.post('/products', productData);

      logger.info('Created new product', {
        productId: response.data.id,
        name: productData.name
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      const errorData = this.handleError(error, 'createProduct', productData);
      throw new TelegramAPIError(
        'Failed to create product',
        error.response?.status || 500,
        error
      );
    }
  }

  /**
   * Update product
   * @param {string|number} productId - Product ID
   * @param {Object} updateData - Update data
   * @returns {Promise<Object>} Updated product data
   */
  static async updateProduct(productId, updateData) {
    try {
      this.validateParams({ productId }, ['productId']);

      const axiosInstance = await this.getAxiosInstance();
      const response = await axiosInstance.put(`/products/${productId}`, updateData);

      logger.info('Updated product', { productId });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      const errorData = this.handleError(error, 'updateProduct', { productId, updateData });

      if (error.response?.status === 404) {
        throw new TelegramAPIError('Product not found', 404, error);
      }

      throw new TelegramAPIError(
        'Failed to update product',
        error.response?.status || 500,
        error
      );
    }
  }

  /**
   * Create new product with auto portfolio/bundle creation
   * @param {Object} productData - Product data
   * @param {Object} options - Additional options for portfolio/bundle creation
   * @returns {Promise<Object>} Created product data with local entities
   */
  static async createProductWithEntities(productData, options = {}) {
    try {
      this.validateParams(productData, ['name', 'description', 'price']);

      // Create product via Telegram API
      const productResult = await this.createProduct(productData);
      const createdProduct = productResult.data;

      // Auto-create local portfolio and bundle if requested
      const localEntities = {};

      if (options.createPortfolio !== false) { // Default: create portfolio
        try {
          const Portfolio = require('../models/modelPortFolio');
          
          const portfolioData = {
            name: options.portfolioName || `${productData.name} Portfolio`,
            description: options.portfolioDescription || [
              { key: 'Product', value: productData.name },
              { key: 'Description', value: productData.description }
            ],
            externalId: createdProduct.id.toString(),
            subscriptionFee: options.subscriptionFee || [
              { type: 'monthly', price: productData.price }
            ],
            emandateSubriptionFees: options.emandateSubriptionFees || [],
            minInvestment: options.minInvestment || 5000,
            durationMonths: options.durationMonths || 12,
            PortfolioCategory: options.portfolioCategory || 'Basic'
          };

          const portfolio = new Portfolio(portfolioData);
          await portfolio.save();
          
          localEntities.portfolio = portfolio;
          logger.info('Auto-created portfolio for product', { 
            productId: createdProduct.id, 
            portfolioId: portfolio._id 
          });
        } catch (portfolioError) {
          logger.warn('Failed to auto-create portfolio', { 
            productId: createdProduct.id, 
            error: portfolioError.message 
          });
        }
      }

      if (options.createBundle !== false) { // Default: create bundle
        try {
          const Bundle = require('../models/bundle');
          
          const bundleData = {
            name: options.bundleName || `${productData.name} Bundle`,
            description: options.bundleDescription || productData.description,
            externalId: createdProduct.id.toString(),
            portfolios: localEntities.portfolio ? [localEntities.portfolio._id] : [],
            category: options.bundleCategory || 'basic',
            monthlyPrice: options.monthlyPrice || productData.price,
            monthlyemandateprice: options.monthlyemandateprice || null,
            quarterlyemandateprice: options.quarterlyemandateprice || null,
            yearlyemandateprice: options.yearlyemandateprice || null,
            yearlyPrice: options.yearlyPrice || null
          };

          const bundle = new Bundle(bundleData);
          await bundle.save();
          
          localEntities.bundle = bundle;
          logger.info('Auto-created bundle for product', { 
            productId: createdProduct.id, 
            bundleId: bundle._id 
          });
        } catch (bundleError) {
          logger.warn('Failed to auto-create bundle', { 
            productId: createdProduct.id, 
            error: bundleError.message 
          });
        }
      }

      return {
        success: true,
        data: createdProduct,
        localEntities
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      const errorData = this.handleError(error, 'createProductWithEntities', productData);
      throw new TelegramAPIError(
        'Failed to create product with entities',
        error.response?.status || 500,
        error
      );
    }
  }

  /**
   * Delete product
   * @param {string|number} productId - Product ID
   * @returns {Promise<Object>} Deletion result
   */
  static async deleteProduct(productId) {
    try {
      this.validateParams({ productId }, ['productId']);

      const axiosInstance = await this.getAxiosInstance();
      const response = await axiosInstance.delete(`/products/${productId}`);

      logger.info('Deleted product', { productId });

      return {
        success: true,
        message: response.data.message || 'Product deleted successfully'
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      const errorData = this.handleError(error, 'deleteProduct', { productId });

      if (error.response?.status === 404) {
        throw new TelegramAPIError('Product not found', 404, error);
      }

      throw new TelegramAPIError(
        'Failed to delete product',
        error.response?.status || 500,
        error
      );
    }
  }

  /**
   * Delete product with auto cleanup of local entities
   * @param {string|number} productId - Product ID
   * @param {Object} options - Cleanup options
   * @returns {Promise<Object>} Deletion result with cleanup info
   */
  static async deleteProductWithEntities(productId, options = {}) {
    try {
      this.validateParams({ productId }, ['productId']);

      // Clean up local entities first (before deleting the product)
      const cleanupResults = {};

      if (options.deletePortfolio !== false) { // Default: delete portfolio
        try {
          const Portfolio = require('../models/modelPortFolio');
          const deletedPortfolios = await Portfolio.deleteMany({ 
            externalId: productId.toString() 
          });
          
          cleanupResults.portfolios = {
            deletedCount: deletedPortfolios.deletedCount,
            success: true
          };
          
          logger.info('Auto-deleted portfolios for product', { 
            productId, 
            deletedCount: deletedPortfolios.deletedCount 
          });
        } catch (portfolioError) {
          cleanupResults.portfolios = {
            success: false,
            error: portfolioError.message
          };
          logger.warn('Failed to auto-delete portfolios', { 
            productId, 
            error: portfolioError.message 
          });
        }
      }

      if (options.deleteBundle !== false) { // Default: delete bundle
        try {
          const Bundle = require('../models/bundle');
          const deletedBundles = await Bundle.deleteMany({ 
            externalId: productId.toString() 
          });
          
          cleanupResults.bundles = {
            deletedCount: deletedBundles.deletedCount,
            success: true
          };
          
          logger.info('Auto-deleted bundles for product', { 
            productId, 
            deletedCount: deletedBundles.deletedCount 
          });
        } catch (bundleError) {
          cleanupResults.bundles = {
            success: false,
            error: bundleError.message
          };
          logger.warn('Failed to auto-delete bundles', { 
            productId, 
            error: bundleError.message 
          });
        }
      }

      // Delete product via Telegram API
      const productResult = await this.deleteProduct(productId);

      return {
        success: true,
        message: productResult.message,
        cleanupResults
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      const errorData = this.handleError(error, 'deleteProductWithEntities', { productId });

      if (error.response?.status === 404) {
        throw new TelegramAPIError('Product not found', 404, error);
      }

      throw new TelegramAPIError(
        'Failed to delete product with entities',
        error.response?.status || 500,
        error
      );
    }
  }

  // ==================== LOCAL ENTITY MANAGEMENT ====================

  /**
   * Find local portfolios by external product ID
   * @param {string|number} productId - External product ID
   * @returns {Promise<Object>} Portfolios data
   */
  static async findPortfoliosByProductId(productId) {
    try {
      const Portfolio = require('../models/modelPortFolio');
      const portfolios = await Portfolio.find({ 
        externalId: productId.toString() 
      });

      logger.info('Retrieved portfolios by product ID', { 
        productId, 
        count: portfolios.length 
      });

      return {
        success: true,
        data: portfolios
      };
    } catch (error) {
      const errorData = this.handleError(error, 'findPortfoliosByProductId', { productId });
      throw new TelegramAPIError(
        'Failed to find portfolios by product ID',
        500,
        error
      );
    }
  }

  /**
   * Find local bundles by external product ID
   * @param {string|number} productId - External product ID
   * @returns {Promise<Object>} Bundles data
   */
  static async findBundlesByProductId(productId) {
    try {
      const Bundle = require('../models/bundle');
      const bundles = await Bundle.find({ 
        externalId: productId.toString() 
      }).populate('portfolios');

      logger.info('Retrieved bundles by product ID', { 
        productId, 
        count: bundles.length 
      });

      return {
        success: true,
        data: bundles
      };
    } catch (error) {
      const errorData = this.handleError(error, 'findBundlesByProductId', { productId });
      throw new TelegramAPIError(
        'Failed to find bundles by product ID',
        500,
        error
      );
    }
  }

  // ==================== GROUP API ====================

  /**
   * Get all groups
   * @returns {Promise<Object>} Groups data
   */
  static async getAllGroups() {
    try {
      const axiosInstance = await this.getAxiosInstance();
      const response = await axiosInstance.get('/groups');

      logger.info('Retrieved all groups', {
        count: response.data?.length || 0
      });

      return {
        success: true,
        data: response.data || []
      };
    } catch (error) {
      const errorData = this.handleError(error, 'getAllGroups');
      throw new TelegramAPIError(
        'Failed to retrieve groups',
        error.response?.status || 500,
        error
      );
    }
  }

  /**
   * Get unmapped groups
   * @returns {Promise<Object>} Unmapped groups data
   */
  static async getUnmappedGroups() {
    try {
      const axiosInstance = await this.getAxiosInstance();
      const response = await axiosInstance.get('/groups/unmapped');

      logger.info('Retrieved unmapped groups', {
        count: response.data?.length || 0
      });

      return {
        success: true,
        data: response.data || []
      };
    } catch (error) {
      const errorData = this.handleError(error, 'getUnmappedGroups');
      throw new TelegramAPIError(
        'Failed to retrieve unmapped groups',
        error.response?.status || 500,
        error
      );
    }
  }

  /**
   * Map product to group
   * @param {string|number} productId - Product ID
   * @param {Object} groupData - Group data
   * @returns {Promise<Object>} Mapping result
   */
  static async mapProductToGroup(productId, groupData) {
    try {
      this.validateParams({ productId }, ['productId']);
      this.validateParams(groupData, ['telegram_group_id', 'telegram_group_name']);

      const axiosInstance = await this.getAxiosInstance();
      const response = await axiosInstance.post(`/products/${productId}/map`, groupData);

      logger.info('Mapped product to group', {
        productId,
        groupId: groupData.telegram_group_id
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      const errorData = this.handleError(error, 'mapProductToGroup', { productId, groupData });
      throw new TelegramAPIError(
        'Failed to map product to group',
        error.response?.status || 500,
        error
      );
    }
  }

  /**
   * Unmap product from group
   * @param {string|number} productId - Product ID
   * @returns {Promise<Object>} Unmapping result
   */
  static async unmapProductFromGroup(productId) {
    try {
      this.validateParams({ productId }, ['productId']);

      const axiosInstance = await this.getAxiosInstance();
      const response = await axiosInstance.delete(`/products/${productId}/unmap`);

      logger.info('Unmapped product from group', { productId });

      return {
        success: true,
        message: response.data.message || 'Product unmapped successfully'
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      const errorData = this.handleError(error, 'unmapProductFromGroup', { productId });

      if (error.response?.status === 404) {
        throw new TelegramAPIError('No mapping found for this product', 404, error);
      }

      throw new TelegramAPIError(
        'Failed to unmap product from group',
        error.response?.status || 500,
        error
      );
    }
  }

  // ==================== SUBSCRIPTION API ====================

  /**
   * Get all subscriptions with pagination and filtering
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Subscriptions data
   */
  static async getAllSubscriptions(options = {}) {
    try {
      const axiosInstance = await this.getAxiosInstance();
      const params = {
        page: options.page || 1,
        per_page: options.per_page || 10,
        sort_by: options.sort_by || 'created_at',
        sort_order: options.sort_order || 'desc',
        ...options
      };

      const response = await axiosInstance.get('/subscriptions', { params });

      logger.info('Retrieved subscriptions', {
        page: params.page,
        per_page: params.per_page,
        total: response.data.total || 0
      });

      return {
        success: true,
        data: response.data.items || [],
        pagination: {
          total: response.data.total || 0,
          page: response.data.page || 1,
          per_page: response.data.per_page || 10,
          pages: response.data.pages || 0
        }
      };
    } catch (error) {
      const errorData = this.handleError(error, 'getAllSubscriptions', options);
      throw new TelegramAPIError(
        'Failed to retrieve subscriptions',
        error.response?.status || 500,
        error
      );
    }
  }

  /**
   * Create subscription
   * @param {Object} subscriptionData - Subscription data
   * @returns {Promise<Object>} Created subscription data
   */
  static async createSubscription(subscriptionData) {
    try {
      this.validateParams(subscriptionData, ['email']);

      // Validate that either product_id or product_name is provided
      if (!subscriptionData.product_id && !subscriptionData.product_name) {
        throw new ValidationError('Either product_id or product_name must be provided');
      }

      this.validateParams(subscriptionData, ['expiration_datetime']);

      const axiosInstance = await this.getAxiosInstance();
      const response = await axiosInstance.post('/subscribe', subscriptionData);

      logger.info('Created subscription', {
        email: subscriptionData.email,
        product_id: subscriptionData.product_id,
        product_name: subscriptionData.product_name
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      const errorData = this.handleError(error, 'createSubscription', subscriptionData);
      throw new TelegramAPIError(
        'Failed to create subscription',
        error.response?.status || 500,
        error
      );
    }
  }

  /**
   * Cancel subscription by email and product ID
   * @param {string} email - User email
   * @param {string|number} productId - Product ID
   * @returns {Promise<Object>} Cancellation result
   */
  static async cancelSubscriptionByEmail(email, productId) {
    try {
      this.validateParams({ email, productId }, ['email', 'productId']);

      const axiosInstance = await this.getAxiosInstance();
      const response = await axiosInstance.delete('/subscriptions', {
        data: {
          email: email,
          product_id: productId
        }
      });

      logger.info('Cancelled subscription by email', { email, productId });

      return {
        success: true,
        message: response.data.message || 'Subscription cancelled successfully'
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      const errorData = this.handleError(error, 'cancelSubscriptionByEmail', { email, productId });
      throw new TelegramAPIError(
        'Failed to cancel subscription',
        error.response?.status || 500,
        error
      );
    }
  }

  /**
   * Get all users
   * @returns {Promise<Object>} Users data
   */
  static async getAllUsers() {
    try {
      const axiosInstance = await this.getAxiosInstance();
      const response = await axiosInstance.get('/users');

      logger.info('Retrieved all users', {
        count: response.data?.length || 0
      });

      return {
        success: true,
        data: response.data || []
      };
    } catch (error) {
      const errorData = this.handleError(error, 'getAllUsers');
      throw new TelegramAPIError(
        'Failed to retrieve users',
        error.response?.status || 500,
        error
      );
    }
  }

  /**
   * Cancel subscription by ID
   * @param {string|number} subscriptionId - Subscription ID
   * @returns {Promise<Object>} Cancellation result
   */
  static async cancelSubscriptionById(subscriptionId) {
    try {
      this.validateParams({ subscriptionId }, ['subscriptionId']);

      const axiosInstance = await this.getAxiosInstance();
      const response = await axiosInstance.post(`/subscriptions/${subscriptionId}/cancel`);

      logger.info('Cancelled subscription by ID', { subscriptionId });

      return {
        success: true,
        message: response.data.message || 'Subscription cancelled successfully'
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      const errorData = this.handleError(error, 'cancelSubscriptionById', { subscriptionId });
      throw new TelegramAPIError(
        'Failed to cancel subscription',
        error.response?.status || 500,
        error
      );
    }
  }

  // ==================== TELEGRAM API ====================

  /**
   * Process Telegram webhook
   * @param {string} token - Bot token
   * @param {Object} updateData - Telegram update data
   * @returns {Promise<Object>} Processing result
   */
  static async processWebhook(token, updateData) {
    try {
      this.validateParams({ token }, ['token']);

      const axiosInstance = await this.getAxiosInstance();
      const response = await axiosInstance.post(`/telegram/webhook/${token}`, updateData);

      logger.info('Processed Telegram webhook', {
        token: token.substring(0, 10) + '...',
        updateType: updateData.message?.text ? 'message' : 'other'
      });

      return {
        success: true,
        message: response.data.message || 'Update processed successfully'
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      const errorData = this.handleError(error, 'processWebhook', { token });

      if (error.response?.status === 401) {
        throw new TelegramAPIError('Invalid token', 401, error);
      }

      throw new TelegramAPIError(
        'Failed to process webhook',
        error.response?.status || 500,
        error
      );
    }
  }

  /**
   * Test webhook configuration
   * @returns {Promise<Object>} Webhook info
   */
  static async testWebhook() {
    try {
      const axiosInstance = await this.getAxiosInstance();
      const response = await axiosInstance.get('/telegram/webhook/test');

      logger.info('Retrieved webhook info');

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      const errorData = this.handleError(error, 'testWebhook');
      throw new TelegramAPIError(
        'Failed to retrieve webhook info',
        error.response?.status || 500,
        error
      );
    }
  }

  // ==================== LEGACY METHODS (for backward compatibility) ====================

  /**
   * Get Telegram group mapping for a product (legacy method)
   * @param {string} productId - Product ID
   * @returns {Promise<Object|null>} Telegram group info
   */
  static async getGroupMapping(productId) {
    try {
      const result = await this.getProductById(productId);
      return result.data?.telegram_group || null;
    } catch (error) {
      logger.warn('Legacy getGroupMapping failed, falling back to null', { productId });
      return null;
    }
  }

  /**
   * Generate Telegram invite link (legacy method)
   * Note: This functionality should be implemented based on actual Telegram API requirements
   * @param {string} productId - Product ID
   * @returns {Promise<Object>} Invite link data
   */
  static async generateInviteLink(productId) {
    try {
      // This would need to be implemented based on the actual Telegram Bot API
      // For now, return a placeholder response that matches expected format
      logger.info('Legacy generateInviteLink called', { productId });

      return {
        success: true,
        invite_link: `https://t.me/joinchat/example_${productId}`,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      };
    } catch (error) {
      const errorData = this.handleError(error, 'generateInviteLink', { productId });
      return {
        success: false,
        error: 'Failed to generate Telegram invite'
      };
    }
  }

  /**
   * Cancel subscription (legacy method)
   * @param {string} email - User email
   * @param {string} productId - Product ID
   * @param {string} productName - Product name (optional, for compatibility)
   * @param {Date} expirationDate - Subscription expiration date (optional, for compatibility)
   * @returns {Promise<Object>} Operation result
   */
  static async cancelSubscription(email, productId, productName, expirationDate) {
    try {
      const result = await this.cancelSubscriptionByEmail(email, productId);
      return result;
    } catch (error) {
      const errorData = this.handleError(error, 'cancelSubscription', { email, productId });
      return {
        success: false,
        error: error.message || 'Failed to cancel subscription'
      };
    }
  }

  /**
   * Create Telegram products for all portfolios and bundles with externalIds
   * @returns {Promise<Object>} Sync operation result
   */
  static async syncWithTelegram() {
    try {
      // Import models here to avoid circular dependency
      const Portfolio = require('../models/modelPortFolio');
      const Bundle = require('../models/bundle');
      
      logger.info('Starting Telegram sync for portfolios and bundles');
      
      const results = {
        portfolios: {
          total: 0,
          synced: 0,
          skipped: 0,
          errors: []
        },
        bundles: {
          total: 0,
          synced: 0,
          skipped: 0,
          errors: []
        }
      };

      // Sync portfolios
      const portfolios = await Portfolio.find({ externalId: { $exists: true, $ne: '', $ne: null } });
      results.portfolios.total = portfolios.length;
      
      logger.info(`Found ${portfolios.length} portfolios with externalId to sync`);
      
      for (const portfolio of portfolios) {
        try {
          // Map portfolio data to Telegram API format
          const productData = {
            name: portfolio.name,
            description: portfolio.description && portfolio.description.length > 0 
              ? portfolio.description.map(item => {
                  if (item.value) {
                    // Remove HTML tags and clean up the text
                    return item.value.replace(/<[^>]*>/g, '').trim();
                  } else if (item.text) {
                    return item.text.replace(/<[^>]*>/g, '').trim();
                  }
                  return '';
                }).filter(desc => desc.length > 0).join(' ').substring(0, 500) // Limit to 500 chars
              : `Portfolio: ${portfolio.name}`
          };

     
          if (portfolio.subscriptionFee && portfolio.subscriptionFee.length > 0) {
            const monthlyFee = portfolio.subscriptionFee.find(fee => fee.type === 'monthly');
            if (monthlyFee && monthlyFee.price > 0) {
              logger.info(`Portfolio ${portfolio.name} has monthly price: ${monthlyFee.price}`);
            }
          }

          const syncResult = await this.createProduct(productData);
          
          if (syncResult.success) {
            results.portfolios.synced++;
            logger.info(`Synced portfolio ${portfolio.name} with Telegram`);
          } else {
            results.portfolios.errors.push({
              portfolioId: portfolio._id,
              portfolioName: portfolio.name,
              externalId: portfolio.externalId,
              error: syncResult.error
            });
            logger.error(`Failed to sync portfolio ${portfolio.name}:`, syncResult.error);
          }
        } catch (error) {
          results.portfolios.errors.push({
            portfolioId: portfolio._id,
            portfolioName: portfolio.name,
            externalId: portfolio.externalId,
            error: error.message
          });
          logger.error(`Failed to sync portfolio ${portfolio.name}:`, error);
        }
      }

      // Sync bundles
      const bundles = await Bundle.find({ externalId: { $exists: true, $ne: '', $ne: null } });
      results.bundles.total = bundles.length;
      
      logger.info(`Found ${bundles.length} bundles with externalId to sync`);
      
      for (const bundle of bundles) {
        try {
          // Map bundle data to Telegram API format
          const productData = {
            name: bundle.name,
            description: bundle.description 
              ? bundle.description.replace(/<[^>]*>/g, '').trim().substring(0, 500)
              : `Bundle: ${bundle.name}`
          };

          // Note: Price field is not sent to Telegram API as it's not supported
          // Price information is handled separately if needed

          logger.info(`Attempting to create bundle product:`, { bundleName: bundle.name, descriptionLength: productData.description.length });

          const syncResult = await this.createProduct(productData);
          
          if (syncResult.success) {
            results.bundles.synced++;
            logger.info(`Synced bundle ${bundle.name} with Telegram`);
          } else {
            results.bundles.errors.push({
              bundleId: bundle._id,
              bundleName: bundle.name,
              externalId: bundle.externalId,
              error: syncResult.error
            });
            logger.error(`Failed to sync bundle ${bundle.name}:`, syncResult.error);
          }
        } catch (error) {
          results.bundles.errors.push({
            bundleId: bundle._id,
            bundleName: bundle.name,
            externalId: bundle.externalId,
            error: error.message
          });
          logger.error(`Failed to sync bundle ${bundle.name}:`, error);
        }
      }

      logger.info('Telegram sync completed', results);
      
      return {
        success: true,
        message: 'Telegram sync completed successfully',
        results
      };
      
    } catch (error) {
      logger.error('Telegram sync failed:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to sync with Telegram'
      };
    }
  }
}

module.exports = {
  TelegramService,
  TelegramAPIError,
  ValidationError
};