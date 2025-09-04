/**
 * Portfolio Controller with Enhanced PnL Tracking
 * 
 * Features:
 * - Automatic price sync from StockSymbol collection
 * - Real-time PnL calculations (unrealized gains/losses)
 * - Market value vs buy value tracking
 * - Comprehensive portfolio valuation
 * - Backward compatible with existing data
 * 
 * New Endpoints:
 * - PUT /portfolios/:id/update-market-prices - Update single portfolio with market prices
 * - GET /portfolios/:id/pnl-summary - Get comprehensive PnL summary
 * - PUT /portfolios/update-all-market-prices - Bulk update all portfolios
 */

const { default: mongoose } = require('mongoose');
const Portfolio = require('../models/modelPortFolio');
const PriceLog = require('../models/PriceLog');
const portfolioService = require('../services/portfolioservice');
const { PortfolioCalculationValidator } = require('../utils/portfolioCalculationValidator');
const transactionLogger = require('../utils/transactionLogger');
const TelegramService = require('../services/tgservice');
const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.resolve(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
  console.log(`Created logs directory at: ${logsDir}`);
}

// Enhanced Portfolio Operations Logger
const portfolioLogger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.printf(({ timestamp, level, message, operation, portfolioId, userId, details, ...rest }) => {
      let logMessage = `[${timestamp}] [${level.toUpperCase()}]`;
      
      if (operation) logMessage += ` [${operation}]`;
      if (portfolioId) logMessage += ` [Portfolio: ${portfolioId}]`;
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
      filename: path.join(logsDir, 'portfolio-operations.log'),
      maxsize: 20 * 1024 * 1024, // 20MB
      maxFiles: 15,
      tailable: true
    }),
    new winston.transports.File({ 
      filename: path.join(logsDir, 'portfolio-operations-error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
      tailable: true
    })
  ]
});

const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Production-level portfolio creation with comprehensive validation
 */
exports.createPortfolio = asyncHandler(async (req, res) => {
  const requestData = req.body;
  const userId = req.user?._id || 'Unknown';
  const userEmail = req.user?.email || 'Unknown';
  
  portfolioLogger.info('Portfolio creation started', {
    operation: 'CREATE',
    userId,
    userEmail,
    details: {
      requestData: {
        name: requestData.name,
        minInvestment: requestData.minInvestment,
        durationMonths: requestData.durationMonths,
        subscriptionFeeCount: requestData.subscriptionFee?.length || 0,
        holdingsCount: requestData.holdings?.length || 0
      }
    }
  });
  
  try {
    // Step 1: Validate required fields
    const requiredFields = ['name', 'subscriptionFee', 'minInvestment', 'durationMonths'];
    const missingFields = requiredFields.filter(field => !requestData[field]);
    
    if (missingFields.length > 0) {
      portfolioLogger.warn('Portfolio creation failed - missing required fields', {
        operation: 'CREATE',
        userId,
        details: { missingFields, providedFields: Object.keys(requestData) }
      });
      return res.status(400).json({ 
        error: 'Missing required fields',
        missingFields,
        requiredFields
      });
    }

    // Step 2: Validate subscription fee structure
    if (!Array.isArray(requestData.subscriptionFee) || requestData.subscriptionFee.length === 0) {
      return res.status(400).json({ error: 'At least one subscription fee is required' });
    }

    const invalidFees = requestData.subscriptionFee.filter(fee => 
      !fee.type || typeof fee.price !== 'number' || fee.price <= 0
    );
    
    if (invalidFees.length > 0) {
      return res.status(400).json({ 
        error: 'Invalid subscription fee structure',
        details: 'All fees must have type and price > 0'
      });
    }

    // Step 2.5: Validate emandate subscription fee structure (optional)
    if (requestData.emandateSubriptionFees) {
      if (!Array.isArray(requestData.emandateSubriptionFees)) {
        return res.status(400).json({ error: 'emandateSubriptionFees must be an array' });
      }
      
      if (requestData.emandateSubriptionFees.length > 0) {
        const invalidEmandateFees = requestData.emandateSubriptionFees.filter(fee => 
          !fee.type || typeof fee.price !== 'number' || fee.price <= 0
        );
        
        if (invalidEmandateFees.length > 0) {
          return res.status(400).json({ 
            error: 'Invalid emandate subscription fee structure',
            details: 'All emandate fees must have type and price > 0'
          });
        }
      }
    }

    //add telegram intigration bot here 
    // Step 6.5: Create Telegram product and group (if enabled)
    let telegramProductId = null;
    try {
      // Create product on Telegram service
      const telegramProduct = await TelegramService.createProduct({
        name: requestData.name.trim(),
        description: `Premium portfolio access for ${requestData.name.trim()}`,
        price: requestData.subscriptionFee[0]?.price || 0, // Use first subscription fee as base price
        category: requestData.PortfolioCategory || 'Basic'
      });
      
      if (telegramProduct.success) {
        telegramProductId = telegramProduct.product.id;
        portfolioLogger.info('Telegram product created successfully', {
          operation: 'CREATE',
          userId,
          userEmail,
          details: {
            telegramProductId,
            productName: telegramProduct.product.name,
            groupId: telegramProduct.product.group_id
          }
        });
      }
    } catch (telegramError) {
      portfolioLogger.warn('Telegram integration failed during portfolio creation', {
        operation: 'CREATE',
        userId,
        userEmail,
        details: {
          error: telegramError.message,
          portfolioName: requestData.name
        }
      });
      // Don't fail portfolio creation if Telegram integration fails
    }

    


    // Step 3: Calculate portfolio summary (for info only, don't block creation)
    const portfolioSummary = PortfolioCalculationValidator.calculatePortfolioSummary({
      holdings: requestData.holdings || [],
      minInvestment: requestData.minInvestment,
      currentMarketPrices: {} // Use buy prices for new portfolios
    });

    // SIMPLIFIED VALIDATION: Only check that total holdings don't exceed minInvestment
    const totalHoldingsCost = (requestData.holdings || []).reduce((sum, holding) => {
      return sum + (parseFloat(holding.buyPrice || 0) * parseFloat(holding.quantity || 0));
    }, 0);

    if (totalHoldingsCost > requestData.minInvestment) {
      return res.status(400).json({ 
        error: 'Total holdings cost exceeds minimum investment',
        details: {
          totalHoldingsCost: totalHoldingsCost,
          minInvestment: requestData.minInvestment,
          difference: totalHoldingsCost - requestData.minInvestment
        }
      });
    }

    // Step 4: REMOVED TAMPERING VALIDATION - Use backend calculations only
    // Backend will handle all calculations, ignore frontend values

    // Step 5: Validate benchmark symbol if provided
    if (requestData.compareWith) {
      const StockSymbol = require('../models/stockSymbol');
      let symbolExists = false;
      
      if (/^[0-9a-fA-F]{24}$/.test(requestData.compareWith)) {
        symbolExists = await StockSymbol.exists({ _id: requestData.compareWith });
      } else {
        symbolExists = await StockSymbol.exists({ symbol: requestData.compareWith });
      }
      
      if (!symbolExists) {
        return res.status(400).json({ 
          error: `Benchmark symbol "${requestData.compareWith}" does not exist` 
        });
      }
    }

    // Step 6: Create portfolio with validated data
    const portfolioData = {
      name: requestData.name.trim(),
      description: requestData.description || [],
      subscriptionFee: requestData.subscriptionFee,
      emandateSubriptionFees: requestData.emandateSubriptionFees,
      minInvestment: portfolioSummary.minInvestment,
      durationMonths: requestData.durationMonths,
      
      holdings: requestData.holdings || [],
      PortfolioCategory: requestData.PortfolioCategory || 'Basic',
      downloadLinks: requestData.downloadLinks || [],
      youTubeLinks: requestData.youTubeLinks || [],
      timeHorizon: requestData.timeHorizon || '',
      rebalancing: requestData.rebalancing || '',
      index: requestData.index || '',
      details: requestData.details || '',
      lastRebalanceDate: requestData.lastRebalanceDate,
      nextRebalanceDate: requestData.nextRebalanceDate,
      monthlyContribution: requestData.monthlyContribution || 0,
      compareWith: requestData.compareWith || '',
      
      // Use backend-calculated values
      cashBalance: portfolioSummary.cashBalance,
      currentValue: portfolioSummary.totalPortfolioValueAtBuy,
      
      // Add Telegram integration fields
      externalId: telegramProductId
    };

    // Debug logging before portfolio creation
    portfolioLogger.debug('Portfolio creation details', {
      operation: 'CREATE',
      details: {
        name: portfolioData.name,
        minInvestment: portfolioData.minInvestment,
        cashBalance: portfolioData.cashBalance,
        totalValue: portfolioData.currentValue,
        holdingsCount: portfolioData.holdings.length,
        subscriptionFee: portfolioData.subscriptionFee,
        emandateSubriptionFees: portfolioData.emandateSubriptionFees,
        category: portfolioData.PortfolioCategory,
        timeHorizon: portfolioData.timeHorizon,
        durationMonths: portfolioData.durationMonths
      }
    });

    // Log detailed holdings information
    if (portfolioData.holdings && portfolioData.holdings.length > 0) {
      portfolioLogger.debug('Initial portfolio holdings', {
        operation: 'CREATE',
        details: {
          holdings: portfolioData.holdings.map(holding => ({
            symbol: holding.symbol,
            sector: holding.sector,
            stockCapType: holding.stockCapType || 'Unknown',
            buyPrice: holding.buyPrice,
            quantity: holding.quantity,
            totalValue: holding.buyPrice * holding.quantity,
            minimumInvestmentValueStock: holding.minimumInvestmentValueStock,
            weight: holding.weight || 0
          }))
        }
      });
    }

    const portfolio = new Portfolio(portfolioData);
    const savedPortfolio = await portfolio.save();

    portfolioLogger.info('Portfolio created successfully', {
      operation: 'CREATE',
      portfolioId: savedPortfolio._id,
      userId,
      userEmail,
      details: {
        portfolioName: savedPortfolio.name,
        minInvestment: savedPortfolio.minInvestment,
        durationMonths: savedPortfolio.durationMonths,
        totalInvestment: portfolioSummary.totalActualInvestment,
        cashBalance: savedPortfolio.cashBalance,
        holdingsCount: savedPortfolio.holdings.length,
        subscriptionFeeTypes: savedPortfolio.subscriptionFee.map(fee => fee.type),
        emandateSubscriptionFeeTypes: savedPortfolio.emandateSubriptionFees.map(fee => fee.type),
        createdAt: savedPortfolio.createdAt,
        portfolioCategory: savedPortfolio.PortfolioCategory
      }
    });

    res.status(201).json(savedPortfolio);
    
  } catch (error) {
    // Enhanced error logging
    portfolioLogger.error('Portfolio creation failed', {
      operation: 'CREATE',
      userId,
      userEmail,
      details: {
        errorMessage: error.message,
        errorStack: error.stack,
        requestData: {
          name: requestData.name,
          minInvestment: requestData.minInvestment,
          holdingsCount: requestData.holdings?.length || 0
        }
      }
    });
    
    // Log error with transaction context
    await transactionLogger.logError(error, `Portfolio Creation`);
    
    res.status(500).json({
      error: 'Portfolio creation failed',
      message: error.message
    });
  }
});

