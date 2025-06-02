const ConfigSettings = require('../models/configsettings');
const emailService = require('../services/emailServices');

/**
 * Get all configurations, optionally filtered by category
 */
exports.getAllConfigs = async (req, res) => {
  try {
    const { category } = req.query;
    const query = category ? { category } : {};
    
    const configs = await ConfigSettings.find(query).sort('key');
  
    res.json(configs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
/**
 * Get configuration by key
 */
exports.getConfigByKey = async (req, res) => {
  try {
    const { key } = req.params;
    const config = await ConfigSettings.findOne({ key });
    
    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }
    
    const configObj = config.toObject();
    if (configObj.isSecret) {
      if (configObj.isArray && configObj.arrayItems) {
        configObj.arrayItems = configObj.arrayItems.map(() => '********');
      } else {
        configObj.value = '********';
      }
    }
    
    res.json(configObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Create a new configuration
 */
exports.createConfig = async (req, res) => {
  try {
    const { key, value, category, description, isSecret, isArray, arrayItems } = req.body;
    
    // Validate array config
    if (isArray && (!arrayItems || !Array.isArray(arrayItems))) {
      return res.status(400).json({ error: 'Array items required for array configuration' });
    }
    
    // Check if config already exists
    const exists = await ConfigSettings.findOne({ key });
    if (exists) {
      return res.status(400).json({ error: 'Configuration key already exists' });
    }
    
    const config = new ConfigSettings({
      key,
      value: isArray ? null : value,
      category,
      description,
      isSecret: isSecret || false,
      isArray: isArray || false,
      arrayItems: isArray ? arrayItems : undefined
    });
    
    await config.save();
    res.status(201).json(config);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * Update an existing configuration
 */
exports.updateConfig = async (req, res) => {
  try {
    const { key } = req.params;
    const updates = req.body;
    
    // Validate array updates
    if (updates.isArray && (!updates.arrayItems || !Array.isArray(updates.arrayItems))) {
      return res.status(400).json({ error: 'Array items required for array configuration' });
    }
    
    const config = await ConfigSettings.findOneAndUpdate(
      { key },
      updates,
      { new: true, runValidators: true }
    );
    
    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }
    
    res.json(config);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * Delete a configuration
 */
exports.deleteConfig = async (req, res) => {
  try {
    const { key } = req.params;
    const config = await ConfigSettings.findOneAndDelete({ key });
    
    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }
    
    res.json({ message: 'Configuration deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Batch update multiple configurations
 */
exports.batchUpdateConfigs = async (req, res) => {
  try {
    const { configs } = req.body;
    
    if (!Array.isArray(configs)) {
      return res.status(400).json({ error: 'Configs must be an array' });
    }
    
    const results = [];
    
    for (const configData of configs) {
      const { key, value, category, description, isSecret, isArray, arrayItems } = configData;
      
      if (!key || (value === undefined && !isArray)) {
        results.push({ key, status: 'error', message: 'Key and value are required for non-array configs' });
        continue;
      }
      
      // Validate array config
      if (isArray && (!arrayItems || !Array.isArray(arrayItems))) {
        results.push({ key, status: 'error', message: 'Array items required for array configuration' });
        continue;
      }
      
      try {
        const existing = await ConfigSettings.findOne({ key });
        
        if (existing) {
          // Update existing
          Object.assign(existing, { 
            value: isArray ? null : value,
            ...(category && { category }),
            ...(description && { description }),
            ...(isSecret !== undefined && { isSecret }),
            ...(isArray !== undefined && { isArray }),
            ...(isArray && { arrayItems })
          });
          await existing.save();
          results.push({ key, status: 'updated' });
        } else if (category && description) {
          // Create new if all required fields provided
          const newConfig = new ConfigSettings({
            key, 
            value: isArray ? null : value,
            category,
            description,
            isSecret: isSecret || false,
            isArray: isArray || false,
            arrayItems: isArray ? arrayItems : undefined
          });
          await newConfig.save();
          results.push({ key, status: 'created' });
        } else {
          results.push({ key, status: 'error', message: 'Missing required fields for new config' });
        }
      } catch (err) {
        results.push({ key, status: 'error', message: err.message });
      }
    }
    
    res.json({ results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * Test SMTP configuration by sending a test email
 */
exports.testSmtpConfig = async (req, res) => {
  try {
    const { to } = req.body;
    
    if (!to) {
      return res.status(400).json({ error: 'Recipient email is required' });
    }
    
    await emailService.sendEmail(
      to,
      'SMTP Configuration Test',
      'This is a test email to verify your SMTP settings are correctly configured.',
      '<h1>SMTP Test Email</h1><p>If you received this email, your SMTP configuration is working correctly!</p>'
    );
    
    res.json({ message: 'Test email sent successfully' });
  } catch (err) {
    res.status(500).json({ error: `Failed to send test email: ${err.message}` });
  }
};


/**
 * Generic method to get array configuration for any category
 */
exports.getArrayConfig = async (configKey) => {
  try {
    const config = await ConfigSettings.findOne({ 
      key: configKey,
      isActive: true,
      isArray: true
    });
    
    if (!config || !config.arrayItems) {
      throw new Error(`No active array configuration found for key: ${configKey}`);
    }
    
    return config.arrayItems;
  } catch (err) {
    console.error(`Error getting array config for ${configKey}:`, err);
    throw err;
  }
};

/**
 * Generic method to get single-value configuration
 */
exports.getValueConfig = async (configKey) => {
  try {
    const config = await ConfigSettings.findOne({ 
      key: configKey,
      isActive: true,
      isArray: false
    });
    
    if (!config) {
      throw new Error(`No active configuration found for key: ${configKey}`);
    }
    
    return config.value;
  } catch (err) {
    console.error(`Error getting config for ${configKey}:`, err);
    throw err;
  }
};