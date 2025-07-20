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
    monthlyGains = '',
    CAGRSinceInception = '',
    lastRebalanceDate= '',
    nextRebalanceDate= '',
    monthlyContribution = 0,
    oneYearGains = '',
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
    monthlyGains,
    lastRebalanceDate,
    nextRebalanceDate,
    monthlyContribution,
    CAGRSinceInception,
    oneYearGains,
    compareWith,
    cashBalance,
 currentValue: parseFloat(minInvestment.toFixed(2))
  });

const savedPortfolio = await portfolio.save(); 
   const populatedPortfolio = await Portfolio.findById(savedPortfolio._id)
res.status(201).json({
    ...savedPortfolio.toObject(),
    holdingsValue: populatedPortfolio.holdingsValue
  });
});



exports.getPortfolioPriceHistory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { period = '1m' } = req.query; // Default to 1 month
  
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid portfolio ID' });
  }

  // Calculate date range based on period
  const dateRanges = {
    '1w': 7,
    '1m': 30,
    '3m': 90,
    '6m': 180,
    '1y': 365,
    'all': null
  };

  const days = dateRanges[period] || 30;
  const startDate = days 
    ? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    : new Date(0); // Beginning of time for 'all'

  try {
    const priceHistory = await PriceLog.find({
      portfolio: id,
      date: { $gte: startDate }
    })
    .sort({ date: 1 }) // Oldest first for charting
    .select('date portfolioValue cashRemaining -_id');

    if (priceHistory.length === 0) {
      return res.status(404).json({ error: 'No price history found' });
    }

    // Calculate daily returns percentage
  const chartData = priceHistory.map((log, index) => {
    const entry = {
      date: log.date,
      value: parseFloat(log.portfolioValue.toFixed(2)),
      cash: parseFloat(log.cashRemaining.toFixed(2))
    };
      // Calculate daily change percentage
     if (index > 0) {
      const prevValue = priceHistory[index - 1].portfolioValue;
      const change = log.portfolioValue - prevValue;
      entry.change = parseFloat(change.toFixed(2));
      entry.changePercent = prevValue > 0 
        ? parseFloat(((change / prevValue) * 100).toFixed(2))
        : 0;
    }

    return entry;
  });

    res.status(200).json({
      portfolioId: id,
      period,
      dataPoints: chartData.length,
      data: chartData
    });
  } catch (error) {
    console.error('Error fetching price history:', error);
    res.status(500).json({ error: 'Failed to retrieve price history' });
  }
});


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

  // Validate holdings
  if (req.body.holdings && req.body.holdings.some(holding => 
    !holding.minimumInvestmentValueStock || 
    holding.minimumInvestmentValueStock < 1
  )) {
    return res.status(400).json({ 
      error: 'All holdings must have minimumInvestmentValueStock >= 1' 
    });
  }

  // Update only allowed fields
  const allowedUpdates = [
    'name', 'description', 'subscriptionFee', 'expiryDate', 'holdings', 
    'PortfolioCategory', 'downloadLinks', 'youTubeLinks', 'timeHorizon', 
    'rebalancing', 'index', 'details', 'monthlyGains', 'CAGRSinceInception', 
    'oneYearGains', 'compareWith', 'cashBalance', 'currentValue','lastRebalanceDate', 'nextRebalanceDate', 'monthlyContribution'
  ];
  
  allowedUpdates.forEach(field => {
    if (req.body[field] !== undefined) {
      portfolio[field] = req.body[field];
    }
  });

  // Validate holdings cost doesn't exceed available funds
  const totalCost = portfolio.holdings.reduce((sum, holding) => 
    sum + (holding.buyPrice * holding.quantity), 0);
  
  if (totalCost > (portfolio.minInvestment + portfolio.currentValue - portfolio.holdingsValue)) {
    return res.status(400).json({ 
      error: 'Total holdings cost exceeds available funds' 
    });
  }

  await portfolio.save();
  res.status(200).json(portfolio);
});

exports.deletePortfolio = asyncHandler(async (req, res) => {
  const portfolio = await Portfolio.findByIdAndDelete(req.params.id);

  if (!portfolio) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  await PriceLog.deleteMany({ portfolio: portfolio._id });

  res.status(200).json({ message: 'Portfolio and related price logs deleted successfully' });
});


//public portfolio routes and return data to subscribed users 


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

// Updated to support linkType and linkDiscription
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


//get all youtube links for a portfolios merged together 
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