/**
 * Get all portfolios
 */
exports.getAllPortfolios = asyncHandler(async (req, res) => { 
  const userId = req.user?.id;
  const userEmail = req.user?.email;
  const startTime = Date.now();
  
  portfolioLogger.info('Fetching all portfolios', {
    operation: 'READ_ALL',
    userId,
    userEmail,
    details: {
      timestamp: new Date().toISOString()
    }
  });
  
  const portfolios = await Portfolio.find().sort('name');
  const endTime = Date.now();
  
  portfolioLogger.info('All portfolios fetched successfully', {
    operation: 'READ_ALL',
    userId,
    userEmail,
    details: {
      portfolioCount: portfolios.length,
      fetchTimeMs: endTime - startTime,
      timestamp: new Date().toISOString()
    }
  });
  
  res.status(200).json(portfolios);
});

/**
 * Get portfolio by ID
 */
exports.getPortfolioById = asyncHandler(async (req, res) => {
  const portfolioId = req.params.id;
  const userId = req.user?.id;
  const userEmail = req.user?.email;
  const startTime = Date.now();
  
  portfolioLogger.info('Fetching portfolio by ID', {
    operation: 'READ',
    portfolioId,
    userId,
    userEmail,
    details: {
      timestamp: new Date().toISOString()
    }
  });
  
  const portfolio = await Portfolio.findById(portfolioId);
  const endTime = Date.now();
  
  if (!portfolio) {
    portfolioLogger.warn('Portfolio not found', {
      operation: 'READ',
      portfolioId,
      userId,
      userEmail,
      details: {
        error: 'Portfolio not found',
        fetchTimeMs: endTime - startTime,
        timestamp: new Date().toISOString()
      }
    });
    return res.status(404).json({ error: 'Portfolio not found' });
  }
  
  portfolioLogger.info('Portfolio fetched successfully', {
    operation: 'READ',
    portfolioId,
    userId,
    userEmail,
    details: {
      portfolioName: portfolio.name,
      holdingsCount: portfolio.holdings?.length || 0,
      cashBalance: portfolio.cashBalance,
      fetchTimeMs: endTime - startTime,
      timestamp: new Date().toISOString()
    }
  });
  
  res.status(200).json(portfolio);
});

/**
 * Delete portfolio
 */
exports.deletePortfolio = asyncHandler(async (req, res) => {
  const portfolio = await Portfolio.findById(req.params.id);
  if (!portfolio) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }
  
  await Portfolio.findByIdAndDelete(req.params.id);
  res.json({ message: 'Portfolio deleted successfully' });
});

exports.getPortfolioPriceHistory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { period = '1m', tz = 'Asia/Kolkata' } = req.query;

  // Validate portfolio ID
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ 
      status: 'error',
      error: 'Invalid portfolio ID format',
      message: 'The provided portfolio ID is not a valid MongoDB ObjectId'
    });
  }

  try {
    const portfolioService = require('../services/portfolioservice');
    const historyData = await portfolioService.getPortfolioHistory(id, period, tz);
    
    if (!historyData.data || historyData.dataPoints === 0) {
      return res.status(404).json({ 
        status: 'error',
        error: 'No price history found',
        message: 'No price history data available for this portfolio in the specified period'
      });
    }

    res.status(200).json({
      status: 'success',
      message: `Retrieved ${historyData.dataPoints} portfolio points and ${historyData.compareDataPoints} benchmark points`,
      ...historyData
    });
  } catch (error) {
    portfolioLogger.error('Portfolio price history error', { 
      operation: 'READ_HISTORY',
      portfolioId: id,
      details: {
        error: error.message,
        period,
        tz
      }
    });
    res.status(500).json({ 
      status: 'error',
      error: 'Failed to retrieve price history',
      message: error.message || 'Internal server error while retrieving portfolio price history'
    });
  }
});

