const { TelegramService } = require('../services/tgservice');
const winston = require('winston');

/**
 * Admin controller for managing all Telegram integration operations
 * These endpoints should be protected with admin authentication
 */

/**
 * Sync all portfolios and bundles with Telegram
 * @route POST /api/admin/telegram/sync-with-telegram
 * @access Admin only
 */
exports.syncWithTelegram = async (req, res) => {
  try {
    winston.info('Admin initiated Telegram sync', {
      adminId: req.user?._id,
      adminEmail: req.user?.email,
      timestamp: new Date().toISOString()
    });

    const result = await TelegramService.syncWithTelegram();

    if (result.success) {
      winston.info('Telegram sync completed successfully', {
        adminId: req.user?._id,
        results: result.results
      });

      res.status(200).json({
        success: true,
        message: 'Telegram sync completed successfully',
        data: result.results
      });
    } else {
      winston.error('Telegram sync failed', {
        adminId: req.user?._id,
        error: result.error
      });

      res.status(500).json({
        success: false,
        message: 'Failed to sync with Telegram',
        error: result.error
      });
    }
  } catch (error) {
    winston.error('Telegram sync endpoint error', {
      adminId: req.user?._id,
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error during sync',
      error: error.message
    });
  }
};

/**
 * Get all Telegram groups
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAllGroups = async (req, res) => {
  try {
    const result = await TelegramService.getAllGroups();

    if (result.success) {
      res.json({
        success: true,
        data: result.data,
        count: result.data?.length || 0
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve groups'
      });
    }
  } catch (error) {
    console.error('Error in getAllGroups controller:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve groups'
    });
  }
};

/**
 * Get unmapped Telegram groups
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getUnmappedGroups = async (req, res) => {
  try {
    const result = await TelegramService.getUnmappedGroups();

    if (result.success) {
      res.json({
        success: true,
        data: result.data,
        count: result.data?.length || 0
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve unmapped groups'
      });
    }
  } catch (error) {
    console.error('Error in getUnmappedGroups controller:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve unmapped groups'
    });
  }
};

/**
 * Map a product to a Telegram group
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.mapProductToGroup = async (req, res) => {
  try {
    const { productId } = req.params;
    const { telegram_group_id, telegram_group_name } = req.body;

    if (!telegram_group_id || !telegram_group_name) {
      return res.status(400).json({
        success: false,
        error: 'telegram_group_id and telegram_group_name are required'
      });
    }

    const result = await TelegramService.mapProductToGroup(productId, {
      telegram_group_id,
      telegram_group_name
    });

    if (result.success) {
      res.json({
        success: true,
        data: result.data,
        message: 'Product mapped to group successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to map product to group'
      });
    }
  } catch (error) {
    console.error('Error in mapProductToGroup controller:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to map product to group'
    });
  }
};

/**
 * Unmap a product from its Telegram group
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.unmapProductFromGroup = async (req, res) => {
  try {
    const { productId } = req.params;

    const result = await TelegramService.unmapProductFromGroup(productId);

    if (result.success) {
      res.json({
        success: true,
        message: result.message || 'Product unmapped from group successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to unmap product from group'
      });
    }
  } catch (error) {
    console.error('Error in unmapProductFromGroup controller:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to unmap product from group'
    });
  }
};

/**
 * Get Telegram group mapping for a product
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getProductGroupMapping = async (req, res) => {
  try {
    const { productId } = req.params;

    const result = await TelegramService.getProductById(productId);

    if (result.success) {
      const groupMapping = result.data?.telegram_group || null;
      res.json({
        success: true,
        data: groupMapping,
        productId: productId
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve product group mapping'
      });
    }
  } catch (error) {
    console.error('Error in getProductGroupMapping controller:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve product group mapping'
    });
  }
};

/**
 * Get all Telegram products
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAllProducts = async (req, res) => {
  try {
    const result = await TelegramService.getAllProducts();

    if (result.success) {
      res.json({
        success: true,
        data: result.data,
        total: result.total || 0
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve products'
      });
    }
  } catch (error) {
    console.error('Error in getAllProducts controller:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve products'
    });
  }
};

/**
 * Get a specific Telegram product by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getProductById = async (req, res) => {
  try {
    const { productId } = req.params;

    const result = await TelegramService.getProductById(productId);

    if (result.success) {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve product'
      });
    }
  } catch (error) {
    console.error('Error in getProductById controller:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve product'
    });
  }
};

/**
 * Create a new Telegram product
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.createProduct = async (req, res) => {
  try {
    const { name, description, price, category } = req.body;

    if (!name || !description) {
      return res.status(400).json({
        success: false,
        error: 'Product name and description are required'
      });
    }

    const result = await TelegramService.createProduct({
      name,
      description,
      price,
      category
    });

    if (result.success) {
      res.status(201).json({
        success: true,
        data: result.data,
        message: 'Product created successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to create product'
      });
    }
  } catch (error) {
    console.error('Error in createProduct controller:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create product'
    });
  }
};

/**
 * Update a Telegram product
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.updateProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const updateData = req.body;

    const result = await TelegramService.updateProduct(productId, updateData);

    if (result.success) {
      res.json({
        success: true,
        data: result.data,
        message: 'Product updated successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to update product'
      });
    }
  } catch (error) {
    console.error('Error in updateProduct controller:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update product'
    });
  }
};

/**
 * Delete a Telegram product
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.deleteProduct = async (req, res) => {
  try {
    const { productId } = req.params;

    const result = await TelegramService.deleteProduct(productId);

    if (result.success) {
      res.json({
        success: true,
        message: 'Product deleted successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to delete product'
      });
    }
  } catch (error) {
    console.error('Error in deleteProduct controller:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete product'
    });
  }
};

/**
 * Get all subscriptions
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAllSubscriptions = async (req, res) => {
  try {
    const options = {
      page: parseInt(req.query.page) || 1,
      per_page: parseInt(req.query.per_page) || 10,
      sort_by: req.query.sort_by || 'created_at',
      sort_order: req.query.sort_order || 'desc',
      search: req.query.search,
      status: req.query.status,
      product_id: req.query.product_id,
      user_id: req.query.user_id
    };

    const result = await TelegramService.getAllSubscriptions(options);

    if (result.success) {
      res.json({
        success: true,
        data: result.data,
        total: result.total,
        page: options.page,
        per_page: options.per_page,
        pages: Math.ceil(result.total / options.per_page)
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve subscriptions'
      });
    }
  } catch (error) {
    console.error('Error in getAllSubscriptions controller:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve subscriptions'
    });
  }
};

/**
 * Create a new subscription
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.createSubscription = async (req, res) => {
  try {
    const { email, product_id, product_name, expiration_datetime } = req.body;

    if (!email || (!product_id && !product_name) || !expiration_datetime) {
      return res.status(400).json({
        success: false,
        error: 'Email, product identifier (ID or name), and expiration datetime are required'
      });
    }

    const result = await TelegramService.createSubscription({
      email,
      product_id,
      product_name,
      expiration_datetime
    });

    if (result.success) {
      res.status(201).json({
        success: true,
        data: result.data,
        message: 'Subscription created successfully',
        invite_link: result.invite_link,
        invite_expires_at: result.invite_expires_at,
        subscription_expires_at: result.subscription_expires_at
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to create subscription'
      });
    }
  } catch (error) {
    console.error('Error in createSubscription controller:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create subscription'
    });
  }
};

/**
 * Cancel subscription by email and product ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.cancelSubscriptionByEmail = async (req, res) => {
  try {
    const { email, product_id } = req.body;

    if (!email || !product_id) {
      return res.status(400).json({
        success: false,
        error: 'Email and product_id are required'
      });
    }

    const result = await TelegramService.cancelSubscriptionByEmail(email, product_id);

    if (result.success) {
      res.json({
        success: true,
        message: 'Subscription cancelled successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to cancel subscription'
      });
    }
  } catch (error) {
    console.error('Error in cancelSubscriptionByEmail controller:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to cancel subscription'
    });
  }
};

/**
 * Get all users
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getAllUsers = async (req, res) => {
  try {
    const result = await TelegramService.getAllUsers();

    if (result.success) {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve users'
      });
    }
  } catch (error) {
    console.error('Error in getAllUsers controller:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve users'
    });
  }
};

/**
 * Cancel subscription by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.cancelSubscriptionById = async (req, res) => {
  try {
    const { subscriptionId } = req.params;

    const result = await TelegramService.cancelSubscriptionById(subscriptionId);

    if (result.success) {
      res.json({
        success: true,
        message: 'Subscription cancelled successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to cancel subscription'
      });
    }
  } catch (error) {
    console.error('Error in cancelSubscriptionById controller:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to cancel subscription'
    });
  }
};

/**
 * Process Telegram webhook
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.processWebhook = async (req, res) => {
  try {
    const { token } = req.params;
    const updateData = req.body;

    // Basic token validation (you should implement proper token verification)
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token is required'
      });
    }

    const result = await TelegramService.processWebhook(token, updateData);

    if (result.success) {
      res.json({
        success: true,
        message: 'Update processed successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to process webhook'
      });
    }
  } catch (error) {
    console.error('Error in processWebhook controller:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process webhook'
    });
  }
};

/**
 * Test Telegram webhook configuration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.testWebhook = async (req, res) => {
  try {
    const result = await TelegramService.testWebhook();

    if (result.success) {
      res.json({
        success: true,
        message: 'Webhook info retrieved successfully',
        webhook_url: result.webhook_url,
        has_custom_certificate: result.has_custom_certificate,
        pending_update_count: result.pending_update_count,
        last_error_date: result.last_error_date,
        last_error_message: result.last_error_message,
        max_connections: result.max_connections
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to get webhook info'
      });
    }
  } catch (error) {
    console.error('Error in testWebhook controller:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get webhook info'
    });
  }
};
