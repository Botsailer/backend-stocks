const Portfolio = require('../models/modelPortFolio');
const PriceLog = require('../models/PriceLog');

exports.getAllPortfolios = async (req, res) => {
  try {
    const portfolios = await Portfolio.find().sort('name');
    res.json(portfolios);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getPortfolioById = async (req, res) => {
  try {
    const portfolio = await Portfolio.findById(req.params.id);
    if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });
    res.json(portfolio);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createPortfolio = async (req, res) => {
  try {
    const { name, description, subscriptionFee, minInvestment, durationMonths, 
      expiryDate, holdings, PortfolioCategory, downloadLinks, cashRemaining } = req.body;

    const portfolio = new Portfolio({
      name,
      description: description || '',
      subscriptionFee,
      minInvestment,
      durationMonths,
      expiryDate: expiryDate || new Date(Date.now() + durationMonths * 30 * 24 * 60 * 60 * 1000),
      holdings: holdings || [],
      PortfolioCategory: PortfolioCategory || 'Basic',
      downloadLinks: downloadLinks || [],
      cashRemaining: cashRemaining || 0
    });

    await portfolio.save();
    res.status(201).json(portfolio);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updatePortfolio = async (req, res) => {
  try {
    const updates = req.body;
    const portfolio = await Portfolio.findByIdAndUpdate(req.params.id, updates, { new: true });
    
    if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });
    res.json(portfolio);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deletePortfolio = async (req, res) => {
  try {
    const portfolio = await Portfolio.findByIdAndDelete(req.params.id);
    if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });
    
    await PriceLog.deleteMany({ portfolio: portfolio._id });
    res.json({ message: 'Portfolio deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};