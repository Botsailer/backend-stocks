const User = require('../models/user');
const Portfolio = require('../models/modelPortFolio');
const Subscription = require('../models/subscription');
const Cart = require('../models/carts');
const PaymentHistory = require('../models/paymenthistory');
const Tip = require('../models/portfolioTips');
const Bundle = require('../models/bundle');

// Helper: Get user's accessible portfolios and premium status
const getUserAccessInfo = async (userId) => {
  const portfolioSubs = await Subscription.find({
    user: userId,
    productType: 'Portfolio',
    isActive: true
  });

  const bundleSubs = await Subscription.find({
    user: userId,
    productType: 'Bundle',
    isActive: true
  }).populate('productId', 'portfolios');

  const accessiblePortfolioIds = new Set();
  let hasPremiumAccess = false;

  // Process portfolio subscriptions
  portfolioSubs.forEach(sub => {
    accessiblePortfolioIds.add(sub.productId.toString());
    if (sub.Category === 'premium') {
      hasPremiumAccess = true;
    }
  });

  // Process bundle subscriptions
  bundleSubs.forEach(sub => {
    const bundle = sub.productId;
    if (bundle?.portfolios) {
      bundle.portfolios.forEach(pId => 
        accessiblePortfolioIds.add(pId.toString())
      );
    }
    if (sub.Category === 'premium') {
      hasPremiumAccess = true;
    }
  });

  return {
    hasPremiumAccess,
    accessiblePortfolioIds: Array.from(accessiblePortfolioIds)
  };
};

// User Profile Endpoints
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password -refreshToken -tokenVersion');
    
    if (!user) return res.status(404).json({ error: 'User not found' });

    const requiredFields = ['fullName', 'dateofBirth', 'phone', 'pandetails', 'address', 'adharcard'];
    const isComplete = requiredFields.every(field => user[field] && user[field] !== null);
    
    const hasActiveSubscription = await Subscription.exists({
      user: user._id,
      isActive: true
    });
    
    const forceComplete = (hasActiveSubscription && !isComplete);
    
    res.json({
      ...user.toObject(),
      profileComplete: isComplete,
      forceComplete: forceComplete,
      missingFields: !isComplete ? requiredFields.filter(field => !user[field] || user[field] === null) : [],
      panUpdateInfo: {
        canUpdatePAN: !user.panUpdatedByUser || user.isAdmin,
        lastUpdated: user.panUpdatedAt,
        updatedByUser: user.panUpdatedByUser
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const updates = req.body;
    const isAdmin = req.user.isAdmin || false;
    
    const restrictedFields = ['password', 'refreshToken', 'tokenVersion', 'provider', 
                             'providerId', 'emailVerified', 'changedPasswordAt', 
                             'panUpdatedByUser', 'panUpdatedAt'];
    restrictedFields.forEach(field => delete updates[field]);

    if (updates.username) {
      const existingUser = await User.findOne({ 
        username: updates.username,
        _id: { $ne: userId }
      });
      if (existingUser) {
        return res.status(400).json({ error: 'Username already taken' });
      }
    }

    if (updates.email) {
      const existingUser = await User.findOne({ 
        email: updates.email,
        _id: { $ne: userId }
      });
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }
      updates.emailVerified = false;
    }

    if (updates.pandetails && updates.pandetails.trim() !== '') {
      const panCardRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
      if (!panCardRegex.test(updates.pandetails.trim())) {
        return res.status(400).json({ 
          error: 'Invalid PAN card format. Must be AAAAA9999A' 
        });
      }
      
      const currentUser = await User.findById(userId);
      
      if (currentUser.panUpdatedByUser && !isAdmin) {
        return res.status(403).json({ 
          error: 'PAN card can only be updated once' 
        });
      }
      
      updates.pandetails = updates.pandetails.trim().toUpperCase();
      
      if (!currentUser.panUpdatedByUser && !isAdmin) {
        updates.panUpdatedByUser = true;
        updates.panUpdatedAt = new Date();
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password -refreshToken -tokenVersion');

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const requiredFields = ['fullName', 'dateofBirth', 'phone'];
    const isComplete = requiredFields.every(field => updatedUser[field] && updatedUser[field] !== null);

    res.json({
      ...updatedUser.toObject(),
      profileComplete: isComplete,
      missingFields: !isComplete ? requiredFields.filter(field => !updatedUser[field] || updatedUser[field] === null) : [],
      message: 'Profile updated successfully'
    });

  } catch (err) {
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ error: errors.join(', ') });
    }
    res.status(500).json({ error: err.message });
  }
};

