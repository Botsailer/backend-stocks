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
const { PortfolioCalculationValidator, calcLogger } = require('../utils/portfolioCalculationValidator');
const transactionLogger = require('../utils/transactionLogger');

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
    // Log error with transaction context
    await transactionLogger.logError(error, `Portfolio Update - ${req.body.stockAction || 'Unknown Action'}`);
    
    calcLogger.error('Unhandled error in portfolio update', { 
      error: error.message, 
      portfolioId: req.params.id,
      stackTrace: error.stack 
    });
    
    res.status(500).json({
      error: 'Portfolio update failed',
      message: error.message
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
    calcLogger.error('Portfolio price history error', { error: error.message, portfolioId: id });
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
        // Validate required fields for buy action
        if (!buyRequest.symbol || !buyRequest.sector || !buyRequest.buyPrice) {
          return res.status(400).json({ 
            error: `Buy request missing required fields (symbol, sector, buyPrice)` 
          });
        }

        // For addon-buy, quantity can be 0 (meaning add amount only)
        const quantity = parseFloat(buyRequest.quantity) || 0;
        const buyPrice = parseFloat(buyRequest.buyPrice);
        
        if (isNaN(buyPrice) || buyPrice <= 0) {
          return res.status(400).json({ 
            error: `Buy price must be a valid positive number for ${buyRequest.symbol}` 
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
              investmentValueAtMarket: (stockData?.currentPrice || buyPrice) * existingHolding.quantity,
              weight: 0, // Will be calculated after save
              unrealizedPnL: ((stockData?.currentPrice || buyPrice) - existingHolding.buyPrice) * existingHolding.quantity,
              unrealizedPnLPercent: (((stockData?.currentPrice || buyPrice) - existingHolding.buyPrice) / existingHolding.buyPrice) * 100,
              status: existingHolding.status
            },
            portfolioBefore,
            portfolioAfter: {
              totalValue: portfolioBefore.totalValue + transactionData.totalInvestment,
              cashBalance: portfolioBefore.cashBalance - transactionData.netAmount,
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
              cashBalance: portfolioBefore.cashBalance - transactionData.netAmount,
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

          // Sale processed successfully - logged via calcLogger
        } catch (saleError) {
          calcLogger.error('Stock sale processing failed', { 
            symbol: saleRequest.symbol, 
            error: saleError.message 
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
    // For other actions, recalculate cash balance based on holdings only (ignore frontend data)
    if (!stockAction.includes('sell')) {
      const totalHoldingsCostAtBuy = updatedHoldings.reduce((sum, holding) => {
        const buyPrice = parseFloat(holding.buyPrice) || 0;
        const quantity = parseFloat(holding.quantity) || 0;
        return sum + (buyPrice * quantity);
      }, 0);
      
      // Calculate cash balance from minInvestment minus actual holdings cost at buy price
      const minInvestment = parseFloat(portfolio.minInvestment) || 0;
      const calculatedCashBalance = minInvestment - totalHoldingsCostAtBuy;
      
      // Ensure cash balance is valid and not negative
      portfolio.cashBalance = Math.max(0, parseFloat(calculatedCashBalance.toFixed(2)));
      
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
      calcLogger.debug('Ignoring calculated field from frontend', { field });
    }
  });

  // Save portfolio (this will trigger pre-save hooks to recalculate weights and values)
  await portfolio.save();
  
  // Log portfolio snapshot after transaction
  if (stockAction && (stockAction.includes('buy') || stockAction.includes('sell'))) {
    await transactionLogger.logPortfolioSnapshot(portfolio, `After ${stockAction} transaction`);
  }
  
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

exports.errorHandler = (err, req, res, next) => {
  calcLogger.error('Unhandled portfolio controller error', { error: err.message, stack: err.stack });
  const status = err.status || 500;
  res.status(status).json({ 
    error: err.message || 'Server Error',
    status
  });
};