const { default: mongoose } = require('mongoose');
const Portfolio = require('../models/modelPortFolio');
const PriceLog = require('../models/PriceLog');
const portfolioService = require('../services/portfolioservice');
const { PortfolioCalculationValidator, calcLogger } = require('../utils/portfolioCalculationValidator');

const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Production-level portfolio creation with comprehensive validation
 */
exports.createPortfolio = asyncHandler(async (req, res) => {
  const requestData = req.body;
  
  try {
    // Step 1: Validate required fields
    const requiredFields = ['name', 'subscriptionFee', 'minInvestment', 'durationMonths'];
    const missingFields = requiredFields.filter(field => !requestData[field]);
    
    if (missingFields.length > 0) {
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

    // Step 3: Validate and calculate portfolio financial integrity
    const portfolioSummary = PortfolioCalculationValidator.calculatePortfolioSummary({
      holdings: requestData.holdings || [],
      minInvestment: requestData.minInvestment,
      currentMarketPrices: {} // Use buy prices for new portfolios
    });

    if (!portfolioSummary.isFinanciallyValid) {
      return res.status(400).json({ 
        error: 'Portfolio financial validation failed',
        details: {
          weightValidation: portfolioSummary.weightValidation,
          minInvestmentValidation: portfolioSummary.minInvestmentValidation,
          summary: portfolioSummary
        }
      });
    }

    // Step 4: Detect potential tampering
    const tamperingCheck = PortfolioCalculationValidator.detectCalculationTampering(
      requestData,
      { id: 'new' }
    );

    if (tamperingCheck.isTampered) {
      calcLogger.warn('Portfolio creation tampering detected', { tamperingCheck, requestData });
      return res.status(400).json({ 
        error: 'Calculation validation failed',
        details: 'Frontend calculations do not match backend validation',
        validation: tamperingCheck
      });
    }

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
      minInvestment: portfolioSummary.minInvestment,
      durationMonths: requestData.durationMonths,
      expiryDate: requestData.expiryDate,
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
      currentValue: portfolioSummary.totalPortfolioValueAtBuy
    };

    const portfolio = new Portfolio(portfolioData);
    const savedPortfolio = await portfolio.save();

    calcLogger.info('Portfolio created successfully', {
      portfolioId: savedPortfolio._id,
      name: savedPortfolio.name,
      totalInvestment: portfolioSummary.totalActualInvestment,
      holdingsCount: savedPortfolio.holdings.length
    });

    res.status(201).json(savedPortfolio);
    
  } catch (error) {
    calcLogger.error('Portfolio creation failed', { 
      error: error.message, 
      requestData: requestData.name 
    });
    
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Portfolio name already exists' });
    }
    
    res.status(500).json({ 
      error: 'Failed to create portfolio', 
      details: error.message 
    });
  }
});

/**
 * Production-level portfolio update with comprehensive validation
 */
