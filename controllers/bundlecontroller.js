const Bundle = require('../models/bundle');
const mongoose = require('mongoose');
const Portfolio = require('../models/modelPortFolio');
const TelegramService = require('../services/tgservice');
const winston = require('winston');

// Bundle logger
const bundleLogger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.printf(({ timestamp, level, message, operation, bundleId, userId, details, ...rest }) => {
      let logMessage = `[${timestamp}] [${level.toUpperCase()}]`;
      
      if (operation) logMessage += ` [${operation}]`;
      if (bundleId) logMessage += ` [Bundle: ${bundleId}]`;
      if (userId) logMessage += ` [User: ${userId}]`;
      
      logMessage += ` ${message}`;
      
      if (details) {
        logMessage += `\nDetails: ${JSON.stringify(details, null, 2)}`;
      }
      
      if (Object.keys(rest).length > 0) {
        logMessage += `\nAdditional Data: ${JSON.stringify(rest, null, 2)}`;
      }
      
      return logMessage + '\n' + '='.repeat(120);
    })
  ),
  transports: [
    new winston.transports.Console({
      level: 'info',
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ 
      filename: 'logs/bundle-operations.log',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
      tailable: true
    })
  ]
});

const asyncHandler = fn => (req, res, next) => 
  Promise.resolve(fn(req, res, next)).catch(next);

exports.createBundle = asyncHandler(async (req, res) => {
  const { 
    name, 
    description = "", 
    portfolios = [], 
    category, 
    monthlyPrice, 
    monthlyemandateprice, 
    quarterlyemandateprice,
    yearlyemandateprice,
    yearlyPrice 
  } = req.body;

  const userId = req.user?._id || 'Unknown';
  const userEmail = req.user?.email || 'Unknown';

  bundleLogger.info('Bundle creation started', {
    operation: 'CREATE',
    userId,
    userEmail,
    details: {
      name,
      category,
      portfoliosCount: portfolios.length,
      pricingOptions: {
        monthlyPrice,
        monthlyemandateprice,
        quarterlyemandateprice,
        yearlyemandateprice,
        yearlyPrice
      }
    }
  });

  if (!name || !category) {
    return res.status(400).json({ error: 'Missing required fields: name and category are required' });
  }

  if (!['basic', 'premium'].includes(category)) {
    return res.status(400).json({ error: 'Invalid category. Must be basic or premium' });
  }

  if (monthlyPrice === undefined && monthlyemandateprice === undefined && 
      quarterlyemandateprice === undefined && yearlyemandateprice === undefined && 
      yearlyPrice === undefined) {
    return res.status(400).json({ error: 'At least one pricing option is required' });
  }

  if (Array.isArray(portfolios) && portfolios.length > 0) {
    try {
      const portfoliosExist = await Portfolio.countDocuments({ _id: { $in: portfolios } });
      if (portfoliosExist !== portfolios.length) {
        bundleLogger.warn('Bundle creation failed: One or more portfolio IDs are invalid', { operation: 'CREATE', userId, userEmail, providedIds: portfolios });
        return res.status(400).json({ error: 'One or more portfolio IDs are invalid' });
      }
    } catch (error) {
      bundleLogger.error('Error validating portfolio IDs during bundle creation', { operation: 'CREATE', userId, userEmail, error: error.message });
      return res.status(500).json({ error: 'Server error validating portfolios' });
    }
  }

  // Create Telegram product for bundle
  let telegramProductId = null;
  try {
    const basePrice = monthlyPrice || monthlyemandateprice || yearlyPrice || 0;
    const telegramProduct = await TelegramService.createProduct({
      name: name.trim(),
      description: `Bundle access: ${description || name}`,
      price: basePrice,
    });
    
    if (telegramProduct.success && telegramProduct.data.id) {
      telegramProductId = telegramProduct.data.id;
      bundleLogger.info('Telegram product created successfully for bundle', { bundleName: name, telegramProductId });
    } else {
      bundleLogger.warn('Failed to create Telegram product for bundle', { bundleName: name, error: telegramProduct.error });
    }
  } catch (telegramError) {
    bundleLogger.error('Error creating Telegram product for bundle', { bundleName: name, error: telegramError.message });
  }

  const bundle = new Bundle({
    name,
    description,
    portfolios,  
    category,
    monthlyPrice,
    monthlyemandateprice,
    quarterlyemandateprice,
    yearlyemandateprice,
    yearlyPrice,
    telegramProductId
  });

  await bundle.save();
  
  bundleLogger.info('Bundle created successfully', {
    operation: 'CREATE',
    bundleId: bundle._id,
    userId,
    userEmail,
    details: {
      bundleName: bundle.name,
      category: bundle.category,
      portfoliosCount: bundle.portfolios.length,
      telegramIntegrated: !!telegramProductId
    }
  });
  
  res.status(201).json(bundle);
});

