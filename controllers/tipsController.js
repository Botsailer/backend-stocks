/**
 * Tips Controller
 * Handles CRUD operations for portfolio tips and download links
 */
const Tip = require('../models/portfolioTips');
const Portfolio = require('../models/modelPortFolio');

/**
 * Utility function to map Tip document to camelCase response
 */
function mapTipToCamelCase(tip) {
  if (!tip) return null;



  return {
    id: tip._id,
    portfolio: tip.portfolio,
    title: tip.title,
    content: tip.content,
    status: tip.status,
    buyRange: tip.buyRange,
    targetPrice: tip.targetPrice,
    addMoreAt: tip.addMoreAt,
    tipUrl: tip.tipUrl,
    horizon: tip.horizon,
    type: tip.type,
    downloadLinks: tip.downloadLinks,
    createdAt: tip.createdAt,
    updatedAt: tip.updatedAt,
  };
}

/**
 * Get all tips for a specific portfolio
 */
exports.getTipsByPortfolio = async (req, res) => {
  try {
    const tips = await Tip.find({ portfolio: req.params.portfolioId }).sort('-createdAt');
    res.json(tips.map(mapTipToCamelCase));
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
    res.json(mapTipToCamelCase(tip));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Create a new tip associated with a portfolio
 */
exports.createTip = async (req, res) => {
  try {
    const {
      title,
      content,
      status,
      buyRange,
      targetPrice,
      addMoreAt,
      tipUrl,
      horizon,
      downloadLinks
    } = req.body;
    const portfolio = await Portfolio.findById(req.params.portfolioId);
    if (!portfolio) return res.status(400).json({ error: 'Invalid portfolio' });
    const tip = new Tip({
      portfolio: portfolio._id,
      title,
      content,
      status: status || 'Active',
      buyRange,
      targetPrice,
      addMoreAt,
      tipUrl,
      horizon: horizon || 'Long Term',
      downloadLinks: downloadLinks || []
    });
    const saved = await tip.save();
    res.status(201).json(mapTipToCamelCase(saved));
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
    res.json(tips.map(mapTipToCamelCase));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Create a new tip without portfolio association (general tip)
 */
exports.createTipWithoutPortfolio = async (req, res) => {
  try {
    const {
      title,
      content,
      status,
      buyRange,
      targetPrice,
      addMoreAt,
      tipUrl,
      horizon,
      downloadLinks
    } = req.body;
    const tip = new Tip({
      title,
      content,
      status: status || 'Active',
      buyRange,
      targetPrice,
      addMoreAt,
      tipUrl,
      horizon: horizon || 'Long Term',
      downloadLinks: downloadLinks || []
    });
    const saved = await tip.save();
    res.status(201).json(mapTipToCamelCase(saved));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * Update an existing tip
 */
exports.updateTip = async (req, res) => {
  try {
    const {
      title,
      content,
      status,
      buyRange,
      targetPrice,
      addMoreAt,
      tipUrl,
      horizon,
      downloadLinks
    } = req.body;
    const updates = {};
    if (title) updates.title = title;
    if (content) updates.content = content;
    if (status) updates.status = status;
    if (buyRange) updates.buyRange = buyrange;
    if (targetPrice) updates.targetPrice = targetPrice;
    if (addMoreAt) updates.addMoreAt = addMoreAt;
    if (tipUrl) updates.tipUrl = tipUrl;
    if (horizon) updates.horizon = horizon;
    if (downloadLinks) updates.downloadLinks = downloadLinks;
    const tip = await Tip.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );
    if (!tip) return res.status(404).json({ error: 'Not found' });
    res.json(mapTipToCamelCase(tip));
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

/**
 * Get all download links for a tip
 */
exports.getDownloadLinks = async (req, res) => {
  try {
    const tip = await Tip.findById(req.params.id);
    if (!tip) return res.status(404).json({ error: 'Tip not found' });
    res.json(tip.downloadLinks || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Add a download link to a tip
 */
exports.addDownloadLink = async (req, res) => {
  try {
    const { name, url } = req.body;
    if (!name || !url) {
      return res.status(400).json({ error: 'Name and URL are required for download links' });
    }
    const tip = await Tip.findById(req.params.id);
    if (!tip) return res.status(404).json({ error: 'Tip not found' });
    tip.downloadLinks = tip.downloadLinks || [];
    tip.downloadLinks.push({ name, url });
    const updated = await tip.save();
    res.status(201).json(updated.downloadLinks[updated.downloadLinks.length - 1]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * Update a download link in a tip
 */
exports.updateDownloadLink = async (req, res) => {
  try {
    const { name, url } = req.body;
    if (!name && !url) {
      return res.status(400).json({ error: 'At least one field (name or URL) is required' });
    }
    const tip = await Tip.findById(req.params.id);
    if (!tip) return res.status(404).json({ error: 'Tip not found' });
    const linkIndex = tip.downloadLinks.findIndex(link => link._id.toString() === req.params.linkId);
    if (linkIndex === -1) {
      return res.status(404).json({ error: 'Download link not found' });
    }
    if (name) tip.downloadLinks[linkIndex].name = name;
    if (url) tip.downloadLinks[linkIndex].url = url;
    const updated = await tip.save();
    res.json(updated.downloadLinks[linkIndex]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * Delete a download link from a tip
 */
exports.deleteDownloadLink = async (req, res) => {
  try {
    const tip = await Tip.findById(req.params.id);
    if (!tip) return res.status(404).json({ error: 'Tip not found' });
    const initialLength = tip.downloadLinks.length;
    tip.downloadLinks = tip.downloadLinks.filter(
      link => link._id.toString() !== req.params.linkId
    );
    if (tip.downloadLinks.length === initialLength) {
      return res.status(404).json({ error: 'Download link not found' });
    }
    await tip.save();
    res.json({ message: 'Download link deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};