exports.updatePortfolio = asyncHandler(async (req, res) => {
  const portfolioId = req.params.id;
  const updateData = req.body;
  
  try {
    // Step 1: Find existing portfolio
    const existingPortfolio = await Portfolio.findById(portfolioId);
    if (!existingPortfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    // Step 2: Determine update strategy based on stockAction
    const stockAction = updateData.stockAction || 'update';
    const validActions = ['update', 'add', 'delete', 'replace'];
    
    if (!validActions.includes(stockAction)) {
      return res.status(400).json({ 
        error: 'Invalid stockAction',
        validActions
      });
    }

    let updatedHoldings = [...existingPortfolio.holdings];

    // Step 3: Handle holdings modifications
    if (updateData.holdings && updateData.holdings.length > 0) {
      switch (stockAction) {
        case 'add':
          // Add new holdings to existing ones
          const newSymbols = updateData.holdings.map(h => h.symbol.toUpperCase());
          const existingSymbols = updatedHoldings.map(h => h.symbol.toUpperCase());
          const duplicates = newSymbols.filter(symbol => existingSymbols.includes(symbol));
          
          if (duplicates.length > 0) {
            return res.status(400).json({ 
              error: 'Cannot add existing symbols',
              duplicates
            });
          }
          
          updatedHoldings = [...updatedHoldings, ...updateData.holdings];
          break;
          
        case 'delete':
          // Remove holdings by symbol
          const symbolsToDelete = updateData.holdings.map(h => h.symbol.toUpperCase());
          updatedHoldings = updatedHoldings.filter(
            h => !symbolsToDelete.includes(h.symbol.toUpperCase())
          );
          break;
          
        case 'replace':
          // Replace entire holdings array
          updatedHoldings = updateData.holdings;
          break;
          
        case 'update':
        default:
          // Update existing holdings by symbol, add new ones
          const updateMap = new Map(
            updateData.holdings.map(h => [h.symbol.toUpperCase(), h])
          );
          
          // Update existing holdings
          updatedHoldings = updatedHoldings.map(existing => {
            const update = updateMap.get(existing.symbol.toUpperCase());
            if (update) {
              updateMap.delete(existing.symbol.toUpperCase());
              return { ...existing.toObject(), ...update };
            }
            return existing;
          });
          
          // Add new holdings
          updateMap.forEach(newHolding => {
            updatedHoldings.push(newHolding);
          });
          break;
      }
    }

    // Step 4: Prepare updated portfolio data
    const portfolioUpdateData = {
      ...updateData,
      holdings: updatedHoldings
    };
    
    // Remove stockAction from final data
    delete portfolioUpdateData.stockAction;

    // Step 5: Validate updated portfolio if holdings were modified
    if (updateData.holdings || updateData.minInvestment) {
      const portfolioSummary = PortfolioCalculationValidator.calculatePortfolioSummary({
        holdings: updatedHoldings,
        minInvestment: updateData.minInvestment || existingPortfolio.minInvestment,
        currentMarketPrices: {}
      });

      if (!portfolioSummary.isFinanciallyValid) {
        return res.status(400).json({ 
          error: 'Updated portfolio financial validation failed',
          details: {
            weightValidation: portfolioSummary.weightValidation,
            minInvestmentValidation: portfolioSummary.minInvestmentValidation,
            summary: portfolioSummary
          }
        });
      }

      // Update with backend-calculated values
      portfolioUpdateData.cashBalance = portfolioSummary.cashBalance;
      portfolioUpdateData.currentValue = portfolioSummary.totalPortfolioValueAtBuy;

      // Detect tampering if financial data was provided
      if (updateData.cashBalance !== undefined || updateData.currentValue !== undefined) {
        const tamperingCheck = PortfolioCalculationValidator.detectCalculationTampering(
          {
            ...updateData,
            holdings: updatedHoldings,
            minInvestment: updateData.minInvestment || existingPortfolio.minInvestment
          },
          existingPortfolio
        );

        if (tamperingCheck.isTampered) {
          calcLogger.warn('Portfolio update tampering detected', { 
            portfolioId, 
            tamperingCheck 
          });
          return res.status(400).json({ 
            error: 'Calculation validation failed',
            details: 'Frontend calculations do not match backend validation',
            validation: tamperingCheck
          });
        }
      }
    }

    // Step 6: Validate benchmark symbol if changed
    if (portfolioUpdateData.compareWith && 
        portfolioUpdateData.compareWith !== existingPortfolio.compareWith) {
      const StockSymbol = require('../models/stockSymbol');
      let symbolExists = false;
      
      if (/^[0-9a-fA-F]{24}$/.test(portfolioUpdateData.compareWith)) {
        symbolExists = await StockSymbol.exists({ _id: portfolioUpdateData.compareWith });
      } else {
        symbolExists = await StockSymbol.exists({ symbol: portfolioUpdateData.compareWith });
      }
      
      if (!symbolExists) {
        return res.status(400).json({ 
          error: `Benchmark symbol "${portfolioUpdateData.compareWith}" does not exist` 
        });
      }
    }

    // Step 7: Update portfolio
    const updatedPortfolio = await Portfolio.findByIdAndUpdate(
      portfolioId,
      portfolioUpdateData,
      { 
        new: true, 
        runValidators: true,
        context: 'query'
      }
    );

    calcLogger.info('Portfolio updated successfully', {
      portfolioId,
      stockAction,
      holdingsCount: updatedPortfolio.holdings.length,
      updatedFields: Object.keys(updateData)
    });

    res.json(updatedPortfolio);
    
  } catch (error) {
    calcLogger.error('Portfolio update failed', { 
      portfolioId, 
      error: error.message 
    });
    
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Portfolio name already exists' });
    }
    
    res.status(500).json({ 
      error: 'Failed to update portfolio', 
      details: error.message 
    });
  }
});

/**
 * Get all portfolios
 */
exports.getAllPortfolios = asyncHandler(async (req, res) => { 
  const portfolios = await Portfolio.find().sort('name');
  res.status(200).json(portfolios);
});

/**
 * Get portfolio by ID
 */
exports.getPortfolioById = asyncHandler(async (req, res) => {
  const portfolio = await Portfolio.findById(req.params.id);
  if (!portfolio) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }
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
    console.error('Portfolio price history error:', error);
    res.status(500).json({ 
      status: 'error',
      error: 'Failed to retrieve price history',
      message: error.message || 'Internal server error while retrieving portfolio price history'
    });
  }
});