// filepath: controllers/portfolioController.js
exports.updatePortfolio = asyncHandler(async (req, res) => {
  const portfolioId = req.params.id;
  const userId = req.user?._id || 'Unknown';
  const userEmail = req.user?.email || 'Unknown';
  
  // Log the start of update operation
  portfolioLogger.info('Portfolio update started', {
    operation: 'UPDATE',
    portfolioId,
    userId,
    userEmail,
    details: {
      requestFields: Object.keys(req.body),
      stockAction: req.body.stockAction || 'update',
      hasHoldings: !!req.body.holdings,
      holdingsCount: req.body.holdings?.length || 0,
      updateType: req.body.stockAction || 'field-update'
    }
  });

  const portfolio = await Portfolio.findById(portfolioId);
  
  if (!portfolio) {
    portfolioLogger.warn('Portfolio update failed - portfolio not found', {
      operation: 'UPDATE',
      portfolioId,
      userId,
      userEmail
    });
    return res.status(404).json({ 
      status: "error",
      message: "Portfolio not found" 
    });
  }

  // Log portfolio state before update
  const portfolioBefore = {
    name: portfolio.name,
    cashBalance: portfolio.cashBalance,
    holdingsCount: portfolio.holdings.length,
    totalValue: portfolio.totalValue,
    minInvestment: portfolio.minInvestment
  };

  portfolioLogger.debug('Portfolio state before update', {
    operation: 'UPDATE',
    portfolioId,
    userId,
    details: { portfolioBefore }
  });

  // Prevent changing minInvestment after creation
  if (req.body.minInvestment && req.body.minInvestment !== portfolio.minInvestment) {
    return res.status(400).json({ error: 'Minimum investment cannot be changed after creation' });
  }

  // Validate subscription fee if provided
  if (req.body.subscriptionFee) {
    if (!Array.isArray(req.body.subscriptionFee) || req.body.subscriptionFee.length === 0 ||
        req.body.subscriptionFee.some(fee => !fee.type || fee.price == null)) {
      return res.status(400).json({ error: 'Invalid subscription fee structure' });
    }
  }

  // Validate emandate subscription fee if provided
  if (req.body.emandateSubriptionFees) {
    if (!Array.isArray(req.body.emandateSubriptionFees) || req.body.emandateSubriptionFees.length === 0 ||
        req.body.emandateSubriptionFees.some(fee => !fee.type || fee.price == null)) {
      return res.status(400).json({ error: 'Invalid emandate subscription fee structure' });
    }
  }

  // Validate description items
  if (req.body.description && req.body.description.some(item => !item.key || !item.value)) {
    return res.status(400).json({ error: 'Description items must have key and value' });
  }

  // Validate benchmark symbol if provided
  if (req.body.compareWith) {
    const StockSymbol = require('../models/stockSymbol');
    let symbolExists = false;
    
    // Check if it's a MongoDB ObjectId
    if (/^[0-9a-fA-F]{24}$/.test(req.body.compareWith)) {
      symbolExists = await StockSymbol.exists({ _id: req.body.compareWith });
    } else {
      symbolExists = await StockSymbol.exists({ symbol: req.body.compareWith });
    }
    
    if (!symbolExists) {
      return res.status(400).json({ error: `Benchmark symbol "${req.body.compareWith}" does not exist` });
    }
  }

  const stockAction = req.body.stockAction ? req.body.stockAction.toLowerCase() : 'update';
  
  // Track if holdings were actually modified
  let holdingsModified = false;

  // Handle holdings based on stockAction
  if (req.body.holdings) {
    holdingsModified = true;
    if (!Array.isArray(req.body.holdings)) {
      return res.status(400).json({ error: 'Holdings must be an array' });
    }

    let updatedHoldings = [...portfolio.holdings];

    if (stockAction.includes('add')) {
      // ADD: Add new holdings without affecting existing ones
      for (const newHolding of req.body.holdings) {
        // Validate required fields for new holdings
        if (!newHolding.symbol || !newHolding.sector || !newHolding.buyPrice || 
            !newHolding.quantity || !newHolding.minimumInvestmentValueStock) {
          return res.status(400).json({ 
            error: `New holding missing required fields (symbol, sector, buyPrice, quantity, minimumInvestmentValueStock)` 
          });
        }

        // Check if holding already exists
        const existingHolding = updatedHoldings.find(h => h.symbol === newHolding.symbol);
        if (existingHolding) {
          return res.status(400).json({ 
            error: `Holding with symbol ${newHolding.symbol} already exists. Use update action to modify existing holdings.` 
          });
        }

        // Validate minimumInvestmentValueStock
        if (newHolding.minimumInvestmentValueStock < 1) {
          return res.status(400).json({ 
            error: `Holding ${newHolding.symbol}: minimumInvestmentValueStock must be >= 1` 
          });
        }

        // Calculate cost and deduct from cash balance
        const buyPrice = parseFloat(newHolding.buyPrice) || 0;
        const quantity = parseFloat(newHolding.quantity) || 0;
        const totalCost = buyPrice * quantity;
        
        // Deduct cash balance for added holdings
        const oldCashBalance = portfolio.cashBalance || 0;
        portfolio.cashBalance = Math.max(0, oldCashBalance - totalCost);
        
        portfolioLogger.info('Cash balance deducted for ADD action', {
          operation: 'UPDATE-ADD',
          portfolioId,
          userId,
          details: {
            symbol: newHolding.symbol,
            buyPrice,
            quantity,
            totalCost,
            oldCashBalance,
            newCashBalance: portfolio.cashBalance,
            action: 'stock-add'
          }
        });

        updatedHoldings.push(newHolding);
      }

    } else if (stockAction.includes('buy')) {
      // BUY: Add to existing holdings using buy price averaging
      
      // Capture portfolio state before transaction
      const portfolioBefore = {
        totalValue: portfolio.totalValue || portfolio.minInvestment,
        cashBalance: portfolio.cashBalance || portfolio.minInvestment,
        totalInvestment: portfolio.holdings.reduce((sum, h) => sum + (h.buyPrice * h.quantity), 0),
        minInvestment: portfolio.minInvestment,
        holdingsCount: portfolio.holdings.length
      };
      
      for (const buyRequest of req.body.holdings) {
        // PATCH: Reuse existing holding values for missing fields
        let existingHolding = portfolio.holdings.find(h => h.symbol === buyRequest.symbol);
        let sector = buyRequest.sector || (existingHolding ? existingHolding.sector : undefined);
        let buyPrice = buyRequest.buyPrice || (existingHolding ? existingHolding.buyPrice : undefined);
        let quantity = buyRequest.quantity !== undefined ? buyRequest.quantity : (existingHolding ? existingHolding.quantity : 0);
        // Validate required fields for buy action
        const missingFields = [];
        if (!buyRequest.symbol) missingFields.push('symbol');
        if (!sector) missingFields.push('sector');
        if (!buyPrice) missingFields.push('buyPrice');
        if (missingFields.length > 0) {
          portfolioLogger.error('Buy request validation failed - missing required fields (after patch reuse)', {
            operation: 'UPDATE',
            portfolioId: portfolio._id,
            details: {
              stockAction,
              receivedFields: Object.keys(buyRequest),
              missingFields,
              buyRequest,
              requiredFields: ['symbol', 'sector', 'buyPrice'],
              optionalFields: ['quantity', 'stockCapType', 'minimumInvestmentValueStock'],
              reusedFromExisting: existingHolding ? existingHolding : null
            }
          });
          return res.status(400).json({ 
            error: `Buy request missing required fields: ${missingFields.join(', ')}`,
            receivedFields: Object.keys(buyRequest),
            requiredFields: ['symbol', 'sector', 'buyPrice'],
            optionalFields: ['quantity', 'stockCapType', 'minimumInvestmentValueStock'],
            reusedFromExisting: existingHolding ? existingHolding : null,
            example: {
              symbol: "RELIANCE",
              sector: "Energy",
              buyPrice: 2500.00,
              quantity: 10
            }
          });
        }
        // Use the resolved values for further processing
        buyRequest.sector = sector;
        buyRequest.buyPrice = buyPrice;
        buyRequest.quantity = quantity;

        if (isNaN(buyPrice) || buyPrice <= 0) {
          portfolioLogger.error('Buy request validation failed - invalid buy price', {
            operation: 'UPDATE',
            portfolioId: portfolio._id,
            details: {
              stockAction,
              symbol: buyRequest.symbol,
              receivedBuyPrice: buyRequest.buyPrice,
              parsedBuyPrice: buyPrice,
              quantity
            }
          });
          
          return res.status(400).json({ 
            error: `Buy price must be a valid positive number for ${buyRequest.symbol}`,
            receivedBuyPrice: buyRequest.buyPrice,
            validExample: "2500.00"
          });
        }

        // Validate quantity if provided
        if (buyRequest.quantity !== undefined && (isNaN(quantity) || quantity < 0)) {
          portfolioLogger.error('Buy request validation failed - invalid quantity', {
            operation: 'UPDATE',
            portfolioId: portfolio._id,
            details: {
              stockAction,
              symbol: buyRequest.symbol,
              receivedQuantity: buyRequest.quantity,
              parsedQuantity: quantity
            }
          });
          
          return res.status(400).json({ 
            error: `Quantity must be a valid non-negative number for ${buyRequest.symbol}`,
            receivedQuantity: buyRequest.quantity,
            note: "Quantity can be 0 for amount-only purchases"
          });
        }

        // Get stock market data for logging
        const StockSymbol = require('../models/stockSymbol');
        const stockData = await StockSymbol.findOne({ symbol: buyRequest.symbol.toUpperCase() });
        
        // Find existing holding and capture before state
        const existingHoldingIndex = updatedHoldings.findIndex(h => h.symbol === buyRequest.symbol);
        const beforeState = existingHoldingIndex >= 0 ? {
          exists: true,
          quantity: updatedHoldings[existingHoldingIndex].quantity,
          buyPrice: updatedHoldings[existingHoldingIndex].buyPrice,
          investmentValue: updatedHoldings[existingHoldingIndex].investmentValueAtBuy,
          totalInvestment: updatedHoldings[existingHoldingIndex].buyPrice * updatedHoldings[existingHoldingIndex].quantity,
          weight: updatedHoldings[existingHoldingIndex].weight || 0,
          unrealizedPnL: updatedHoldings[existingHoldingIndex].unrealizedPnL || 0
        } : { exists: false };
        
        const transactionData = {
          buyPrice: buyPrice,
          quantity: quantity,
          totalInvestment: buyPrice * quantity,
          transactionFee: 0, // Can be added if needed
          netAmount: buyPrice * quantity
        };
        
        if (existingHoldingIndex >= 0 && quantity > 0) {
          // Update existing holding with weighted average buy price
          const existingHolding = updatedHoldings[existingHoldingIndex];
          const existingValue = existingHolding.buyPrice * existingHolding.quantity;
          const newValue = buyPrice * quantity;
          const totalQuantity = existingHolding.quantity + quantity;
          const totalValue = existingValue + newValue;
          
          // Store original buy price if not already set
          if (!existingHolding.originalBuyPrice) {
            existingHolding.originalBuyPrice = existingHolding.buyPrice;
          }
          
          // Calculate weighted average buy price
          existingHolding.buyPrice = parseFloat((totalValue / totalQuantity).toFixed(2));
          existingHolding.quantity = totalQuantity;
          existingHolding.status = buyRequest.status || 'addon-buy';
          existingHolding.lastUpdated = new Date();
          
          // Update cash balance: deduct the cost of the new purchase
          const oldCashBalance = portfolio.cashBalance || 0;
          portfolio.cashBalance = Math.max(0, oldCashBalance - transactionData.netAmount);
          
          portfolioLogger.info('Cash balance deducted for ADDON-BUY', {
            operation: 'UPDATE-ADDON-BUY',
            portfolioId,
            userId,
            details: {
              symbol: buyRequest.symbol,
              buyPrice,
              quantity,
              netAmount: transactionData.netAmount,
              oldCashBalance,
              newCashBalance: portfolio.cashBalance,
              action: 'addon-buy',
              averagedBuyPrice: existingHolding.buyPrice,
              totalQuantity: existingHolding.quantity
            }
          });
          
          // Log the transaction
          await transactionLogger.logBuyTransaction({
            portfolioId: portfolio._id,
            portfolioName: portfolio.name,
            stockSymbol: buyRequest.symbol.toUpperCase(),
            action: 'addon-buy',
            beforeState,
            stockData: stockData || { currentPrice: buyPrice, symbol: buyRequest.symbol },
            transactionData,
            afterState: {
              quantity: existingHolding.quantity,
              buyPrice: existingHolding.buyPrice,
              investmentValueAtBuy: existingHolding.buyPrice * existingHolding.quantity,
              investmentValueAtMarket: buyPrice * existingHolding.quantity, // Use buyPrice for initial market value
              weight: 0, // Will be calculated after save
              unrealizedPnL: (buyPrice - existingHolding.buyPrice) * existingHolding.quantity, // Use buyPrice
              unrealizedPnLPercent: ((buyPrice - existingHolding.buyPrice) / existingHolding.buyPrice) * 100, // Use buyPrice
              status: existingHolding.status
            },
            portfolioBefore,
            portfolioAfter: {
              totalValue: portfolioBefore.totalValue + transactionData.totalInvestment,
              cashBalance: portfolio.cashBalance, // Use the updated cash balance
              totalInvestment: portfolioBefore.totalInvestment + transactionData.totalInvestment,
              holdingsCount: portfolioBefore.holdingsCount
            },
            userEmail: req.user?.email || 'Unknown'
          });
          
        } else if (quantity > 0) {
          // Create new holding
          const newHolding = {
            symbol: buyRequest.symbol.toUpperCase(),
            sector: buyRequest.sector,
            stockCapType: buyRequest.stockCapType,
            status: buyRequest.status || 'Fresh-Buy',
            buyPrice: buyPrice,
            originalBuyPrice: buyPrice,
            quantity: quantity,
            minimumInvestmentValueStock: buyPrice * quantity,
            currentPrice: buyPrice, // Will be updated by pre-save hook
            investmentValueAtBuy: buyPrice * quantity,
            investmentValueAtMarket: buyPrice * quantity, // Will be updated by pre-save hook
            unrealizedPnL: 0,
            unrealizedPnLPercent: 0,
            realizedPnL: 0,
            priceHistory: [{
              date: new Date(),
              price: buyPrice,
              quantity: quantity,
              investment: buyPrice * quantity,
              action: 'buy'
            }],
            lastUpdated: new Date(),
            createdAt: new Date()
          };
          
          updatedHoldings.push(newHolding);
          
          // Update cash balance: deduct the cost of the new purchase
          const oldCashBalance = portfolio.cashBalance || 0;
          portfolio.cashBalance = Math.max(0, oldCashBalance - transactionData.netAmount);
          
          portfolioLogger.info('Cash balance deducted for FRESH-BUY', {
            operation: 'UPDATE-FRESH-BUY',
            portfolioId,
            userId,
            details: {
              symbol: buyRequest.symbol,
              buyPrice,
              quantity,
              netAmount: transactionData.netAmount,
              oldCashBalance,
              newCashBalance: portfolio.cashBalance,
              action: 'fresh-buy',
              newHoldingCreated: true
            }
          });
          
          // Log the transaction
          await transactionLogger.logBuyTransaction({
            portfolioId: portfolio._id,
            portfolioName: portfolio.name,
            stockSymbol: buyRequest.symbol.toUpperCase(),
            action: 'Fresh-Buy',
            beforeState,
            stockData: stockData || { currentPrice: buyPrice, symbol: buyRequest.symbol },
            transactionData,
            afterState: {
              quantity: newHolding.quantity,
              buyPrice: newHolding.buyPrice,
              investmentValueAtBuy: newHolding.investmentValueAtBuy,
              investmentValueAtMarket: newHolding.investmentValueAtMarket,
              weight: 0, // Will be calculated after save
              unrealizedPnL: newHolding.unrealizedPnL,
              unrealizedPnLPercent: newHolding.unrealizedPnLPercent,
              status: newHolding.status
            },
            portfolioBefore,
            portfolioAfter: {
              totalValue: portfolioBefore.totalValue + transactionData.totalInvestment,
              cashBalance: portfolio.cashBalance, // Use the updated cash balance
              totalInvestment: portfolioBefore.totalInvestment + transactionData.totalInvestment,
              holdingsCount: portfolioBefore.holdingsCount + 1
            },
            userEmail: req.user?.email || 'Unknown'
          });
          
        } else {
          // Just update the current price for tracking without buying
          const existingHolding = updatedHoldings[existingHoldingIndex];
          if (existingHolding) {
            existingHolding.currentPrice = buyPrice;
            existingHolding.lastUpdated = new Date();
          }
        }
      }

    } else if (stockAction.includes('delete') || stockAction.includes('remove')) {
      // DELETE: Remove holdings by symbol
      // Validate that holdings array contains symbols
      if (!req.body.holdings || !Array.isArray(req.body.holdings) || req.body.holdings.length === 0) {
        portfolioLogger.error('Delete request validation failed - no holdings provided', {
          operation: 'UPDATE',
          portfolioId: portfolio._id,
          details: {
            stockAction,
            receivedHoldings: req.body.holdings,
            requiredFormat: 'Array of objects with symbol field'
          }
        });
        
        return res.status(400).json({ 
          error: `Delete request requires holdings array with symbols`,
          requiredFormat: [{ symbol: "RELIANCE" }, { symbol: "TCS" }],
          received: req.body.holdings
        });
      }
      
      // Check that all holdings have symbols
      const invalidHoldings = req.body.holdings.filter(h => !h.symbol);
      if (invalidHoldings.length > 0) {
        portfolioLogger.error('Delete request validation failed - holdings missing symbols', {
          operation: 'UPDATE',
          portfolioId: portfolio._id,
          details: {
            stockAction,
            invalidHoldings,
            totalHoldings: req.body.holdings.length
          }
        });
        
        return res.status(400).json({ 
          error: `Some holdings are missing symbol field`,
          invalidHoldings: invalidHoldings,
          requiredFormat: { symbol: "STOCK_SYMBOL" }
        });
      }
      
      const symbolsToDelete = req.body.holdings.map(h => h.symbol.toUpperCase());
      const initialCount = updatedHoldings.length;
      
      updatedHoldings = updatedHoldings.filter(holding => 
        !symbolsToDelete.includes(holding.symbol.toUpperCase())
      );

      const deletedCount = initialCount - updatedHoldings.length;
      if (deletedCount === 0) {
        portfolioLogger.warn('Delete request failed - no holdings found', {
          operation: 'UPDATE',
          portfolioId: portfolio._id,
          details: {
            stockAction,
            symbolsToDelete,
            existingSymbols: portfolio.holdings.map(h => h.symbol),
            deletedCount: 0
          }
        });
        
        return res.status(400).json({ 
          error: `No holdings found with symbols: ${symbolsToDelete.join(', ')}`,
          existingSymbols: portfolio.holdings.map(h => h.symbol),
          requestedSymbols: symbolsToDelete
        });
      }

    } else if (stockAction.includes('replace')) {
      // REPLACE: Replace entire holdings array
      for (const holding of req.body.holdings) {
        // Validate required fields
        const missingFields = [];
        if (!holding.symbol) missingFields.push('symbol');
        if (!holding.sector) missingFields.push('sector');
        if (!holding.buyPrice) missingFields.push('buyPrice');
        if (!holding.quantity) missingFields.push('quantity');
        if (!holding.minimumInvestmentValueStock) missingFields.push('minimumInvestmentValueStock');
        
        if (missingFields.length > 0) {
          portfolioLogger.error('Replace request validation failed - missing required fields', {
            operation: 'UPDATE',
            portfolioId: portfolio._id,
            details: {
              stockAction,
              symbol: holding.symbol || 'Unknown',
              missingFields,
              receivedFields: Object.keys(holding),
              requiredFields: ['symbol', 'sector', 'buyPrice', 'quantity', 'minimumInvestmentValueStock']
            }
          });
          
          return res.status(400).json({ 
            error: `Holding missing required fields: ${missingFields.join(', ')}`,
            symbol: holding.symbol || 'Unknown',
            receivedFields: Object.keys(holding),
            requiredFields: ['symbol', 'sector', 'buyPrice', 'quantity', 'minimumInvestmentValueStock'],
            example: {
              symbol: "RELIANCE",
              sector: "Energy",
              buyPrice: 2500.00,
              quantity: 10,
              minimumInvestmentValueStock: 25000
            }
          });
        }

        // Validate minimumInvestmentValueStock
        if (holding.minimumInvestmentValueStock < 1) {
          portfolioLogger.error('Replace request validation failed - invalid minimumInvestmentValueStock', {
            operation: 'UPDATE',
            portfolioId: portfolio._id,
            details: {
              stockAction,
              symbol: holding.symbol,
              minimumInvestmentValueStock: holding.minimumInvestmentValueStock
            }
          });
          
          return res.status(400).json({ 
            error: `Holding ${holding.symbol}: minimumInvestmentValueStock must be >= 1`,
            received: holding.minimumInvestmentValueStock,
            minimum: 1
          });
        }
      }
      updatedHoldings = req.body.holdings;

      // For replace action, recalculate cash balance from minInvestment
      const totalHoldingsCost = updatedHoldings.reduce((sum, holding) => {
        const buyPrice = parseFloat(holding.buyPrice) || 0;
        const quantity = parseFloat(holding.quantity) || 0;
        return sum + (buyPrice * quantity);
      }, 0);
      
      const minInvestment = parseFloat(portfolio.minInvestment) || 0;
      portfolio.cashBalance = Math.max(0, minInvestment - totalHoldingsCost);

    } else if (stockAction.includes('sell')) {
      // SELL: Process stock sales using portfolio service
      const portfolioService = require('../services/portfolioservice');
      
      for (const saleRequest of req.body.holdings) {
        // Validate required fields for sell action
        if (!saleRequest.symbol) {
          portfolioLogger.error('Sell request validation failed - missing symbol', {
            operation: 'UPDATE',
            portfolioId: portfolio._id,
            details: {
              stockAction,
              receivedFields: Object.keys(saleRequest),
              saleRequest,
              requiredFields: ['symbol'],
              optionalFields: ['quantity', 'saleType']
            }
          });
          
          return res.status(400).json({ 
            error: `Sale request missing required field: symbol`,
            receivedFields: Object.keys(saleRequest),
            requiredFields: ['symbol'],
            optionalFields: ['quantity', 'saleType'],
            example: {
              symbol: "RELIANCE",
              quantity: 5,
              saleType: "partial"
            }
          });
        }

        // Set default saleType to 'complete' if not specified
        const saleType = saleRequest.saleType || 'complete';
        
        // Find the existing holding to get quantity information
        const existingHolding = portfolio.holdings.find(
          h => h.symbol.toUpperCase() === saleRequest.symbol.toUpperCase() && h.status !== 'Sell'
        );

        if (!existingHolding) {
          return res.status(400).json({ 
            error: `Holding not found for symbol: ${saleRequest.symbol}` 
          });
        }

        // Determine quantity to sell
        let quantityToSell = saleRequest.quantity || existingHolding.quantity;
        if (saleType === 'complete') {
          quantityToSell = existingHolding.quantity;
        }

        // Process the sale
        try {
          const saleResult = await portfolioService.processStockSaleWithLogging(portfolio._id, {
            symbol: saleRequest.symbol,
            quantityToSell: quantityToSell,
            saleType: saleType
          });

          // Sale processed successfully - logged via portfolioLogger
        } catch (saleError) {
          portfolioLogger.error('Stock sale processing failed', { 
            operation: 'UPDATE',
            portfolioId: portfolio._id,
            details: {
              symbol: saleRequest.symbol, 
              error: saleError.message,
              quantityToSell,
              saleType
            }
          });
          return res.status(400).json({ 
            error: `Failed to process sale for ${saleRequest.symbol}: ${saleError.message}` 
          });
        }
      }

      // Refresh the portfolio to get updated holdings and cash balance after sales
      const refreshedPortfolio = await Portfolio.findById(portfolio._id);
      
      // For sell actions, return the updated portfolio immediately without further processing
      // since portfolioService.processStockSaleWithLogging already saved all changes
      return res.status(200).json({
        message: 'Stock sale(s) processed successfully',
        portfolio: refreshedPortfolio
      });

    } else {
      // DEFAULT/UPDATE: Merge holdings - update existing by symbol, add new ones
      for (const newHolding of req.body.holdings) {
        // Sanitize and validate numeric fields
        const sanitizedHolding = {
          ...newHolding,
          buyPrice: parseFloat(newHolding.buyPrice) || 0,
          quantity: parseFloat(newHolding.quantity) || 0,
          minimumInvestmentValueStock: parseFloat(newHolding.minimumInvestmentValueStock) || 0,
          weight: parseFloat(newHolding.weight) || 0,
          realizedPnL: parseFloat(newHolding.realizedPnL) || 0,
          currentPrice: parseFloat(newHolding.currentPrice) || parseFloat(newHolding.buyPrice) || 0
        };

        // Calculate investment values and PnL
        sanitizedHolding.investmentValueAtBuy = parseFloat((sanitizedHolding.buyPrice * sanitizedHolding.quantity).toFixed(2));
        
        // Note: currentPrice will be automatically fetched from StockSymbol collection in pre-save hook
        // For immediate calculation, use provided currentPrice or buyPrice as fallback
        sanitizedHolding.investmentValueAtMarket = parseFloat((sanitizedHolding.currentPrice * sanitizedHolding.quantity).toFixed(2));
        sanitizedHolding.unrealizedPnL = parseFloat((sanitizedHolding.investmentValueAtMarket - sanitizedHolding.investmentValueAtBuy).toFixed(2));
        
        if (sanitizedHolding.investmentValueAtBuy > 0) {
          sanitizedHolding.unrealizedPnLPercent = parseFloat(((sanitizedHolding.unrealizedPnL / sanitizedHolding.investmentValueAtBuy) * 100).toFixed(2));
        } else {
          sanitizedHolding.unrealizedPnLPercent = 0;
        }

        // Update minimumInvestmentValueStock to current market value
        sanitizedHolding.minimumInvestmentValueStock = sanitizedHolding.investmentValueAtMarket;

        // Validate that numeric fields are valid numbers (not NaN or negative where inappropriate)
        if (isNaN(sanitizedHolding.buyPrice) || sanitizedHolding.buyPrice <= 0) {
          return res.status(400).json({ 
            error: `Holding ${newHolding.symbol}: buyPrice must be a valid positive number` 
          });
        }

        if (isNaN(sanitizedHolding.quantity) || sanitizedHolding.quantity <= 0) {
          return res.status(400).json({ 
            error: `Holding ${newHolding.symbol}: quantity must be a valid positive number` 
          });
        }

        if (isNaN(sanitizedHolding.minimumInvestmentValueStock) || sanitizedHolding.minimumInvestmentValueStock < 1) {
          return res.status(400).json({ 
            error: `Holding ${newHolding.symbol}: minimumInvestmentValueStock must be >= 1` 
          });
        }

        const existingIndex = updatedHoldings.findIndex(h => h.symbol === sanitizedHolding.symbol);
        
        if (existingIndex >= 0) {
          // Update existing holding
          updatedHoldings[existingIndex] = { ...updatedHoldings[existingIndex], ...sanitizedHolding };
        } else {
          // Add new holding - validate required fields
          if (!sanitizedHolding.symbol || !sanitizedHolding.sector) {
            return res.status(400).json({ 
              error: `New holding ${sanitizedHolding.symbol} missing required fields (symbol, sector)` 
            });
          }
          updatedHoldings.push(sanitizedHolding);
        }
      }
    }

    // Update portfolio holdings
    portfolio.holdings = updatedHoldings;
    
    // For sell actions, cash balance is already calculated by portfolioService
    // For other actions, check if this is the first initialization or an update
    if (!stockAction.includes('sell')) {
      // Check if this is a new portfolio initialization (no existing cash balance)
      if (portfolio.cashBalance === undefined || portfolio.cashBalance === null) {
        // First initialization ONLY: Calculate cash from minInvestment minus holdings cost
        const totalHoldingsCostAtBuy = updatedHoldings.reduce((sum, holding) => {
          const buyPrice = parseFloat(holding.buyPrice) || 0;
          const quantity = parseFloat(holding.quantity) || 0;
          return sum + (buyPrice * quantity);
        }, 0);
        
        // Initial cash balance based on minInvestment (only for first setup)
        const minInvestment = parseFloat(portfolio.minInvestment) || 0;
        const calculatedCashBalance = minInvestment - totalHoldingsCostAtBuy;
        
        // Ensure cash balance is valid and not negative
        portfolio.cashBalance = Math.max(0, parseFloat(calculatedCashBalance.toFixed(2)));
        
        portfolioLogger.info('Portfolio initial cash balance calculated', {
          operation: 'UPDATE',
          portfolioId: portfolio._id,
          details: {
            minInvestment,
            totalHoldingsCostAtBuy,
            initialCashBalance: portfolio.cashBalance
          }
        });
      }
      // For existing portfolios, PRESERVE the cash balance (acts as a wallet)
      // This ensures all sales proceeds correctly accumulate in the wallet
      
      // Calculate investment values and PnL for each holding
      updatedHoldings.forEach(holding => {
        const buyPrice = parseFloat(holding.buyPrice) || 0;
        const quantity = parseFloat(holding.quantity) || 0;
        
        // Calculate investment values
        holding.investmentValueAtBuy = parseFloat((buyPrice * quantity).toFixed(2));
        
        // Note: currentPrice will be fetched from StockSymbol collection in pre-save hook
        // For now, use buyPrice as fallback if currentPrice not provided
        const currentPrice = parseFloat(holding.currentPrice) || buyPrice;
        holding.currentPrice = currentPrice;
        holding.investmentValueAtMarket = parseFloat((currentPrice * quantity).toFixed(2));
        
        // Calculate unrealized PnL
        holding.unrealizedPnL = parseFloat((holding.investmentValueAtMarket - holding.investmentValueAtBuy).toFixed(2));
        
        // Calculate unrealized PnL percentage
        if (holding.investmentValueAtBuy > 0) {
          holding.unrealizedPnLPercent = parseFloat(((holding.unrealizedPnL / holding.investmentValueAtBuy) * 100).toFixed(2));
        } else {
          holding.unrealizedPnLPercent = 0;
        }
        
        // Update minimumInvestmentValueStock to current market value
        holding.minimumInvestmentValueStock = holding.investmentValueAtMarket;
      });
    }
    
    // Remove holdings and stockAction from further processing
    delete req.body.holdings;
    delete req.body.stockAction;
  }

  // Update other allowed fields (ignore calculated fields from frontend)
  const allowedUpdates = [
            'name', 'description', 'subscriptionFee', 'emandateSubriptionFees', 
    'PortfolioCategory', 'downloadLinks', 'youTubeLinks', 'timeHorizon', 
    'rebalancing', 'index', 'details', 'compareWith', 
    'lastRebalanceDate', 'nextRebalanceDate', 'monthlyContribution',
    'durationMonths'
  ];
  
  // Explicitly ignore calculated fields that should not come from frontend
  const ignoredFields = [
    'cashBalance', 'currentValue', 'holdingsValue', 'holdingsValueAtMarket',
    'weight', 'CAGRSinceInception', 'monthlyGains', 'oneYearGains',
    'historicalValues', 'daysSinceCreation'
  ];
  
  allowedUpdates.forEach(field => {
    if (req.body[field] !== undefined) {
      portfolio[field] = req.body[field];
    }
  });
  
  // Log warning if frontend tries to send calculated fields
  ignoredFields.forEach(field => {
    if (req.body[field] !== undefined) {
      portfolioLogger.debug('Ignoring calculated field from frontend', { 
        operation: 'UPDATE',
        portfolioId: portfolio._id,
        details: { field }
      });
    }
  });

  // Save portfolio (this will trigger pre-save hooks to recalculate weights and values)
  const saveStartTime = Date.now();
  await portfolio.save();
  const saveEndTime = Date.now();
  
  // Log portfolio snapshot after transaction (only if holdings were modified)
  if (holdingsModified && stockAction && (stockAction.includes('buy') || stockAction.includes('sell'))) {
    await transactionLogger.logPortfolioSnapshot(portfolio, `After ${stockAction} transaction`);
  }
  
  // Get portfolio state after update
  const populatedPortfolio = await Portfolio.findById(portfolio._id);
  const portfolioAfter = {
    name: populatedPortfolio.name,
    cashBalance: populatedPortfolio.cashBalance,
    holdingsCount: populatedPortfolio.holdings.length,
    totalValue: populatedPortfolio.totalValue,
    holdingsValue: populatedPortfolio.holdingsValue
  };

  // Log successful update
  portfolioLogger.info('Portfolio update completed successfully', {
    operation: 'UPDATE',
    portfolioId,
    userId,
    userEmail,
    details: {
      stockAction,
      holdingsModified,
      saveTimeMs: saveEndTime - saveStartTime,
      portfolioBefore,
      portfolioAfter,
      fieldsUpdated: Object.keys(req.body).filter(key => key !== 'holdings' && key !== 'stockAction'),
      processingTimeMs: Date.now() - saveStartTime
    }
  });
  
  res.status(200).json({
    status: "success",
    message: holdingsModified ? 
      `Portfolio updated successfully with ${stockAction} action` : 
      "Portfolio details updated successfully",
    data: {
      ...populatedPortfolio.toObject(),
      holdingsValue: populatedPortfolio.holdingsValue
    }
  });
});



