const { default: mongoose } = require('mongoose');
const Portfolio = require('../models/modelPortFolio');
const PriceLog = require('../models/PriceLog');

const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

exports.getAllPortfolios = asyncHandler(async (req, res) => { 
  const portfolios = await Portfolio.find().sort('name');
  res.status(200).json(portfolios);
});

exports.getPortfolioById = asyncHandler(async (req, res) => {
  const portfolio = await Portfolio.findById(req.params.id);
  if (!portfolio) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }
  res.status(200).json(portfolio);
});

exports.createPortfolio = asyncHandler(async (req, res) => {
  const {
    name,
    description = [],
    subscriptionFee,
    minInvestment,
    durationMonths,
    expiryDate,
    holdings = [],
    PortfolioCategory = 'Basic',
    downloadLinks = [],
    youTubeLinks = [],
    timeHorizon = '',
    rebalancing = '',
    index = '',
    details = '',
    lastRebalanceDate = '',
    nextRebalanceDate = '',
    monthlyContribution = 0,
    compareWith = ''
  } = req.body;

  // Validate required fields
  if (!name || subscriptionFee == null || minInvestment == null || !durationMonths) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate subscription fee structure
  if (!Array.isArray(subscriptionFee) || subscriptionFee.length === 0 ||
      subscriptionFee.some(fee => !fee.type || fee.price == null)) {
    return res.status(400).json({ error: 'Invalid subscription fee structure' });
  }

  // Validate description items
  if (description.some(item => !item.key || !item.value)) {
    return res.status(400).json({ error: 'Description items must have key and value' });
  }

  // Validate holdings
  if (holdings.some(holding => 
    !holding.minimumInvestmentValueStock || 
    holding.minimumInvestmentValueStock < 1
  )) {
    return res.status(400).json({ 
      error: 'All holdings must have minimumInvestmentValueStock >= 1' 
    });
  }

  // Validate holdings cost doesn't exceed minInvestment
  const totalCost = holdings.reduce((sum, holding) => 
    sum + (holding.buyPrice * holding.quantity), 0);
  
  if (totalCost > minInvestment) {
    return res.status(400).json({ 
      error: `Total holdings cost (${totalCost}) exceeds minimum investment (${minInvestment})` 
    });
  }

  // Validate benchmark symbol if provided
  if (compareWith) {
    const StockSymbol = require('../models/stockSymbol');
    let symbolExists = false;
    
    // Check if it's a MongoDB ObjectId
    if (/^[0-9a-fA-F]{24}$/.test(compareWith)) {
      symbolExists = await StockSymbol.exists({ _id: compareWith });
    } else {
      symbolExists = await StockSymbol.exists({ symbol: compareWith });
    }
    
    if (!symbolExists) {
      return res.status(400).json({ error: `Benchmark symbol "${compareWith}" does not exist` });
    }
  }

  const cashBalance = parseFloat((minInvestment - totalCost).toFixed(2));
  
  const portfolio = new Portfolio({
    name,
    description,
    subscriptionFee,
    minInvestment,
    durationMonths,
    expiryDate,
    holdings,
    PortfolioCategory,
    downloadLinks,
    youTubeLinks,
    timeHorizon,
    rebalancing,
    index,
    details,
    lastRebalanceDate,
    nextRebalanceDate,
    monthlyContribution,
    compareWith,
    cashBalance,
    currentValue: parseFloat(minInvestment.toFixed(2))
  });

  const savedPortfolio = await portfolio.save(); 
  const populatedPortfolio = await Portfolio.findById(savedPortfolio._id);
  
  res.status(201).json({
    ...savedPortfolio.toObject(),
    holdingsValue: populatedPortfolio.holdingsValue
  });
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

    } else {
      // DEFAULT/UPDATE: Merge holdings - update existing by symbol, add new ones
      for (const newHolding of req.body.holdings) {
        const existingIndex = updatedHoldings.findIndex(h => h.symbol === newHolding.symbol);
        
        if (existingIndex >= 0) {
          // Update existing holding
          updatedHoldings[existingIndex] = { ...updatedHoldings[existingIndex], ...newHolding };
        } else {
          // Add new holding - validate required fields
          if (!newHolding.symbol || !newHolding.sector || !newHolding.buyPrice || 
              !newHolding.quantity || !newHolding.minimumInvestmentValueStock) {
            return res.status(400).json({ 
              error: `New holding ${newHolding.symbol} missing required fields (symbol, sector, buyPrice, quantity, minimumInvestmentValueStock)` 
            });
          }
          updatedHoldings.push(newHolding);
        }

        // Validate minimumInvestmentValueStock
        if (newHolding.minimumInvestmentValueStock && newHolding.minimumInvestmentValueStock < 1) {
          return res.status(400).json({ 
            error: `Holding ${newHolding.symbol}: minimumInvestmentValueStock must be >= 1` 
          });
        }
      }
    }

    // Update portfolio holdings
    portfolio.holdings = updatedHoldings;
    
    // Recalculate cash balance
    const totalHoldingsCost = updatedHoldings.reduce((sum, holding) => 
      sum + (holding.buyPrice * holding.quantity), 0);
    portfolio.cashBalance = parseFloat((portfolio.minInvestment - totalHoldingsCost).toFixed(2));
    
    // Remove holdings and stockAction from further processing
    delete req.body.holdings;
    delete req.body.stockAction;
  }

  // Update other allowed fields
  const allowedUpdates = [
    'name', 'description', 'subscriptionFee', 'expiryDate', 
    'PortfolioCategory', 'downloadLinks', 'youTubeLinks', 'timeHorizon', 
    'rebalancing', 'index', 'details', 'compareWith', 
    'lastRebalanceDate', 'nextRebalanceDate', 'monthlyContribution'
  ];
  
  allowedUpdates.forEach(field => {
    if (req.body[field] !== undefined) {
      portfolio[field] = req.body[field];
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

exports.errorHandler = (err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || 500;
  res.status(status).json({ 
    error: err.message || 'Server Error',
    status
  });
};