// filepath: controllers/portfolioController.js
exports.updatePortfolio = asyncHandler(async (req, res) => {
  const portfolio = await Portfolio.findById(req.params.id);
  
  if (!portfolio) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

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

  // Handle holdings based on stockAction
  if (req.body.holdings) {
    if (!Array.isArray(req.body.holdings)) {
      return res.status(400).json({ error: 'Holdings must be an array' });
    }

    // Get stockAction (case insensitive)
    const stockAction = (req.body.stockAction || 'update').toLowerCase();
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

        updatedHoldings.push(newHolding);
      }

    } else if (stockAction.includes('delete') || stockAction.includes('remove')) {
      // DELETE: Remove holdings by symbol
      const symbolsToDelete = req.body.holdings.map(h => h.symbol.toUpperCase());
      const initialCount = updatedHoldings.length;
      
      updatedHoldings = updatedHoldings.filter(holding => 
        !symbolsToDelete.includes(holding.symbol.toUpperCase())
      );

      const deletedCount = initialCount - updatedHoldings.length;
      if (deletedCount === 0) {
        return res.status(400).json({ 
          error: `No holdings found with symbols: ${symbolsToDelete.join(', ')}` 
        });
      }

    } else if (stockAction.includes('replace')) {
      // REPLACE: Replace entire holdings array
      for (const holding of req.body.holdings) {
        // Validate required fields
        if (!holding.symbol || !holding.sector || !holding.buyPrice || 
            !holding.quantity || !holding.minimumInvestmentValueStock) {
          return res.status(400).json({ 
            error: `Holding missing required fields (symbol, sector, buyPrice, quantity, minimumInvestmentValueStock)` 
          });
        }

        // Validate minimumInvestmentValueStock
        if (holding.minimumInvestmentValueStock < 1) {
          return res.status(400).json({ 
            error: `Holding ${holding.symbol}: minimumInvestmentValueStock must be >= 1` 
          });
        }
      }
      updatedHoldings = req.body.holdings;

    } else if (stockAction.includes('sell')) {
      // SELL: Process stock sales using portfolio service
      const portfolioService = require('../services/portfolioservice');
      
      for (const saleRequest of req.body.holdings) {
        // Validate required fields for sell action
        if (!saleRequest.symbol) {
          return res.status(400).json({ 
            error: `Sale request missing required field: symbol` 
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

          console.log(`✅ Processed ${saleType} sale for ${saleRequest.symbol}:`, saleResult);
        } catch (saleError) {
          console.error(`❌ Failed to process sale for ${saleRequest.symbol}:`, saleError);
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
          realizedPnL: parseFloat(newHolding.realizedPnL) || 0
        };

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
    // For other actions, recalculate cash balance based on holdings only (ignore frontend data)
    if (!stockAction.includes('sell')) {
      const totalHoldingsCost = updatedHoldings.reduce((sum, holding) => {
        const buyPrice = parseFloat(holding.buyPrice) || 0;
        const quantity = parseFloat(holding.quantity) || 0;
        return sum + (buyPrice * quantity);
      }, 0);
      
      // Calculate cash balance from minInvestment minus actual holdings cost
      const minInvestment = parseFloat(portfolio.minInvestment) || 0;
      const calculatedCashBalance = minInvestment - totalHoldingsCost;
      
      // Ensure cash balance is valid and not negative
      portfolio.cashBalance = Math.max(0, parseFloat(calculatedCashBalance.toFixed(2)));
    }
    
    // Remove holdings and stockAction from further processing
    delete req.body.holdings;
    delete req.body.stockAction;
  }

  // Update other allowed fields (ignore calculated fields from frontend)
  const allowedUpdates = [
    'name', 'description', 'subscriptionFee', 'expiryDate', 
    'PortfolioCategory', 'downloadLinks', 'youTubeLinks', 'timeHorizon', 
    'rebalancing', 'index', 'details', 'compareWith', 
    'lastRebalanceDate', 'nextRebalanceDate', 'monthlyContribution'
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
      console.warn(`⚠️  Ignoring calculated field '${field}' from frontend - will be calculated by backend`);
    }
  });

  // Save portfolio (this will trigger pre-save hooks to recalculate weights and values)
  await portfolio.save();
  
  // Return updated portfolio with calculated values
  const populatedPortfolio = await Portfolio.findById(portfolio._id);
  
  res.status(200).json({
    ...populatedPortfolio.toObject(),
    holdingsValue: populatedPortfolio.holdingsValue
  });
});



exports.deletePortfolio = asyncHandler(async (req, res) => {
  const portfolio = await Portfolio.findByIdAndDelete(req.params.id);

  if (!portfolio) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  await PriceLog.deleteMany({ portfolio: portfolio._id });

  res.status(200).json({ message: 'Portfolio and related price logs deleted successfully' });
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

exports.errorHandler = (err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || 500;
  res.status(status).json({ 
    error: err.message || 'Server Error',
    status
  });
};