exports.deletePortfolio = asyncHandler(async (req, res) => {
  const portfolioId = req.params.id;
  const userId = req.user?.id;
  const userEmail = req.user?.email;
  
  // Get portfolio before deletion for logging
  const portfolio = await Portfolio.findById(portfolioId);
  
  if (!portfolio) {
    portfolioLogger.warn('Portfolio deletion attempted for non-existent portfolio', {
      operation: 'DELETE',
      portfolioId,
      userId,
      userEmail,
      details: {
        error: 'Portfolio not found',
        timestamp: new Date().toISOString()
      }
    });
    return res.status(404).json({ error: 'Portfolio not found' });
  }
  
  // Log portfolio state before deletion
  const portfolioBefore = {
    id: portfolio._id,
    name: portfolio.name,
    userId: portfolio.userId,
    cashBalance: portfolio.cashBalance,
    holdingsCount: portfolio.holdings.length,
    totalValue: portfolio.totalValue,
    createdAt: portfolio.createdAt,
    updatedAt: portfolio.updatedAt,
    externalId: portfolio.externalId
  };
  
  const deleteStartTime = Date.now();
  
  // Delete Telegram product if it exists
  if (portfolio.externalId) {
    try {
      const deleteResult = await TelegramService.deleteProduct(portfolio.externalId);
      if (deleteResult.success) {
        portfolioLogger.info('Telegram product deleted successfully', {
          operation: 'DELETE',
          portfolioId,
          userId,
          userEmail,
          details: {
            telegramProductId: portfolio.externalId,
            portfolioName: portfolio.name
          }
        });
      } else {
        portfolioLogger.warn('Failed to delete Telegram product', {
          operation: 'DELETE',
          portfolioId,
          userId,
          userEmail,
          details: {
            telegramProductId: portfolio.externalId,
            error: deleteResult.error
          }
        });
      }
    } catch (telegramError) {
      portfolioLogger.error('Telegram deletion error during portfolio cleanup', {
        operation: 'DELETE',
        portfolioId,
        userId,
        userEmail,
        details: {
          error: telegramError.message,
          telegramProductId: portfolio.externalId
        }
      });
    }
  }
  
  // Delete portfolio
  await Portfolio.findByIdAndDelete(portfolioId);
  
  // Delete related price logs
  const priceLogDeleteResult = await PriceLog.deleteMany({ portfolio: portfolio._id });
  
  const deleteEndTime = Date.now();

  // Log successful deletion
  portfolioLogger.info('Portfolio deleted successfully', {
    operation: 'DELETE',
    portfolioId,
    userId,
    userEmail,
    details: {
      portfolioBefore,
      deletedPriceLogsCount: priceLogDeleteResult.deletedCount,
      deleteTimeMs: deleteEndTime - deleteStartTime,
      timestamp: new Date().toISOString()
    }
  });

  res.status(200).json({ 
    message: 'Portfolio and related resources deleted successfully',
    deletedPriceLogs: priceLogDeleteResult.deletedCount,
    telegramProductDeleted: !!portfolio.externalId
  });
});

