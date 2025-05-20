// controllers/portfolioController.js
const Portfolio = require('../models/modelPortFolio');
const PriceLog = require('../models/PriceLog');

// Utility to handle async/await errors
const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// @desc    Get all portfolios
// @route   GET /api/portfolios
exports.getAllPortfolios = asyncHandler(async (req, res) => {
  const portfolios = await Portfolio.find().sort('name');
  res.status(200).json(portfolios);
});

// @desc    Get portfolio by ID
// @route   GET /api/portfolios/:id
exports.getPortfolioById = asyncHandler(async (req, res) => {
  const portfolio = await Portfolio.findById(req.params.id);
  if (!portfolio) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }
  res.status(200).json(portfolio);
});

// @desc    Create a new portfolio
// @route   POST /api/portfolios
exports.createPortfolio = asyncHandler(async (req, res) => {
  const {
    name,
    description = '',
    subscriptionFee,
    minInvestment,
    durationMonths,
    expiryDate,
    holdings = [],
    PortfolioCategory = 'Basic',
    downloadLinks = [],
    cashRemaining = 0,
    timeHorizon = '',
    rebalancing = '',
    index = '',
    details = '',
    monthlyGains = '',
    CAGRSinceInception = '',
    oneYearGains = ''
  } = req.body;

  if (!name || subscriptionFee == null || minInvestment == null || !durationMonths) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const portfolio = new Portfolio({
    name,
    description,
    subscriptionFee,
    minInvestment,
    durationMonths,
    expiryDate, // Let schema calculate if not provided
    holdings,
    PortfolioCategory,
    downloadLinks,
    cashRemaining,
    timeHorizon,
    rebalancing,
    index,
    details,
    monthlyGains,
    CAGRSinceInception,
    oneYearGains
  });

  await portfolio.save();
  res.status(201).json(portfolio);
});

// @desc    Update portfolio
// @route   PUT /api/portfolios/:id
exports.updatePortfolio = asyncHandler(async (req, res) => {
  const portfolio = await Portfolio.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true
  });

  if (!portfolio) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  res.status(200).json(portfolio);
});

// @desc    Delete portfolio and associated price logs
// @route   DELETE /api/portfolios/:id
exports.deletePortfolio = asyncHandler(async (req, res) => {
  const portfolio = await Portfolio.findByIdAndDelete(req.params.id);

  if (!portfolio) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  await PriceLog.deleteMany({ portfolio: portfolio._id });

  res.status(200).json({ message: 'Portfolio and related price logs deleted successfully' });
});

// Global error handler (optional, in your main app.js/server.js you should use next(error))
exports.errorHandler = (err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Server Error' });
};
