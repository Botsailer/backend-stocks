// controllers/tipController.js
const Tip = require('../models/portfolioTips');
const Portfolio = require('../models/modelPortFolio');

exports.getTipsByPortfolio = async (req, res) => {
  try {
    const tips = await Tip.find({ portfolio: req.params.portfolioId }).sort('-createdAt');
    res.json(tips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTipById = async (req, res) => {
  try {
    const tip = await Tip.findById(req.params.id);
    if (!tip) return res.status(404).json({ error: 'Not found' });
    res.json(tip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createTip = async (req, res) => {
  try {
    const { title, content, status } = req.body;
    const portfolio = await Portfolio.findById(req.params.portfolioId);
    if (!portfolio) return res.status(400).json({ error: 'Invalid portfolio' });
    const tip = new Tip({ portfolio: portfolio._id, title, content, status });
    const saved = await tip.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.updateTip = async (req, res) => {
  try {
    const updates = req.body;
    const tip = await Tip.findByIdAndUpdate(
      req.params.id, updates, 
      { new: true, runValidators: true }
    );
    if (!tip) return res.status(404).json({ error: 'Not found' });
    res.json(tip);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.deleteTip = async (req, res) => {
  try {
    const tip = await Tip.findByIdAndDelete(req.params.id);
    if (!tip) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Tip deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
