const User = require('../models/user');
const Portfolio = require('../models/modelPortFolio');
const Subscription = require('../models/subscription');
const Cart = require('../models/carts');
const PaymentHistory = require('../models/paymenthistory');
const Tip = require('../models/portfolioTips');
const Bundle = require('../models/bundle');

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password -refreshToken -tokenVersion');
    
    if (!user) return res.status(404).json({ error: 'User not found' });

    const requiredFields = ['fullName', 'dateofBirth', 'phone'];
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
      missingFields: !isComplete ? requiredFields.filter(field => !user[field] || user[field] === null) : []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const updates = req.body;
    
    const restrictedFields = ['password', 'refreshToken', 'tokenVersion', 'provider', 'providerId', 'emailVerified', 'changedPasswordAt'];
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
          error: 'Invalid PAN card format. Must be AAAAA9999A (5 letters, 4 digits, 1 letter)' 
        });
      }
      updates.pandetails = updates.pandetails.trim().toUpperCase();
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
        return res.status(400).json({ error: 'Invalid category. Use "basic" or "premium"' });
      }
      query.category = category;
    }

    const portfolios = await Portfolio.find(query).sort('name');
    
    if (!user) {
      const limitedPortfolios = portfolios.map(portfolio => ({
        _id: portfolio._id,
        name: portfolio.name,
        description: portfolio.description,
        subscriptionFee: portfolio.subscriptionFee,
        minInvestment: portfolio.minInvestment,
        durationMonths: portfolio.durationMonths,
        createdAt: portfolio.createdAt,
        CAGRSinceInception: portfolio.CAGRSinceInception,
        oneYearGains: portfolio.oneYearGains,
        monthlyGains: portfolio.monthlyGains
      }));
      return res.json(limitedPortfolios);
    }
    
    let subscribedPortfolioIds = [];
    
    const directSubscriptions = await Subscription.find({
      user: user._id,
      productType: 'Portfolio',
      isActive: true
    });
    subscribedPortfolioIds = directSubscriptions.map(sub => sub.productId.toString());
    
    const bundleSubscriptions = await Subscription.find({
      user: user._id,
      productType: 'Bundle',
      isActive: true
    });
    
    if (bundleSubscriptions.length > 0) {
      const bundleIds = bundleSubscriptions.map(sub => sub.productId);
      const bundles = await Bundle.find({ _id: { $in: bundleIds } });
      
      bundles.forEach(bundle => {
        bundle.portfolios.forEach(portfolioId => {
          subscribedPortfolioIds.push(portfolioId.toString());
        });
      });
    }
    
    const processedPortfolios = portfolios.map(portfolio => {
      const portfolioObj = portfolio.toObject();
      const isSubscribed = subscribedPortfolioIds.includes(portfolio._id.toString()) || user.isAdmin;
      
      if (isSubscribed) {
        return portfolioObj;
      } else {
        return {
          _id: portfolio._id,
          name: portfolio.name,
          description: portfolio.description,
          subscriptionFee: portfolio.subscriptionFee,
          minInvestment: portfolio.minInvestment,
          durationMonths: portfolio.durationMonths,
          createdAt: portfolio.createdAt,
          CAGRSinceInception: portfolio.CAGRSinceInception,
          oneYearGains: portfolio.oneYearGains,
          monthlyGains: portfolio.monthlyGains,
          message: "Subscribe to view complete details"
        };
      }
    });
    
    res.json(processedPortfolios);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getPortfolioById = async (req, res) => {
  try {
    const portfolio = await Portfolio.findById(req.params.id);
    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }
    
    const user = req.user;
    
    if (!user) {
      const limitedPortfolio = {
        _id: portfolio._id,
        name: portfolio.name,
        description: portfolio.description,
        subscriptionFee: portfolio.subscriptionFee,
        minInvestment: portfolio.minInvestment,
        durationMonths: portfolio.durationMonths,
        createdAt: portfolio.createdAt,
        CAGRSinceInception: portfolio.CAGRSinceInception,
        oneYearGains: portfolio.oneYearGains,
        monthlyGains: portfolio.monthlyGains,
        message: "Subscribe to view complete details"
      };
      return res.json(limitedPortfolio);
    }
    
    if (user.isAdmin) {
      return res.json(portfolio);
    }
    
    const directSubscription = await Subscription.findOne({
      user: user._id,
      productType: 'Portfolio',
      productId: portfolio._id,
      isActive: true
    });
    
    if (directSubscription) {
      return res.json(portfolio);
    }
    
    const bundleSubscriptions = await Subscription.find({
      user: user._id,
      productType: 'Bundle',
      isActive: true
    });
    
    let hasAccess = false;
    if (bundleSubscriptions.length > 0) {
      const bundleIds = bundleSubscriptions.map(sub => sub.productId);
      const count = await Bundle.countDocuments({
        _id: { $in: bundleIds },
        portfolios: portfolio._id
      });
      
      hasAccess = count > 0;
    }
    
    if (hasAccess) {
      return res.json(portfolio);
    }
    
    const limitedPortfolio = {
      _id: portfolio._id,
      name: portfolio.name,
      description: portfolio.description,
      subscriptionFee: portfolio.subscriptionFee,
      minInvestment: portfolio.minInvestment,
      durationMonths: portfolio.durationMonths,
      createdAt: portfolio.createdAt,
      CAGRSinceInception: portfolio.CAGRSinceInception,
      oneYearGains: portfolio.oneYearGains,
      monthlyGains: portfolio.monthlyGains,
      message: "Subscribe to view complete details"
    };
    
    res.json(limitedPortfolio);
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

exports.getTips = async (req, res) => {
  try {
    const { startDate, endDate, category, status, action, stockId } = req.query;
    const user = req.user;
    const query = { portfolio: { $exists: false } };
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
    }

    if (category) {
      if (!['basic', 'premium'].includes(category)) {
        return res.status(400).json({ error: 'Invalid category. Use "basic" or "premium"' });
      }
      query.category = category;
    }
    
    if (status) query.status = status;
    if (action) query.action = action;
    if (stockId) query.stockId = stockId;

    const tips = await Tip.find(query)
      .sort('-createdAt');
    
    if (!user) {
      const limitedTips = tips.map(tip => ({
        _id: tip._id,
        title: tip.title,
        stockId: tip.stockId,
        category: tip.category,
        createdAt: tip.createdAt,
        status: tip.status,
        action: tip.action,
        message: "Login and subscribe to view details"
      }));
      return res.json(limitedTips);
    }
    
    let hasPremiumAccess = user.isAdmin;
    
    if (!hasPremiumAccess) {
      const bundleSubscriptions = await Subscription.find({
        user: user._id,
        productType: 'Bundle',
        isActive: true
      });
      
      hasPremiumAccess = bundleSubscriptions.some(sub => 
        sub.bundle && sub.bundle.category === 'premium'
      );
    }
    
    const processedTips = tips.map(tip => {
      const tipObj = tip.toObject();
      
      if (user.isAdmin) return tipObj;
      
      if (tip.category === 'premium' && !hasPremiumAccess) {
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
      }
      
      return tipObj;
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
    const query = { portfolio: { $exists: true } };
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
    }

    if (category) {
      if (!['basic', 'premium'].includes(category)) {
        return res.status(400).json({ error: 'Invalid category. Use "basic" or "premium"' });
      }
      query.category = category;
    }
    
    if (portfolioId) query.portfolio = portfolioId;
    if (status) query.status = status;
    if (action) query.action = action;
    if (stockId) query.stockId = stockId;

    const tips = await Tip.find(query)
      .populate('portfolio', 'name')
      .sort('-createdAt');
    
    if (!user) {
      const limitedTips = tips.map(tip => ({
        _id: tip._id,
        title: tip.title,
        stockId: tip.stockId,
        category: tip.category,
        portfolio: tip.portfolio ? { _id: tip.portfolio._id, name: tip.portfolio.name } : null,
        createdAt: tip.createdAt,
        status: tip.status,
        action: tip.action,
        message: "Login and subscribe to view details"
      }));
      return res.json(limitedTips);
    }
    
    const portfolioSubscriptions = await Subscription.find({
      user: user._id,
      productType: 'Portfolio',
      isActive: true
    });
    const subscribedPortfolioIds = portfolioSubscriptions.map(sub => sub.productId.toString());
    
    const bundleSubscriptions = await Subscription.find({
      user: user._id,
      productType: 'Bundle',
      isActive: true
    });
    
    let bundlePortfolioIds = [];
    if (bundleSubscriptions.length > 0) {
      const bundleIds = bundleSubscriptions.map(sub => sub.productId);
      const bundles = await Bundle.find({ _id: { $in: bundleIds } });
      
      bundles.forEach(bundle => {
        bundle.portfolios.forEach(pId => {
          bundlePortfolioIds.push(pId.toString());
        });
      });
    }
    
    const accessiblePortfolioIds = [...new Set([...subscribedPortfolioIds, ...bundlePortfolioIds])];
    
    const processedTips = tips.map(tip => {
      const tipObj = tip.toObject();
      
      if (user.isAdmin) return tipObj;
      
      const hasPortfolioAccess = accessiblePortfolioIds.includes(tip.portfolio._id.toString());
      
      if (hasPortfolioAccess) {
        return tipObj;
      } else {
        return {
          _id: tip._id,
          title: tip.title,
          stockId: tip.stockId,
          category: tip.category,
          portfolio: { _id: tip.portfolio._id, name: tip.portfolio.name },
          status: tip.status,
          action: tip.action,
          createdAt: tip.createdAt,
          message: "Subscribe to this portfolio to view details"
        };
      }
    });

    res.json(processedTips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTipById = async (req, res) => {
  try {
    const tip = await Tip.findById(req.params.id).populate('portfolio', 'name');
    if (!tip) {
      return res.status(404).json({ error: 'Tip not found' });
    }
    
    const user = req.user;
    
    if (!user) {
      const limitedTip = {
        _id: tip._id,
        title: tip.title,
        stockId: tip.stockId,
        category: tip.category,
        portfolio: tip.portfolio ? { _id: tip.portfolio._id, name: tip.portfolio.name } : null,
        createdAt: tip.createdAt,
        status: tip.status,
        action: tip.action,
        message: "Login and subscribe to view details"
      };
      return res.json(limitedTip);
    }
    
    if (user.isAdmin) {
      return res.json(tip);
    }
    
    if (tip.portfolio) {
      const portfolioSub = await Subscription.exists({
        user: user._id,
        productType: 'Portfolio',
        productId: tip.portfolio._id,
        isActive: true
      });
      
      const bundleSub = await Subscription.exists({
        user: user._id,
        productType: 'Bundle',
        isActive: true,
        'bundle.portfolios': tip.portfolio._id
      });
      
      if (!portfolioSub && !bundleSub) {
        return res.json({
          _id: tip._id,
          title: tip.title,
          stockId: tip.stockId,
          category: tip.category,
          portfolio: { _id: tip.portfolio._id, name: tip.portfolio.name },
          status: tip.status,
          action: tip.action,
          createdAt: tip.createdAt,
          message: "Subscribe to this portfolio to view details"
        });
      }
    } else {
      if (tip.category === 'premium') {
        const hasPremiumAccess = await Subscription.exists({
          user: user._id,
          productType: 'Bundle',
          isActive: true,
          'bundle.category': 'premium'
        });
        
        if (!hasPremiumAccess) {
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
      }
    }
    
    res.json(tip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

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