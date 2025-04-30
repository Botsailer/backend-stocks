// controllers/portfolioController.js
const Portfolio = require('../models/modelPortFolio');
const Tip = require('../models/portfolioTips');
const PriceLog = require('../models/PriceLog');

exports.getAllPortfolios = async (req, res) => {
  try {
    const portfolios = await Portfolio.find().sort('name');
    res.json(portfolios);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getPortfolioById = async (req, res) => {
  try {
    const portfolio = await Portfolio.findById(req.params.id).populate('holdings');
    if (!portfolio) return res.status(404).json({ error: 'Not found' });
    res.json(portfolio);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createPortfolio = async (req, res) => {
  try {
    const { name, description, cashRemaining, holdings } = req.body;
    // Additional logic: ensure holdings weights sum <= 100, etc.
    const newPort = new Portfolio({ name, description, cashRemaining, holdings });
    const saved = await newPort.save();
    res.status(201).json(saved);
  } catch (err) {
    // Duplicate key on unique name would throw here
    res.status(400).json({ error: err.message });
  }
};

exports.updatePortfolio = async (req, res) => {
  try {
    const updates = req.body;
    // If updating holdings: ensure business logic (e.g. stock can only be removed if status='Sell')
    const portfolio = await Portfolio.findByIdAndUpdate(
      req.params.id, updates,
      { new: true, runValidators: true }
    );
    if (!portfolio) return res.status(404).json({ error: 'Not found' });
    res.json(portfolio);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.deletePortfolio = async (req, res) => {
  try {
    const portfolio = await Portfolio.findByIdAndDelete(req.params.id);
    if (!portfolio) return res.status(404).json({ error: 'Not found' });
    // Cascade delete related tips and price logs
    await Tip.deleteMany({ portfolio: portfolio._id });
    await PriceLog.deleteMany({ portfolio: portfolio._id });
    res.json({ message: 'Portfolio and related data deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
