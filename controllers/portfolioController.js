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
  const { period = '1m' } = req.query;
  
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid portfolio ID' });
  }

  try {
    const portfolioService = require('../services/portfolioservice');
    const historyData = await portfolioService.getPortfolioHistory(id, period);
    
    if (historyData.dataPoints === 0) {
      return res.status(404).json({ error: 'No price history found' });
    }

    res.status(200).json(historyData);
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

  // Update only allowed fields (removed calculated fields)
  const allowedUpdates = [
    'name', 'description', 'subscriptionFee', 'expiryDate', 'holdings', 
    'PortfolioCategory', 'downloadLinks', 'youTubeLinks', 'timeHorizon', 
    'rebalancing', 'index', 'details', 'compareWith', 
    'lastRebalanceDate', 'nextRebalanceDate', 'monthlyContribution'
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

/**
 * @swagger
 * /api/portfolios/{id}/telegram/access-link:
 *   post:
 *     summary: Generate Telegram group access link for portfolio
 *     tags: [Portfolio, Telegram]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portfolio ID
 *     responses:
 *       200:
 *         description: Access link generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Telegram access link generated successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     linkId:
 *                       type: string
 *                       example: "abc123def456"
 *                     inviteLink:
 *                       type: string
 *                       example: "https://t.me/+AbCdEfGhIjKlMnOp"
 *                     expiresAt:
 *                       type: string
 *                       format: date-time
 *                       example: "2024-12-07T10:30:00Z"
 *                     subscriptionExpiresAt:
 *                       type: string
 *                       format: date-time  
 *                       example: "2025-01-07T10:30:00Z"
 *                     maxUses:
 *                       type: number
 *                       example: 1
 *                     currentUses:
 *                       type: number
 *                       example: 0
 *                     portfolio:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         name:
 *                           type: string
 *       400:
 *         description: No active subscription found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "No active subscription found for this portfolio"
 *       404:
 *         description: Portfolio or telegram group not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Portfolio not found"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 details:
 *                   type: string
 */
exports.generateTelegramAccessLink = asyncHandler(async (req, res) => {
  const portfolioId = req.params.id;
  const userId = req.user._id;
  
  // Check if portfolio exists
  const portfolio = await Portfolio.findById(portfolioId);
  if (!portfolio) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  // Check if user has active subscription for this portfolio
  const Subscription = require('../models/subscription');
  const subscription = await Subscription.findOne({
    user: userId,
    productType: 'Portfolio',
    productId: portfolioId,
    status: 'active'
  });

  if (!subscription) {
    return res.status(400).json({
      error: 'No active subscription found for this portfolio'
    });
  }

  // Check if subscription is expired
  if (subscription.expiresAt < new Date()) {
    return res.status(400).json({
      error: 'Subscription has expired'
    });
  }

  try {
    // Generate access link using telegram service
    const telegramService = require('../services/telegramService');
    const inviteLink = await telegramService.generateAccessLink(
      userId,
      'Portfolio',
      portfolioId,
      subscription._id
    );

    res.json({
      success: true,
      message: 'Telegram access link generated successfully',
      data: {
        linkId: inviteLink.linkId,
        inviteLink: inviteLink.inviteLink,
        expiresAt: inviteLink.expiresAt,
        subscriptionExpiresAt: inviteLink.subscriptionExpiresAt,
        maxUses: inviteLink.maxUses,
        currentUses: inviteLink.currentUses,
        portfolio: {
          id: portfolio._id,
          name: portfolio.name
        }
      }
    });

  } catch (error) {
    if (error.message.includes('No Telegram group found')) {
      return res.status(404).json({
        error: 'No Telegram group configured for this portfolio'
      });
    }

    res.status(500).json({
      error: 'Failed to generate access link',
      details: error.message
    });
  }
});