// CRUD operations for YouTube links
exports.addYouTubeLink = asyncHandler(async (req, res) => {
  const portfolio = await Portfolio.findById(req.params.id);
  if (!portfolio) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  portfolio.youTubeLinks.push(req.body);
  await portfolio.save();
  res.status(201).json(portfolio);
});

exports.removeYouTubeLink = asyncHandler(async (req, res) => {
  const portfolio = await Portfolio.findById(req.params.id);
  if (!portfolio) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  portfolio.youTubeLinks = portfolio.youTubeLinks.filter(
    link => link._id.toString() !== req.params.linkId
  );
  
  await portfolio.save();
  res.status(200).json(portfolio);
});

exports.addDownloadLink = asyncHandler(async (req, res) => {
  const portfolio = await Portfolio.findById(req.params.id);
  if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });
  
  // Validate required fields
  if (!req.body.linkType || !req.body.linkUrl) {
    return res.status(400).json({ error: 'Missing linkType or linkUrl' });
  }

  portfolio.downloadLinks.push({
    linkType: req.body.linkType,
    linkUrl: req.body.linkUrl,
    linkDiscription: req.body.linkDiscription || ''
  });
  
  await portfolio.save();
  res.status(201).json(portfolio);
});

exports.removeDownloadLink = asyncHandler(async (req, res) => {
  const portfolio = await Portfolio.findById(req.params.id);
  if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });
  
  const initialLength = portfolio.downloadLinks.length;
  portfolio.downloadLinks = portfolio.downloadLinks.filter(
    link => link._id.toString() !== req.params.linkId
  );
  
  if (portfolio.downloadLinks.length === initialLength) {
    return res.status(404).json({ error: 'Download link not found' });
  }
  
  await portfolio.save();
  res.status(200).json(portfolio);
});