exports.updateBundle = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.id);
  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found' });
  }

  const { 
    name, 
    description, 
    portfolios, 
    category, 
    monthlyPrice, 
    monthlyemandateprice, 
    quarterlyemandateprice,
    yearlyemandateprice,
    yearlyPrice 
  } = req.body;

  // Update basic fields
  if (name) bundle.name = name;
  if (description !== undefined) bundle.description = description;
  
  // Validate and update category
  if (category) {
    if (!['basic', 'premium'].includes(category)) {
      return res.status(400).json({ error: 'Invalid category. Must be basic or premium' });
    }
    bundle.category = category;
  }

  // Validate and update portfolios if provided and not empty
  if (portfolios !== undefined) {
    if (Array.isArray(portfolios) && portfolios.length > 0) {
      try {
        const existingCount = await Portfolio.countDocuments({ _id: { $in: portfolios } });
        if (existingCount !== portfolios.length) {
          return res.status(400).json({ error: 'One or more portfolio IDs are invalid' });
        }
      } catch (error) {
        return res.status(400).json({ error: 'Invalid portfolio IDs format' });
      }
    }
    bundle.portfolios = portfolios;
  }

  // Update pricing fields
  if (monthlyPrice !== undefined) bundle.monthlyPrice = monthlyPrice;
  if (monthlyemandateprice !== undefined) bundle.monthlyemandateprice = monthlyemandateprice;
  if (quarterlyemandateprice !== undefined) bundle.quarterlyemandateprice = quarterlyemandateprice;
  if (yearlyemandateprice !== undefined) bundle.yearlyemandateprice = yearlyemandateprice;
  if (yearlyPrice !== undefined) bundle.yearlyPrice = yearlyPrice;

  // Validate at least one price exists
  if (bundle.monthlyPrice === null && 
      bundle.monthlyemandateprice === null && 
      bundle.quarterlyemandateprice === null &&
      bundle.yearlyemandateprice === null &&
      bundle.yearlyPrice === null) {
    return res.status(400).json({ error: 'At least one pricing option is required' });
  }

  await bundle.save();
  res.status(200).json(bundle);
});


exports.getAllBundles = asyncHandler(async (req, res) => {
  // First, get bundles without population to check the reference IDs
  const rawBundles = await Bundle.find().lean();
  console.log('Raw bundles with portfolio references:', 
    JSON.stringify(rawBundles.map(b => ({
      bundleId: b._id,
      name: b.name,
      portfolioIds: b.portfolios
    })), null, 2)
  );
  
  // Check if those portfolio IDs actually exist
  if (rawBundles.length > 0 && rawBundles[0].portfolios.length > 0) {
    const Portfolio = mongoose.model('Portfolio');
    const samplePortfolioId = rawBundles[0].portfolios[0];
    
    try {
      const portfolioExists = await Portfolio.findById(samplePortfolioId);
      console.log(`Sample portfolio ID ${samplePortfolioId} exists: ${!!portfolioExists}`);
      if (portfolioExists) {
        console.log('Portfolio data sample:', {
          id: portfolioExists._id,
          name: portfolioExists.name
        });
      }
    } catch (error) {
      console.error('Error checking portfolio:', error.message);
    }
  }

  // Try with specific fields in the populate
  const bundles = await Bundle.find()
    .populate({
      path: 'portfolios',
      select: 'name description subscriptionFee minInvestment'
    })
    .sort('-createdAt');
  
  console.log('Populated bundles portfolio count:', 
    bundles.map(b => ({
      bundleName: b.name,
      portfolioCount: Array.isArray(b.portfolios) ? b.portfolios.length : 0
    }))
  );

  res.json(bundles);
});


exports.getBundleById = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.id)
    .populate({
      path: 'portfolios',
      select: 'name description subscriptionFee minInvestment holdings',
      options: { retainNullValues: true }
    });

  if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
  res.json(bundle);
});

exports.deleteBundle = asyncHandler(async (req, res) => {
  const bundleId = req.params.id;
  const userId = req.user?.id;
  const userEmail = req.user?.email;
  
  // Get bundle before deletion for logging
  const bundle = await Bundle.findById(bundleId);
  
  if (!bundle) {
    bundleLogger.warn('Bundle deletion attempted for non-existent bundle', {
      operation: 'DELETE',
      bundleId,
      userId,
      userEmail,
      details: {
        error: 'Bundle not found'
      }
    });
    return res.status(404).json({ error: 'Bundle not found' });
  }

  // Log bundle state before deletion
  const bundleBefore = {
    id: bundle._id,
    name: bundle.name,
    category: bundle.category,
    portfoliosCount: bundle.portfolios.length,
    externalId: bundle.externalId
  };

  // Delete Telegram product if it exists
  if (bundle.externalId) {
    try {
      const deleteResult = await TelegramService.deleteProduct(bundle.externalId);
      if (deleteResult.success) {
        bundleLogger.info('Telegram product deleted successfully for bundle', {
          operation: 'DELETE',
          bundleId,
          userId,
          userEmail,
          details: {
            telegramProductId: bundle.externalId,
            bundleName: bundle.name
          }
        });
      } else {
        bundleLogger.warn('Failed to delete Telegram product for bundle', {
          operation: 'DELETE',
          bundleId,
          userId,
          userEmail,
          details: {
            telegramProductId: bundle.externalId,
            error: deleteResult.error
          }
        });
      }
    } catch (telegramError) {
      bundleLogger.error('Telegram deletion error during bundle cleanup', {
        operation: 'DELETE',
        bundleId,
        userId,
        userEmail,
        details: {
          error: telegramError.message,
          telegramProductId: bundle.externalId
        }
      });
    }
  }

  // Delete bundle
  await Bundle.findByIdAndDelete(bundleId);

  bundleLogger.info('Bundle deleted successfully', {
    operation: 'DELETE',
    bundleId,
    userId,
    userEmail,
    details: {
      bundleBefore,
      telegramProductDeleted: !!bundle.externalId
    }
  });

  res.json({ 
    message: 'Bundle and related resources deleted successfully',
    telegramProductDeleted: !!bundle.externalId
  });
});