// controllers/portfolioController.js
const Portfolio = require('../models/modelPortFolio');
const PriceLog  = require('../models/PriceLog');


/**
 * GET /api/portfolios
 */
exports.getAllPortfolios = async (req, res) => {
  try {
    const portfolios = await Portfolio.find().sort('name');
    res.status(200).json(portfolios);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/portfolios/:id
 */
exports.getPortfolioById = async (req, res) => {
  try {
    const p = await Portfolio.findById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Portfolio not found' });
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/portfolios
 */
exports.createPortfolio = async (req, res) => {
  try {
    const { name, description, subscriptionFee, minInvestment, durationMonths, expiryDate, holdings } = req.body;

    // Ensure total weight = 100
    const totalWeight = holdings.reduce((sum, h) => sum + (h.weight || 0), 0);
    if (totalWeight !== 100) {
      return res.status(400).json({ error: 'Total holdings weight must equal 100%' });
    }

    const p = new Portfolio({
      name,
      description,
      subscriptionFee,
      minInvestment,
      durationMonths,
      expiryDate,
      holdings
    });
    await p.save();
    res.status(201).json(p);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * PUT /api/portfolios/:id
 */
exports.updatePortfolio = async (req, res) => {
  try {
    const updates = req.body;
    // Prevent removal of holdings unless status = 'Sell'
    if (updates.holdings) {
      const original = await Portfolio.findById(req.params.id);
      const removed = original.holdings.filter(h =>
        !updates.holdings.some(u => u.symbol === h.symbol)
      );
      if (removed.some(r => r.status !== 'Sell')) {
        return res.status(400).json({ error: 'Can only remove holdings with status Sell' });
      }
    }
    const p = await Portfolio.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );
    if (!p) return res.status(404).json({ error: 'Portfolio not found' });
    res.json(p);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * DELETE /api/portfolios/:id
 */
exports.deletePortfolio = async (req, res) => {
  try {
    const p = await Portfolio.findByIdAndDelete(req.params.id);
    if (!p) return res.status(404).json({ error: 'Portfolio not found' });
    // Cascade delete logs
    await PriceLog.deleteMany({ portfolio: p._id });
    res.json({ message: 'Portfolio and associated logs deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
