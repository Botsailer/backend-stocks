
// controllers/portfolioController.js
// ----------------------------------
// Controller functions for Portfolio endpoints

const Portfolio = require('../models/modelPortFolio');
const Tip = require('../models/portfolioTips');
const PriceLog = require('../models/PriceLog');

/**
 * GET /api/portfolios
 * Retrieve all portfolios, sorted by name
 */
exports.getAllPortfolios = async (req, res) => {
  try {
    const portfolios = await Portfolio.find().sort('name');
    return res.status(200).json(portfolios);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/portfolios/:id
 * Retrieve a single portfolio by ID
 */
exports.getPortfolioById = async (req, res) => {
  try {
    const portfolio = await Portfolio.findById(req.params.id);
    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }
    return res.status(200).json(portfolio);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/portfolios
 * Create a new portfolio
 */
exports.createPortfolio = async (req, res) => {
  try {
    const { name, description, cashRemaining, subscriptionFee, minInvestment, durationMonths, expiryDate, holdings } = req.body;
    // Validate total weight of holdings <= 100
    if (holdings && Array.isArray(holdings)) {
      const totalWeight = holdings.reduce((sum, h) => sum + (h.weight || 0), 0);
      if (totalWeight > 100) {
        return res.status(400).json({ error: 'Total holdings weight cannot exceed 100%' });
      }
    }
    const newPortfolio = new Portfolio({ name, description, cashRemaining, subscriptionFee, minInvestment, durationMonths, expiryDate, holdings });
    const saved = await newPortfolio.save();
    return res.status(201).json(saved);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
};

/**
 * PUT /api/portfolios/:id
 * Update an existing portfolio
 */
exports.updatePortfolio = async (req, res) => {
  try {
    const updates = req.body;
    // Prevent removal of stocks unless status = 'Sell'
    if (updates.holdings) {
      const original = await Portfolio.findById(req.params.id);
      const removed = original.holdings.filter(h => !updates.holdings.some(u => u.symbol === h.symbol));
      if (removed.some(r => r.status !== 'Sell')) {
        return res.status(400).json({ error: 'Holdings can only be removed if status is Sell' });
      }
    }
    const portfolio = await Portfolio.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }
    return res.status(200).json(portfolio);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
};

/**
 * DELETE /api/portfolios/:id
 * Delete a portfolio and cascade delete related tips and price logs
 */
exports.deletePortfolio = async (req, res) => {
  try {
    const portfolio = await Portfolio.findByIdAndDelete(req.params.id);
    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }
    await Tip.deleteMany({ portfolio: portfolio._id });
    await PriceLog.deleteMany({ portfolio: portfolio._id });
    return res.status(200).json({ message: 'Portfolio and related data deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
