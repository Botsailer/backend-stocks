const { default: mongoose } = require('mongoose');
const PriceLog = require('../models/PriceLog');
const Portfolio = require('../models/modelPortFolio');

// Helper function to handle async routes
const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Get all price logs
 * @route GET /api/chart-data
 */
exports.getAllPriceLogs = asyncHandler(async (req, res) => {
  const { 
    portfolioId, 
    startDate, 
    endDate, 
    limit = 100, 
    page = 1 
  } = req.query;
  
  const query = {};
  
  // Filter by portfolio if provided
  if (portfolioId) {
    query.portfolio = portfolioId;
  }
  
  // Filter by date range if provided
  if (startDate || endDate) {
    query.dateOnly = {};
    if (startDate) query.dateOnly.$gte = new Date(startDate);
    if (endDate) query.dateOnly.$lte = new Date(endDate);
  }
  
  // Calculate pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);
  
  // Execute query
  const priceLogs = await PriceLog.find(query)
    .sort({ dateOnly: -1 })
    .limit(parseInt(limit))
    .skip(skip)
    .populate('portfolio', 'name');
  
  // Get total count for pagination
  const total = await PriceLog.countDocuments(query);
  
  res.status(200).json({
    success: true,
    count: priceLogs.length,
    total,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit))
    },
    data: priceLogs
  });
});

/**
 * Get a specific price log by ID
 * @route GET /api/chart-data/:id
 */
exports.getPriceLogById = asyncHandler(async (req, res) => {
  const priceLog = await PriceLog.findById(req.params.id)
    .populate('portfolio', 'name');
  
  if (!priceLog) {
    return res.status(404).json({ 
      success: false, 
      error: 'Price log not found' 
    });
  }
  
  res.status(200).json({
    success: true,
    data: priceLog
  });
});

/**
 * Create a new price log
 * @route POST /api/chart-data
 */
exports.createPriceLog = asyncHandler(async (req, res) => {
  const {
    portfolio,
    date,
    portfolioValue,
    cashRemaining,
    compareIndexValue,
    compareIndexPriceSource,
    usedClosingPrices,
    dataVerified,
    dataQualityIssues
  } = req.body;
  
  // Validate that portfolio exists
  const portfolioExists = await Portfolio.exists({ _id: portfolio });
  if (!portfolioExists) {
    return res.status(400).json({
      success: false,
      error: 'Portfolio not found'
    });
  }
  
  // Set dateOnly based on date
  const dateToUse = date ? new Date(date) : new Date();
  const dateOnly = PriceLog.getStartOfDay(dateToUse);
  
  // Create the price log
  const logData = {
    portfolio,
    date: dateToUse,
    dateOnly,
    portfolioValue,
    cashRemaining,
    compareIndexValue,
    compareIndexPriceSource,
    usedClosingPrices,
    dataVerified,
    dataQualityIssues
  };
  
  const result = await PriceLog.createOrUpdateDailyLog(portfolio, logData);
  
  if (!result.success) {
    return res.status(400).json({
      success: false,
      error: result.error || 'Failed to create price log'
    });
  }
  
  res.status(201).json({
    success: true,
    data: result.priceLog,
    action: result.action
  });
});

/**
 * Update a price log
 * @route PUT /api/chart-data/:id
 */
exports.updatePriceLog = asyncHandler(async (req, res) => {
  const {
    portfolioValue,
    cashRemaining,
    compareIndexValue,
    compareIndexPriceSource,
    usedClosingPrices,
    dataVerified,
    dataQualityIssues,
    date
  } = req.body;
  
  // Find the price log to update
  let priceLog = await PriceLog.findById(req.params.id);
  
  if (!priceLog) {
    return res.status(404).json({
      success: false,
      error: 'Price log not found'
    });
  }
  
  // Update dateOnly if date is provided
  let dateOnly = priceLog.dateOnly;
  if (date) {
    const newDate = new Date(date);
    dateOnly = PriceLog.getStartOfDay(newDate);
  }
  
  // Update the price log
  const updatedPriceLog = await PriceLog.findByIdAndUpdate(
    req.params.id,
    {
      $set: {
        portfolioValue: portfolioValue !== undefined ? portfolioValue : priceLog.portfolioValue,
        cashRemaining: cashRemaining !== undefined ? cashRemaining : priceLog.cashRemaining,
        compareIndexValue: compareIndexValue !== undefined ? compareIndexValue : priceLog.compareIndexValue,
        compareIndexPriceSource: compareIndexPriceSource !== undefined ? compareIndexPriceSource : priceLog.compareIndexPriceSource,
        usedClosingPrices: usedClosingPrices !== undefined ? usedClosingPrices : priceLog.usedClosingPrices,
        dataVerified: dataVerified !== undefined ? dataVerified : priceLog.dataVerified,
        dataQualityIssues: dataQualityIssues !== undefined ? dataQualityIssues : priceLog.dataQualityIssues,
        date: date ? new Date(date) : priceLog.date,
        dateOnly: dateOnly
      },
      $inc: { updateCount: 1 }
    },
    { new: true, runValidators: true }
  );
  
  res.status(200).json({
    success: true,
    data: updatedPriceLog
  });
});

/**
 * Delete a price log
 * @route DELETE /api/chart-data/:id
 */
exports.deletePriceLog = asyncHandler(async (req, res) => {
  const priceLog = await PriceLog.findById(req.params.id);
  
  if (!priceLog) {
    return res.status(404).json({
      success: false,
      error: 'Price log not found'
    });
  }
  
  await PriceLog.deleteOne({ _id: req.params.id });
  
  res.status(200).json({
    success: true,
    data: {}
  });
});

/**
 * Get portfolio performance data over time
 * @route GET /api/chart-data/portfolio/:portfolioId/performance
 */
exports.getPortfolioPerformance = asyncHandler(async (req, res) => {
  const { portfolioId } = req.params;
  const { startDate, endDate } = req.query;
  
  // Validate that portfolio exists
  const portfolioExists = await Portfolio.exists({ _id: portfolioId });
  if (!portfolioExists) {
    return res.status(404).json({
      success: false,
      error: 'Portfolio not found'
    });
  }
  
  // Build date filter
  const dateFilter = { portfolio: new mongoose.Types.ObjectId(portfolioId) };
  if (startDate || endDate) {
    dateFilter.dateOnly = {};
    if (startDate) dateFilter.dateOnly.$gte = new Date(startDate);
    if (endDate) dateFilter.dateOnly.$lte = new Date(endDate);
  }
  
  // Get performance data
  const performanceData = await PriceLog.find(dateFilter)
    .sort({ dateOnly: 1 })
    .select('dateOnly portfolioValue compareIndexValue');
  
  res.status(200).json({
    success: true,
    count: performanceData.length,
    data: performanceData
  });
});

/**
 * Clean up duplicate price logs
 * @route POST /api/chart-data/cleanup-duplicates
 */
exports.cleanupDuplicates = asyncHandler(async (req, res) => {
  const results = await PriceLog.cleanupDuplicates();
  
  res.status(200).json({
    success: true,
    results
  });
});