// Get all YouTube links across portfolios
exports.getAllYouTubeLinks = asyncHandler(async (req, res) => {
  const portfolios = await Portfolio.find().select('youTubeLinks');
  const allLinks = portfolios.reduce((acc, portfolio) => {
    return acc.concat(portfolio.youTubeLinks);
  }, []);
  res.status(200).json(allLinks);
});

// Manual portfolio value recalculation endpoints
exports.recalculatePortfolioValue = asyncHandler(async (req, res) => {
  const { useClosingPrice = false } = req.query;
  
  try {
    const result = await portfolioService.recalculatePortfolioValue(
      req.params.id, 
      useClosingPrice === 'true'
    );
    
    res.status(200).json({
      status: 'success',
      message: 'Portfolio value recalculated successfully',
      portfolio: result.portfolio.name,
      calculatedValue: result.calculatedValue,
      usedClosingPrice: result.usedClosingPrice,
      timestamp: new Date()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to recalculate portfolio value',
      error: error.message
    });
  }
});

// Mass update all portfolio values
exports.updateAllPortfolioValues = asyncHandler(async (req, res) => {
  try {
    const results = await portfolioService.updateAllPortfolioValues();
    
    const successCount = results.filter(r => r.status === 'success').length;
    const failedCount = results.filter(r => r.status === 'failed').length;
    
    res.status(200).json({
      status: 'success',
      message: `Portfolio values updated: ${successCount} successful, ${failedCount} failed`,
      results,
      timestamp: new Date()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to update portfolio values',
      error: error.message
    });
  }
});

