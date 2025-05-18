/**
 * Tips Controller
 * Handles CRUD operations for portfolio tips and download links
 */
const Tip = require('../models/portfolioTips');
const Portfolio = require('../models/modelPortFolio');

/**
 * Helper function to normalize request body keys to lowercase
 * This makes the API case-insensitive for field names
 */
const normalizeRequestBody = (body) => {
  const normalized = {};
  
  if (!body) return normalized;
  
  Object.keys(body).forEach(key => {
    normalized[key.toLowerCase()] = body[key];
  });
  
  return normalized;
};

/**
 * Format response data to use consistent field names
 * This ensures API returns data with specific field naming convention
 */
const formatResponseData = (data) => {
  if (!data) return null;
  
  // Handle array response
  if (Array.isArray(data)) {
    return data.map(item => formatResponseData(item));
  }

  // For plain objects, including Mongoose documents that we convert to plain JS objects
  const formatted = data.toObject ? data.toObject() : {...data};
  
  // Format specific fields that need camelCase
  if (formatted.addmoreat !== undefined) {
    formatted.addMoreAt = formatted.addmoreat;
    delete formatted.addmoreat;
  }
  
  if (formatted.buyrange !== undefined) {
    formatted.buyRange = formatted.buyrange;
    delete formatted.buyrange;
  }
  
  if (formatted.targetprice !== undefined) {
    formatted.targetPrice = formatted.targetprice;
    delete formatted.targetprice;
  }
  
  if (formatted.tipurl !== undefined) {
    formatted.tipUrl = formatted.tipurl;
    delete formatted.tipurl;
  }
  
  // Rename downloadlinks to downloadLinks if it exists
  if (formatted.downloadlinks !== undefined) {
    formatted.downloadLinks = formatted.downloadlinks;
    delete formatted.downloadlinks;
  }
  
  return formatted;
};

/**
 * Get all tips for a specific portfolio
 */
exports.getTipsByPortfolio = async (req, res) => {
  try {
    const tips = await Tip.find({ portfolio: req.params.portfolioId }).sort('-createdAt');
    res.json(formatResponseData(tips));
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
    res.json(formatResponseData(tip));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Create a new tip associated with a portfolio
 */
exports.createTip = async (req, res) => {
  try {
    // Normalize all request body keys to lowercase
    const normalized = normalizeRequestBody(req.body);
    
    // Extract values from normalized body
    const { 
      title, 
      content, 
      status, 
      buyrange, 
      targetprice, 
      addmoreat, 
      tipurl, 
      horizon, 
      downloadlinks,
      type
    } = normalized;
    
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
      horizon: horizon || 'Long Term',
      downloadlinks: downloadlinks || [],
      type
    });
    
    const saved = await tip.save();
    res.status(201).json(formatResponseData(saved));
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
    res.json(formatResponseData(tips));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Create a new tip without portfolio association (general tip)
 */
exports.createTipWithoutPortfolio = async (req, res) => {
  try {
    // Normalize all request body keys to lowercase
    const normalized = normalizeRequestBody(req.body);
    
    // Extract values from normalized body
    const { 
      title, 
      content, 
      status, 
      buyrange, 
      targetprice, 
      addmoreat, 
      tipurl, 
      horizon, 
      downloadlinks,
      type
    } = normalized;
    
    const tip = new Tip({ 
      title, 
      content, 
      status: status || 'Active',
      buyrange,
      targetprice,
      addmoreat,
      tipurl,
      horizon: horizon || 'Long Term',
      downloadlinks: downloadlinks || [],
      type
    });
    
    const saved = await tip.save();
    res.status(201).json(formatResponseData(saved));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * Update an existing tip
 */
exports.updateTip = async (req, res) => {
  try {
    // Normalize all request body keys to lowercase
    const normalized = normalizeRequestBody(req.body);
    
    // Extract values from normalized body
    const { 
      title, 
      content, 
      status, 
      buyrange, 
      targetprice, 
      addmoreat, 
      tipurl, 
      horizon, 
      downloadlinks,
      type
    } = normalized;
    
    // Only include fields that are provided in the update
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (status !== undefined) updates.status = status;
    if (buyrange !== undefined) updates.buyrange = buyrange;
    if (targetprice !== undefined) updates.targetprice = targetprice;
    if (addmoreat !== undefined) updates.addmoreat = addmoreat;
    if (tipurl !== undefined) updates.tipurl = tipurl;
    if (horizon !== undefined) updates.horizon = horizon;
    if (downloadlinks !== undefined) updates.downloadlinks = downloadlinks;
    if (type !== undefined) updates.type = type;
    
    const tip = await Tip.findByIdAndUpdate(
      req.params.id, 
      updates, 
      { new: true, runValidators: true }
    );
    
    if (!tip) return res.status(404).json({ error: 'Not found' });
    res.json(formatResponseData(tip));
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
    
    // Access using consistent naming and format the response
    const links = tip.downloadlinks || [];
    res.json(links.map(link => ({
      _id: link._id,
      name: link.name,
      url: link.url
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Add a download link to a tip
 */
exports.addDownloadLink = async (req, res) => {
  try {
    // Normalize request body keys
    const normalized = normalizeRequestBody(req.body);
    const { name, url } = normalized;
    
    if (!name || !url) {
      return res.status(400).json({ error: 'Name and URL are required for download links' });
    }
    
    const tip = await Tip.findById(req.params.id);
    if (!tip) return res.status(404).json({ error: 'Tip not found' });
    
    // Ensure the field exists
    tip.downloadlinks = tip.downloadlinks || [];
    tip.downloadlinks.push({ name, url });
    
    const updated = await tip.save();
    const newLink = updated.downloadlinks[updated.downloadlinks.length - 1];
    
    res.status(201).json({
      _id: newLink._id,
      name: newLink.name,
      url: newLink.url
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * Update a download link in a tip
 */
exports.updateDownloadLink = async (req, res) => {
  try {
    // Normalize request body keys
    const normalized = normalizeRequestBody(req.body);
    const { name, url } = normalized;
    
    if (!name && !url) {
      return res.status(400).json({ error: 'At least one field (name or URL) is required' });
    }
    
    const tip = await Tip.findById(req.params.id);
    if (!tip) return res.status(404).json({ error: 'Tip not found' });
    
    // Work with consistent field access
    const links = tip.downloadlinks || [];
    
    const linkIndex = links.findIndex(link => link._id.toString() === req.params.linkId);
    
    if (linkIndex === -1) {
      return res.status(404).json({ error: 'Download link not found' });
    }
    
    if (name) links[linkIndex].name = name;
    if (url) links[linkIndex].url = url;
    
    // Update with consistent field name
    tip.downloadlinks = links;
    
    const updated = await tip.save();
    const updatedLink = updated.downloadlinks[linkIndex];
    
    res.json({
      _id: updatedLink._id,
      name: updatedLink.name,
      url: updatedLink.url
    });
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
    
    // Work with consistent field access
    const links = tip.downloadlinks || [];
    
    const initialLength = links.length;
    const filteredLinks = links.filter(
      link => link._id.toString() !== req.params.linkId
    );
    
    if (filteredLinks.length === initialLength) {
      return res.status(404).json({ error: 'Download link not found' });
    }
    
    // Update with consistent field name
    tip.downloadlinks = filteredLinks;
    
    await tip.save();
    res.json({ message: 'Download link deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};