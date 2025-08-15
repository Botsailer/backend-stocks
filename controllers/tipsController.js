const Tip = require('../models/portfolioTips');
const Portfolio = require('../models/modelPortFolio');

function mapTipToCamelCase(tip) {
  if (!tip) return null;
  return {
    id: tip._id,
    portfolio: tip.portfolio,
    title: tip.title,
    stockId: tip.stockId,
    category: tip.category,
    content: tip.content,
    description: tip.description,
    status: tip.status,
    action: tip.action,
    buyRange: tip.buyRange,
    targetPrice: tip.targetPrice,
    targetPercentage: tip.targetPercentage,
    mpWeightage: tip.mpWeightage,
    addMoreAt: tip.addMoreAt,
    tipUrl: tip.tipUrl,
    exitPrice: tip.exitPrice,
    exitStatus: tip.exitStatus,
    exitStatusPercentage: tip.exitStatusPercentage,
    horizon: tip.horizon,
    analysistConfidence: tip.analysistConfidence || 0,
    downloadLinks: Array.isArray(tip.downloadLinks) ? tip.downloadLinks : [],
    createdAt: tip.createdAt,
    updatedAt: tip.updatedAt
  };
}

exports.getTipsByPortfolio = async (req, res) => {
  try {
    console.log('tipsController.getTipsByPortfolio called with portfolioId:', req.params.portfolioId);
    const tips = await Tip.find({ portfolio: req.params.portfolioId }).sort('-createdAt');
    res.json(tips.map(mapTipToCamelCase));
  } catch (err) {
    console.log('tipsController.getTipsByPortfolio error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getTipById = async (req, res) => {
  try {
    console.log('tipsController.getTipById called with id:', req.params.id);
    const tip = await Tip.findById(req.params.id);
    if (!tip) return res.status(404).json({ error: 'Not found' });
    res.json(mapTipToCamelCase(tip));
  } catch (err) {
    console.log('tipsController.getTipById error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.createTip = async (req, res) => {
  try {
    const {
      title,
      stockId,
      content,
      description,
      status,
      action,
      buyRange,
      targetPrice,
      targetPercentage,
      addMoreAt,
      tipUrl,
      exitPrice,
      exitStatus,
      exitStatusPercentage,
      horizon,
      downloadLinks,
      mpWeightage,
      analysistConfidence
    } = req.body;
    const portfolio = await Portfolio.findById(req.params.portfolioId);
    if (!portfolio) return res.status(400).json({ error: 'Invalid portfolio' });
    
    if (!title || !stockId || !Array.isArray(content) || !description) {
      return res.status(400).json({ error: 'Title, stockId, content (array), and description are required' });
    }
    if (content.some(item => !item.key || !item.value)) {
      return res.status(400).json({ error: 'Each content item must have key and value' });
    }
    if (downloadLinks && !Array.isArray(downloadLinks)) {
      return res.status(400).json({ error: 'downloadLinks must be an array' });
    }

    const tip = new Tip({
      portfolio: portfolio._id,
      title,
      stockId,
      content,
      description,
      status: status || 'Active',
      mpWeightage,
      action,
      buyRange,
      targetPrice,
      targetPercentage,
      addMoreAt,
      tipUrl,
      exitPrice,
      analysistConfidence,
      exitStatus,
      exitStatusPercentage,
      horizon: horizon || 'Long Term',
      downloadLinks: Array.isArray(downloadLinks) ? downloadLinks : []
    });
    const saved = await tip.save();
    res.status(201).json(mapTipToCamelCase(saved));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getalltipswithoutPortfolio = async (req, res) => {
  try {
    const tips = await Tip.find().sort('-createdAt');
    res.json(tips.map(mapTipToCamelCase));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTipsByDate = async (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;
    const user = req.user;
    
    // Validate date inputs
    if ((startDate && isNaN(new Date(startDate))) || (endDate && isNaN(new Date(endDate)))) {
      return res.status(400).json({ error: 'Invalid date format. Use ISO format (YYYY-MM-DD)' });
    }

    const query = {};
    
    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
    }
    
    // Category filter
    if (category) {
      if (!['basic', 'premium'].includes(category)) {
        return res.status(400).json({ error: 'Invalid category. Use "basic" or "premium"' });
      }
      query.category = category;
    }

    // Fetch tips
    const tips = await Tip.find(query).sort('-createdAt');
    
    // If user is admin, return all tips without restrictions
    if (user.isAdmin) {
      return res.json(tips.map(mapTipToCamelCase));
    }
    
    // Filter based on user subscription (non-admin users)
    const filteredTips = tips.map(tip => {
      // Portfolio-associated tips
      if (tip.portfolio) {
        const isSubscribed = user.subscribedPortfolios?.some(
          p => p.toString() === tip.portfolio.toString()
        );
        
        return isSubscribed 
          ? mapTipToCamelCase(tip)
          : { 
              id: tip._id, 
              title: tip.title,
              message: "Subscribe to this portfolio to view details"
            };
      }
      // Non-portfolio tips
      else {
        const canViewPremium = user.subscriptionType === 'premium';
        return (tip.category === 'basic' || canViewPremium)
          ? mapTipToCamelCase(tip)
          : { 
              id: tip._id, 
              title: tip.title,
              message: "Upgrade to premium to view this content"
            };
      }
    });

    res.json(filteredTips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.getTipByDateUsers= async (req, res) => {
    try {
    const { startDate, endDate, category } = req.query;
    const user = req.user;
    
    // Validate date inputs
    if ((startDate && isNaN(new Date(startDate))) || (endDate && isNaN(new Date(endDate)))) {
      return res.status(400).json({ error: 'Invalid date format. Use ISO format (YYYY-MM-DD)' });
    }

    const query = {};
    
    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
    }
    
    // Category filter
    if (category) {
      if (!['basic', 'premium'].includes(category)) {
        return res.status(400).json({ error: 'Invalid category. Use "basic" or "premium"' });
      }
      query.category = category;
    }

    // Fetch tips
    const tips = await Tip.find(query).sort('-createdAt');
    
    // Filter based on user subscription
    const filteredTips = tips.map(tip => {
      // Portfolio-associated tips
      if (tip.portfolio) {
        const isSubscribed = user.subscribedPortfolios?.some(
          p => p.toString() === tip.portfolio.toString()
        );
        
        return isSubscribed || user.isAdmin 
          ? mapTipToCamelCase(tip)
          : { 
              id: tip._id, 
              title: tip.title,
              message: "Subscribe to this portfolio to view details"
            };
      }
      // Non-portfolio tips
      else {
        const canViewPremium = user.subscriptionType === 'premium' || user.isAdmin;
        return (tip.category === 'basic' || canViewPremium)
          ? mapTipToCamelCase(tip)
          : { 
              id: tip._id, 
              title: tip.title,
              message: "Upgrade to premium to view this content"
            };
      }
    });

    res.json(filteredTips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createTipWithoutPortfolio = async (req, res) => {
  try {
    const {
      title,
      stockId,
      category,
      content,
      description,
      status,
      action,
      buyRange,
      targetPrice,
      targetPercentage,
      mpWeightage,
      addMoreAt,
      analysistConfidence,
      tipUrl,
      exitPrice,
      exitStatus,
      exitStatusPercentage,
      horizon,
      downloadLinks
    } = req.body;
    
    if (!title || !stockId || !Array.isArray(content) || !description) {
      return res.status(400).json({ error: 'Title, stockId, content (array), and description are required' });
    }
    if (content.some(item => !item.key || !item.value)) {
      return res.status(400).json({ error: 'Each content item must have key and value' });
    }
    if (category && !['basic', 'premium'].includes(category)) {
      return res.status(400).json({ error: 'Invalid category value' });
    }

    const tip = new Tip({
      title,
      stockId,
      category: category || 'basic',
      content,
      description,
      status: status || 'Active',
      action,
      mpWeightage,
      buyRange,
      targetPrice,
      targetPercentage,
      addMoreAt,
      analysistConfidence,
      tipUrl,
      exitPrice,
      exitStatus,
      exitStatusPercentage,
      horizon: horizon || 'Long Term',
      downloadLinks: Array.isArray(downloadLinks) ? downloadLinks : []
    });
    const saved = await tip.save();
    res.status(201).json(mapTipToCamelCase(saved));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getalltipswithoutPortfolioUser = async (req, res) => {
  try {
    const tips = await Tip.find().sort('-createdAt');
    const user = req.user;
    const processedTips = tips.map(tip => {
      // Portfolio-associated tips
      if (tip.portfolio) {
        const isSubscribed = user.subscribedPortfolios?.some(
          p => p.toString() === tip.portfolio.toString()
        );
        return isSubscribed || user.isAdmin
          ? mapTipToCamelCase(tip)
          : {
              id: tip._id,
              title: tip.title,
              portfolio: { _id: tip.portfolio._id, name: tip.portfolio.name },
              message: "Subscribe to this portfolio to view details"
            };
      }
      // Non-portfolio tips
      const canViewPremium = user.subscriptionType === 'premium' || user.isAdmin;
      if (tip.category === 'premium' && !canViewPremium) {
        return {
          id: tip._id,
          title: tip.title,
          category: 'premium',
          message: "Upgrade to premium to view this content"
        };
      }
      return mapTipToCamelCase(tip);
    });
    res.json(processedTips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateTip = async (req, res) => {
  try {
    const {
      title,
      stockId,
      category,
      content,
      description,
      status,
      action,
      buyRange,
      targetPrice,
      mpWeightage,
      targetPercentage,
      addMoreAt,
      analysistConfidence,
      tipUrl,
      exitPrice,
      exitStatus,
      exitStatusPercentage,
      horizon,
      downloadLinks
    } = req.body;
    
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (stockId !== undefined) updates.stockId = stockId;
    if (category !== undefined) {
      if (!['basic', 'premium'].includes(category)) {
        return res.status(400).json({ error: 'Invalid category value' });
      }
      updates.category = category;
    }
    if (content !== undefined) {
      if (!Array.isArray(content)) {
        return res.status(400).json({ error: 'Content must be an array' });
      }
      if (content.some(item => !item.key || !item.value)) {
        return res.status(400).json({ error: 'Each content item must have key and value' });
      }
      updates.content = content;
    }
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (action !== undefined) updates.action = action;
    if (buyRange !== undefined) updates.buyRange = buyRange;
    if (targetPrice !== undefined) updates.targetPrice = targetPrice;
    if (targetPercentage !== undefined) updates.targetPercentage = targetPercentage;
    if (addMoreAt !== undefined) updates.addMoreAt = addMoreAt;
    if (tipUrl !== undefined) updates.tipUrl = tipUrl;
    if (exitPrice !== undefined) updates.exitPrice = exitPrice;
    if (exitStatus !== undefined) updates.exitStatus = exitStatus;
    if (exitStatusPercentage !== undefined) updates.exitStatusPercentage = exitStatusPercentage;
    if (horizon !== undefined) updates.horizon = horizon;
    if (downloadLinks !== undefined) updates.downloadLinks = downloadLinks;
    if (analysistConfidence !== undefined) updates.analysistConfidence = analysistConfidence;
    if (mpWeightage !== undefined) updates.mpWeightage = mpWeightage;

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

exports.deleteTip = async (req, res) => {
  try {
    const tip = await Tip.findByIdAndDelete(req.params.id);
    if (!tip) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Tip deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getDownloadLinks = async (req, res) => {
  try {
    const tip = await Tip.findById(req.params.id);
    if (!tip) return res.status(404).json({ error: 'Tip not found' });
    res.json(Array.isArray(tip.downloadLinks) ? tip.downloadLinks : []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.addDownloadLink = async (req, res) => {
  try {
    const { name, url } = req.body;
    if (!name || !url) {
      return res.status(400).json({ error: 'Name and URL are required for download links' });
    }
    const tip = await Tip.findById(req.params.id);
    if (!tip) return res.status(404).json({ error: 'Tip not found' });
    if (!Array.isArray(tip.downloadLinks)) tip.downloadLinks = [];
    tip.downloadLinks.push({ name, url });
    const updated = await tip.save();
    res.status(201).json(updated.downloadLinks[updated.downloadLinks.length - 1]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.updateDownloadLink = async (req, res) => {
  try {
    const { name, url } = req.body;
    if (!name && !url) {
      return res.status(400).json({ error: 'At least one field (name or URL) is required' });
    }
    const tip = await Tip.findById(req.params.id);
    if (!tip) return res.status(404).json({ error: 'Tip not found' });
    if (!Array.isArray(tip.downloadLinks)) tip.downloadLinks = [];
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

exports.deleteDownloadLink = async (req, res) => {
  try {
    const tip = await Tip.findById(req.params.id);
    if (!tip) return res.status(404).json({ error: 'Tip not found' });
    if (!Array.isArray(tip.downloadLinks)) tip.downloadLinks = [];
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