// Get real-time portfolio value
exports.getRealTimeValue = asyncHandler(async (req, res) => {
  try {
    const portfolio = await Portfolio.findById(req.params.id);
    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    const realTimeValue = await portfolioService.calculateRealTimeValue(portfolio);
    const storedValue = portfolio.currentValue;
    
    res.status(200).json({
      status: 'success',
      portfolioId: portfolio._id,
      portfolioName: portfolio.name,
      realTimeValue,
      storedValue,
      difference: realTimeValue - storedValue,
      differencePercent: storedValue > 0 ? ((realTimeValue - storedValue) / storedValue * 100).toFixed(2) : 0,
      lastUpdated: new Date(),
      needsSync: Math.abs(realTimeValue - storedValue) > 0.01
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to calculate real-time value',
      error: error.message
    });
  }
});

// Update portfolio holdings with current market prices and calculate PnL
exports.updatePortfolioWithMarketPrices = asyncHandler(async (req, res) => {
  try {
    const portfolio = await Portfolio.findById(req.params.id);
    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    // Update with current market prices from StockSymbol collection
    await portfolio.updateWithMarketPrices();
    await portfolio.save();

    res.status(200).json({
      status: 'success',
      message: 'Portfolio updated with current market prices from StockSymbol collection',
      portfolio: {
        ...portfolio.toObject(),
        totalUnrealizedPnL: portfolio.totalUnrealizedPnL,
        totalUnrealizedPnLPercent: portfolio.totalUnrealizedPnLPercent,
        holdingsValueAtMarket: portfolio.holdingsValueAtMarket
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to update portfolio with market prices',
      error: error.message
    });
  }
});

// Get portfolio PnL summary
exports.getPortfolioPnLSummary = asyncHandler(async (req, res) => {
  try {
    const portfolio = await Portfolio.findById(req.params.id);
    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    // Calculate summary data
    const holdingsSummary = portfolio.holdings.map(holding => ({
      symbol: holding.symbol,
      sector: holding.sector,
      quantity: holding.quantity,
      buyPrice: holding.buyPrice,
      currentPrice: holding.currentPrice || holding.buyPrice,
      investmentValueAtBuy: holding.investmentValueAtBuy || (holding.buyPrice * holding.quantity),
      investmentValueAtMarket: holding.investmentValueAtMarket || ((holding.currentPrice || holding.buyPrice) * holding.quantity),
      unrealizedPnL: holding.unrealizedPnL || 0,
      unrealizedPnLPercent: holding.unrealizedPnLPercent || 0,
      realizedPnL: holding.realizedPnL || 0,
      weight: holding.weight || 0
    }));

    const portfolioSummary = {
      portfolioId: portfolio._id,
      portfolioName: portfolio.name,
      totalInvestmentAtBuy: portfolio.holdingsValue,
      totalValueAtMarket: portfolio.holdingsValueAtMarket,
      cashBalance: portfolio.cashBalance,
      currentValue: portfolio.currentValue,
      totalUnrealizedPnL: portfolio.totalUnrealizedPnL,
      totalUnrealizedPnLPercent: portfolio.totalUnrealizedPnLPercent,
      minInvestment: portfolio.minInvestment
    };

    res.status(200).json({
      status: 'success',
      summary: portfolioSummary,
      holdings: holdingsSummary,
      lastUpdated: new Date()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to get portfolio PnL summary',
      error: error.message
    });
  }
});

// Bulk update all portfolios with current market prices
exports.updateAllPortfoliosWithMarketPrices = asyncHandler(async (req, res) => {
  try {
    const results = await Portfolio.updateAllWithMarketPrices();
    
    const successCount = results.filter(r => r.status === 'updated').length;
    const noChangesCount = results.filter(r => r.status === 'no_changes').length;
    const failedCount = results.filter(r => r.status === 'error').length;
    const noHoldingsCount = results.filter(r => r.status === 'no_holdings').length;

    res.status(200).json({
      status: 'success',
      message: `Updated ${successCount} portfolios, ${noChangesCount} had no changes, ${noHoldingsCount} had no holdings, ${failedCount} failed`,
      summary: {
        updated: successCount,
        noChanges: noChangesCount,
        noHoldings: noHoldingsCount,
        failed: failedCount,
        total: results.length
      },
      results,
      timestamp: new Date()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to update portfolios with market prices',
      error: error.message
    });
  }
});

// Enhanced Telegram integration endpoints

/**
 * Generate Telegram invite link for a portfolio subscription
 */
exports.generateTelegramInvite = asyncHandler(async (req, res) => {
  const portfolioId = req.params.id;
  const userId = req.user?._id;
  const userEmail = req.user?.email;
  
  try {
    portfolioLogger.info('Generating Telegram invite link', {
      operation: 'TELEGRAM_INVITE',
      portfolioId,
      userId,
      userEmail
    });

    const portfolio = await Portfolio.findById(portfolioId);
    if (!portfolio) {
      return res.status(404).json({ 
        success: false, 
        error: 'Portfolio not found' 
      });
    }

    if (!portfolio.externalId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Portfolio not linked to Telegram service' 
      });
    }

    // Check if user has active subscription
    const Subscription = require('../models/subscription');
    const activeSubscription = await Subscription.findOne({
      user: userId,
      productType: 'Portfolio',
      productId: portfolioId,
      status: 'active',
      expiresAt: { $gt: new Date() }
    });

    if (!activeSubscription) {
      return res.status(403).json({ 
        success: false, 
        error: 'Active subscription required to access Telegram group' 
      });
    }

    // Generate invite link
    const inviteResult = await TelegramService.generateInviteLink(portfolio.externalId);
    
    if (inviteResult.success) {
      // Update subscription with invite link details
      await Subscription.findByIdAndUpdate(activeSubscription._id, {
        invite_link_url: inviteResult.invite_link,
        invite_link_expires_at: inviteResult.expires_at
      });

      portfolioLogger.info('Telegram invite link generated successfully', {
        operation: 'TELEGRAM_INVITE',
        portfolioId,
        userId,
        userEmail,
        details: {
          subscriptionId: activeSubscription._id,
          telegramProductId: portfolio.externalId,
          expiresAt: inviteResult.expires_at
        }
      });

      res.status(200).json({
        success: true,
        message: 'Telegram invite link generated successfully',
        data: {
          invite_link: inviteResult.invite_link,
          expires_at: inviteResult.expires_at,
          portfolio_name: portfolio.name,
          subscription_id: activeSubscription._id
        }
      });
    } else {
      portfolioLogger.error('Failed to generate Telegram invite link', {
        operation: 'TELEGRAM_INVITE',
        portfolioId,
        userId,
        userEmail,
        details: {
          error: inviteResult.error,
          telegramProductId: portfolio.externalId
        }
      });

      res.status(500).json({
        success: false,
        error: inviteResult.error || 'Failed to generate invite link'
      });
    }
  } catch (error) {
    portfolioLogger.error('Telegram invite generation error', {
      operation: 'TELEGRAM_INVITE',
      portfolioId,
      userId,
      userEmail,
      details: {
        error: error.message,
        stack: error.stack
      }
    });

    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Get Telegram group status for a portfolio
 */
exports.getTelegramGroupStatus = asyncHandler(async (req, res) => {
  const portfolioId = req.params.id;
  const userId = req.user?._id;
  const userEmail = req.user?.email;

  try {
    portfolioLogger.info('Fetching Telegram group status', {
      operation: 'TELEGRAM_STATUS',
      portfolioId,
      userId,
      userEmail
    });

    const portfolio = await Portfolio.findById(portfolioId);
    if (!portfolio) {
      return res.status(404).json({ 
        success: false, 
        error: 'Portfolio not found' 
      });
    }

    if (!portfolio.externalId) {
      return res.status(200).json({
        success: true,
        data: {
          telegram_enabled: false,
          message: 'Portfolio not linked to Telegram service'
        }
      });
    }

    // Get group status from Telegram service
    const groupStatus = await TelegramService.getGroupStatus(portfolio.externalId);

    if (groupStatus.success) {
      // Check user's subscription and access
      const Subscription = require('../models/subscription');
      const userSubscription = await Subscription.findOne({
        user: userId,
        productType: 'Portfolio',
        productId: portfolioId,
        status: 'active'
      });

      const responseData = {
        telegram_enabled: true,
        group_status: groupStatus.group,
        user_has_access: !!userSubscription && userSubscription.expiresAt > new Date(),
        subscription_details: userSubscription ? {
          id: userSubscription._id,
          expires_at: userSubscription.expiresAt,
          invite_link_url: userSubscription.invite_link_url,
          invite_link_expires_at: userSubscription.invite_link_expires_at
        } : null
      };

      portfolioLogger.info('Telegram group status fetched successfully', {
        operation: 'TELEGRAM_STATUS',
        portfolioId,
        userId,
        userEmail,
        details: {
          telegramProductId: portfolio.externalId,
          groupActive: groupStatus.group.active,
          userHasAccess: responseData.user_has_access
        }
      });

      res.status(200).json({
        success: true,
        data: responseData
      });
    } else {
      res.status(500).json({
        success: false,
        error: groupStatus.error || 'Failed to fetch group status'
      });
    }
  } catch (error) {
    portfolioLogger.error('Telegram group status error', {
      operation: 'TELEGRAM_STATUS',
      portfolioId,
      userId,
      userEmail,
      details: {
        error: error.message,
        stack: error.stack
      }
    });

    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * Handle Telegram integration for payment verification
 */
async function handleTelegramIntegration(user, productType, productId, subscription) {
  const telegramInvites = [];
  
  if (productType === 'Portfolio') {
    try {
      const portfolio = await Portfolio.findById(productId);
      if (portfolio && portfolio.externalId) {
        const inviteResult = await TelegramService.generateInviteLink(portfolio.externalId);
        
        if (inviteResult.success) {
          // Update subscription with invite link
          await Subscription.findByIdAndUpdate(subscription._id, {
            invite_link_url: inviteResult.invite_link,
            invite_link_expires_at: inviteResult.expires_at
          });
          
          telegramInvites.push({
            productId: productId,
            product_name: portfolio.name,
            invite_link: inviteResult.invite_link,
            expires_at: inviteResult.expires_at
          });
          
          // Send email with invite link
          await sendTelegramInviteEmail(user, portfolio, inviteResult.invite_link, inviteResult.expires_at);
          
          portfolioLogger.info('Telegram invite generated for payment verification', {
            operation: 'PAYMENT_TELEGRAM',
            userId: user._id,
            userEmail: user.email,
            details: {
              portfolioId: productId,
              portfolioName: portfolio.name,
              subscriptionId: subscription._id,
              telegramProductId: portfolio.externalId
            }
          });
        }
      }
    } catch (error) {
      portfolioLogger.error('Telegram integration error during payment verification', {
        operation: 'PAYMENT_TELEGRAM',
        userId: user._id,
        userEmail: user.email,
        details: {
          error: error.message,
          productId,
          productType
        }
      });
    }
  }
  
  return telegramInvites;
}

async function sendTelegramInviteEmail(user, product, inviteLink, expiresAt) {
  try {
    const emailQueue = require('../services/emailQueue');
    const subject = `Your ${product.name} Telegram Group Access`;
    const text = `You've been granted access to the ${product.name} Telegram group.\n\nJoin here: ${inviteLink}\n\nLink expires on ${expiresAt.toDateString()}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2E86C1;">Welcome to ${product.name}!</h2>
        <p>You've been granted access to the exclusive Telegram group for ${product.name} subscribers.</p>
        <p style="margin: 25px 0;">
          <a href="${inviteLink}" 
             style="background-color: #2E86C1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
            Join Telegram Group
          </a>
        </p>
        <p><strong>Important:</strong> This invite link will expire on ${expiresAt.toDateString()}</p>
        <p>If you have any issues joining, please contact our support team.</p>
      </div>
    `;
    
    await emailQueue.addToQueue({
      to: user.email,
      subject,
      text,
      html,
      type: 'telegram_invite',
      userId: user._id,
      metadata: {
        portfolioName: product.name,
        inviteLink,
        expiresAt
      }
    });
    
    portfolioLogger.info(`Telegram invite email queued for ${user.email}`, {
      userId: user._id,
      portfolioName: product.name,
      expiresAt
    });
  } catch (error) {
    portfolioLogger.error(`Failed to send Telegram invite email to ${user.email}:`, {
      error: error.message,
      userId: user._id,
      portfolioName: product.name
    });
  }
}

// Export the helper functions for use in subscription controller
exports.handleTelegramIntegration = handleTelegramIntegration;
exports.sendTelegramInviteEmail = sendTelegramInviteEmail;

exports.errorHandler = (err, req, res, next) => {
  portfolioLogger.error('Unhandled portfolio controller error', { 
    operation: 'ERROR',
    details: {
      error: err.message, 
      stack: err.stack,
      status: err.status || 500,
      url: req.url,
      method: req.method
    }
  });
  const status = err.status || 500;
  res.status(status).json({ 
    error: err.message || 'Server Error',
    status
  });
};