// Portfolio Endpoints
exports.getAllPortfolios = async (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;
    const user = req.user;
    
    const query = {};
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
    }
    
    if (category) {
      if (!['basic', 'premium'].includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      query.category = category;
    }

    const portfolios = await Portfolio.find(query).sort('name');
    
    // For unauthenticated users
    if (!user) {
      const limitedPortfolios = portfolios.map(p => ({
        _id: p._id,
        name: p.name,
        description: p.description,
        subscriptionFee: p.subscriptionFee,
        minInvestment: p.minInvestment,
        durationMonths: p.durationMonths,
        createdAt: p.createdAt,
        message: "Login to view details"
      }));
      return res.json(limitedPortfolios);
    }
    
    // Get access information
    const { accessiblePortfolioIds } = await getUserAccessInfo(user._id);
    
    const processedPortfolios = portfolios.map(p => {
      const isAccessible = user.isAdmin || 
        accessiblePortfolioIds.includes(p._id.toString());
      
      if (isAccessible) return p;
      
      return {
        _id: p._id,
        name: p.name,
        description: p.description,
        subscriptionFee: p.subscriptionFee,
        minInvestment: p.minInvestment,
        durationMonths: p.durationMonths,
        createdAt: p.createdAt,
        message: "Subscribe to view complete details"
      };
    });
    
    res.json(processedPortfolios);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getPortfolioById = async (req, res) => {
  try {
    const portfolio = await Portfolio.findById(req.params.id);
    if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });
    
    const user = req.user;
    
    // For unauthenticated users
    if (!user) {
      return res.json({
        _id: portfolio._id,
        name: portfolio.name,
        description: portfolio.description,
        subscriptionFee: portfolio.subscriptionFee,
        minInvestment: portfolio.minInvestment,
        durationMonths: portfolio.durationMonths,
        createdAt: portfolio.createdAt,
        message: "Login to view details"
      });
    }
    
    // For admins
    if (user.isAdmin) return res.json(portfolio);
    
    // Get access information
    const { accessiblePortfolioIds } = await getUserAccessInfo(user._id);
    const isAccessible = accessiblePortfolioIds.includes(portfolio._id.toString());
    
    if (isAccessible) return res.json(portfolio);
    
    return res.json({
      _id: portfolio._id,
      name: portfolio.name,
      description: portfolio.description,
      subscriptionFee: portfolio.subscriptionFee,
      minInvestment: portfolio.minInvestment,
      durationMonths: portfolio.durationMonths,
      createdAt: portfolio.createdAt,
      message: "Subscribe to view complete details"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getUserSubscriptions = async (req, res) => {
  try {
    const subscriptions = await Subscription.find({ user: req.user._id })
      .populate('productId', 'name description subscriptionFee')
      .sort('-createdAt');
    res.json(subscriptions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Tips Endpoints
exports.getTips = async (req, res) => {
  try {
    const { startDate, endDate, category, status, action, stockId } = req.query;
    const user = req.user;
    const query = { portfolio: { $exists: false } };
    
    // Date filtering
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
    }

    // Category filtering
    if (category) {
      if (!['basic', 'premium'].includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      query.category = category;
    }
    
    // Additional filters
    if (status) query.status = status;
    if (action) query.action = action;
    if (stockId) query.stockId = stockId;

    const tips = await Tip.find(query).sort('-createdAt');
    
    // For unauthenticated users
    if (!user) {
      return res.json(tips.map(tip => ({
        _id: tip._id,
        title: tip.title,
        stockId: tip.stockId,
        category: tip.category,
        createdAt: tip.createdAt,
        status: tip.status,
        action: tip.action,
        message: "Login to view details"
      }))); 
    }
    
    // For admins - full access
    if (user.isAdmin) return res.json(tips);

    // Get access information
    const { hasPremiumAccess } = await getUserAccessInfo(user._id);

    const processedTips = tips.map(tip => {
      // Always show basic tips
      if (tip.category === 'basic') return tip;
      
      // Show premium tips if user has access
      if (tip.category === 'premium' && hasPremiumAccess) return tip;
      
      // Restricted premium tip
      return {
        _id: tip._id,
        title: tip.title,
        stockId: tip.stockId,
        category: 'premium',
        createdAt: tip.createdAt,
        status: tip.status,
        action: tip.action,
        message: "Upgrade to premium to view this content"
      };
    });

    res.json(processedTips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTipsWithPortfolio = async (req, res) => {
  try {
    const { startDate, endDate, category, portfolioId, status, action, stockId } = req.query;
    const user = req.user;
    const query = { portfolio: { $ne: null } };
    
    // Date filtering
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
    }

    // Category filtering
    if (category) {
      if (!['basic', 'premium'].includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      query.category = category;
    }
    
    // Portfolio filtering
    if (portfolioId) query.portfolio = portfolioId;
    
    // Additional filters
    if (status) query.status = status;
    if (action) query.action = action;
    if (stockId) query.stockId = stockId;

    const tips = await Tip.find(query)
      .populate('portfolio', 'name')
      .sort('-createdAt');
    
    // For unauthenticated users
    if (!user) {
      return res.json(tips.map(tip => ({
        _id: tip._id,
        title: tip.title,
        stockId: tip.stockId,
        category: tip.category,
        portfolio: tip.portfolio ? { 
          _id: tip.portfolio._id, 
          name: tip.portfolio.name 
        } : null,
        createdAt: tip.createdAt,
        status: tip.status,
        action: tip.action,
        message: "Login to view details"
      }))); 
    }
    
    // Get access information
    const { accessiblePortfolioIds } = await getUserAccessInfo(user._id);

    const processedTips = tips.map(tip => {
      // Admin access
      if (user.isAdmin) return tip;
      
      // Portfolio tip access
      const isAccessible = tip.portfolio && 
        accessiblePortfolioIds.includes(tip.portfolio._id.toString());
      
      if (isAccessible) return tip;
      
      return {
        _id: tip._id,
        title: tip.title,
        stockId: tip.stockId,
        category: tip.category,
        portfolio: tip.portfolio ? { 
          _id: tip.portfolio._id, 
          name: tip.portfolio.name 
        } : null,
        createdAt: tip.createdAt,
        status: tip.status,
        action: tip.action,
        message: "Subscribe to this portfolio to view details"
      };
    });

    res.json(processedTips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTipById = async (req, res) => {
  try {
    const tip = await Tip.findById(req.params.id)
      .populate('portfolio', 'name');
    
    if (!tip) return res.status(404).json({ error: 'Tip not found' });
    
    const user = req.user;
    
    // For unauthenticated users
    if (!user) {
      return res.json({
        _id: tip._id,
        title: tip.title,
        stockId: tip.stockId,
        category: tip.category,
        portfolio: tip.portfolio ? { 
          _id: tip.portfolio._id, 
          name: tip.portfolio.name 
        } : null,
        createdAt: tip.createdAt,
        status: tip.status,
        action: tip.action,
        message: "Login to view details"
      });
    }
    
    // Admin access
    if (user.isAdmin) return res.json(tip);
    
    // Get access information
    const { hasPremiumAccess, accessiblePortfolioIds } = await getUserAccessInfo(user._id);
    
    // Portfolio tip access
    if (tip.portfolio) {
      const isAccessible = accessiblePortfolioIds.includes(tip.portfolio._id.toString());
      
      if (isAccessible) return res.json(tip);
      
      return res.json({
        _id: tip._id,
        title: tip.title,
        stockId: tip.stockId,
        category: tip.category,
        portfolio: tip.portfolio ? { 
          _id: tip.portfolio._id, 
          name: tip.portfolio.name 
        } : null,
        createdAt: tip.createdAt,
        status: tip.status,
        action: tip.action,
        message: "Subscribe to this portfolio to view details"
      });
    }
    
    // General tip access
    if (tip.category === 'premium' && !hasPremiumAccess) {
      return res.json({
        _id: tip._id,
        title: tip.title,
        stockId: tip.stockId,
        category: 'premium',
        createdAt: tip.createdAt,
        status: tip.status,
        action: tip.action,
        message: "Upgrade to premium to view this content"
      });
    }
    
    // Basic tip or premium with access
    return res.json(tip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Payment and Cart Endpoints
exports.getUserPaymentHistory = async (req, res) => {
  try {
    const payments = await PaymentHistory.find({ user: req.user._id })
      .populate('portfolio', 'name')
      .select('-signature')
      .sort('-createdAt');
    
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getCart = async (req, res) => {
  try {
    let cart = await Cart.findOne({ user: req.user._id })
      .populate('items.portfolio', 'name subscriptionFee minInvestment');
    
    if (!cart) {
      cart = new Cart({ user: req.user._id, items: [] });
      await cart.save();
    }
    
    res.json(cart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.addToCart = async (req, res) => {
  try {
    const { portfolioId } = req.body;
    const portfolio = await Portfolio.findById(portfolioId);
    if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });

    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) cart = new Cart({ user: req.user._id, items: [] });

    const existingIndex = cart.items.findIndex(
      item => item.portfolio.toString() === portfolioId
    );

    if (existingIndex > -1) {
      cart.items[existingIndex].quantity += 1;
    } else {
      cart.items.push({ portfolio: portfolioId, quantity: 1 });
    }

    await cart.save();
    res.json(await Cart.findById(cart._id).populate('items.portfolio'));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.removeFromCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return res.status(404).json({ error: 'Cart not found' });

    cart.items = cart.items.filter(
      item => item.portfolio.toString() !== req.params.portfolioId
    );

    await cart.save();
    res.json(await Cart.findById(cart._id).populate('items.portfolio'));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.clearCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return res.status(404).json({ error: 'Cart not found' });

    cart.items = [];
    await cart.save();
    res.json(cart);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};