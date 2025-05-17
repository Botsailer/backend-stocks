/**
 * Tips Controller
 * Handles CRUD operations for portfolio tips
 */
const Tip = require('../models/portfolioTips');
const Portfolio = require('../models/modelPortFolio');

/**
 * Get all tips for a specific portfolio
 */
exports.getTipsByPortfolio = async (req, res) => {
  try {
    const tips = await Tip.find({ portfolio: req.params.portfolioId }).sort('-createdAt');
    res.json(tips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Get a single tip by ID
 */
exports.getTipById = async (req, res) => {
  try {
    const tip = await Tip.findById(req.params.id);
    if (!tip) return res.status(404).json({ error: 'Not found' });
    res.json(tip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Create a new tip associated with a portfolio
 */
exports.createTip = async (req, res) => {
  try {
    const { title, content, status, buyrange, targetprice, addmoreat, tipurl, horizon } = req.body;
    
    const portfolio = await Portfolio.findById(req.params.portfolioId);
    if (!portfolio) return res.status(400).json({ error: 'Invalid portfolio' });
    
    const tip = new Tip({ 
      portfolio: portfolio._id, 
      title, 
      content, 
      status: status || 'Active',
      buyrange, 
      targetprice, 
      addmoreat, 
      tipurl, 
      horizon: horizon || 'Long Term'
    });
    
    const saved = await tip.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * Get all tips (with or without portfolio association)
 */
exports.getalltipswithoutPortfolio = async (req, res) => {
  try {
    const tips = await Tip.find().sort('-createdAt');
    res.json(tips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Create a new tip without portfolio association (general tip)
 */
exports.createTipWithoutPortfolio = async (req, res) => {
  try {
    const { title, content, status, buyrange, targetprice, addmoreat, tipurl, horizon } = req.body;
    
    const tip = new Tip({ 
      title, 
      content, 
      status: status || 'Active',
      buyrange, 
      targetprice, 
      addmoreat, 
      tipurl, 
      horizon: horizon || 'Long Term'
    });
    
    const saved = await tip.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * Update an existing tip
 */
exports.updateTip = async (req, res) => {
  try {
    const { title, content, status, buyrange, targetprice, addmoreat, tipurl, horizon } = req.body;
    
    // Only include fields that are provided in the update
    const updates = {};
    if (title) updates.title = title;
    if (content) updates.content = content;
    if (status) updates.status = status;
    if (buyrange) updates.buyrange = buyrange;
    if (targetprice) updates.targetprice = targetprice;
    if (addmoreat) updates.addmoreat = addmoreat;
    if (tipurl) updates.tipurl = tipurl;
    if (horizon) updates.horizon = horizon;
    
    const tip = await Tip.findByIdAndUpdate(
      req.params.id, 
      updates, 
      { new: true, runValidators: true }
    );
    
    if (!tip) return res.status(404).json({ error: 'Not found' });
    res.json(tip);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * Delete a tip by ID
 */
exports.deleteTip = async (req, res) => {
  try {
    const tip = await Tip.findByIdAndDelete(req.params.id);
    if (!tip) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Tip deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};