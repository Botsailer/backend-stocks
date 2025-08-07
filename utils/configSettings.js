// File: utils/configSettings.js

const Razorpay = require('razorpay');
const ConfigSettings = require('../models/configsettings');

// Cache to minimize DB hits
let configCache = {};
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get configuration value from DB or fallback to environment variables
 * @param {string} key - Configuration key to retrieve
 * @param {string} [defaultValue] - Optional default value if not found
 * @returns {Promise<any>} Configuration value
 */
async function getConfig(key, defaultValue = null) {
  // Refresh cache if expired
  const now = Date.now();
  if (now - cacheTime > CACHE_TTL) {
    await refreshCache();
  }
  
  // Check cache first
  if (configCache[key] !== undefined) {
    return configCache[key];
  }
  
  // Check database
  const config = await ConfigSettings.findOne({ key, isActive: true });
  if (config) {
    // Update cache
    configCache[key] = config.value;
    return config.value;
  }
  
  // Fallback to environment variable
  if (process.env[key] !== undefined) {
    return process.env[key];
  }
  
  // Return default value
  return defaultValue;
}

/**
 * Refresh the configuration cache
 */
async function refreshCache() {
  try {
    const configs = await ConfigSettings.find({ isActive: true });
    
    // Reset cache
    configCache = {};
    
    // Populate cache with fresh data
    configs.forEach(config => {
      configCache[config.key] = config.value;
    });
    
    cacheTime = Date.now();
  } catch (error) {
    console.error('Error refreshing config cache:', error);
  }
}

/**
 * Get all SMTP configuration as an object
 * @returns {Promise<object>} SMTP configuration object
 */
async function getSmtpConfig() {
  return {
    host: await getConfig('EMAIL_HOST'),
    port: await getConfig('EMAIL_PORT'),
    user: await getConfig('EMAIL_USER'),
    pass: await getConfig('EMAIL_PASS'),
    service: await getConfig('EMAIL_SERVICE'),
    receiveemailat: await getConfig('RECEIVE_EMAIL_AT')
  };
}

/**
 * Get all payment configuration as an object
 * @returns {Promise<object>} Payment configuration object
 */
async function getPaymentConfig() {
  return {
    key_id: await getConfig('RAZORPAY_KEY_ID'),
    key_secret: await getConfig('RAZORPAY_KEY_SECRET')
  };
}

const getRazorpayInstance = async () => {
  const config = await getPaymentConfig();
  if (!config.key_id || !config.key_secret) {
    throw new Error("Razorpay credentials not configured");
  }
  return new Razorpay({ key_id: config.key_id, key_secret: config.key_secret });
};



async function getFmpApiKeys() {
  try {
    const config = await ConfigSettings.findOne({
      key: 'fmp_apikey',
      category: 'fmp_api',
      isActive: true
    });
    if (!config || !config.isArray || !config.arrayItems) {
      console.warn('No active FMP API keys found', config);
      throw new Error('No active FMP API keys found');
    }
    return config.arrayItems;
  }
  catch (err) {
    console.error('Error getting FMP API keys:', err);
    throw err;
  }
}

// Initialize the cache on module load
refreshCache().catch(console.error);

module.exports = {
  getConfig,
  refreshCache,
  getSmtpConfig,
  getPaymentConfig,
  getFmpApiKeys,
  getRazorpayInstance
};
