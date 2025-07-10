/**
 * userController.js
 * -----------------
 * Controller for user-specific routes to access non-sensitive portfolio data
 * and manage user profile information
 */
const User = require('../models/user');
const Portfolio = require('../models/modelPortFolio');
const Subscription = require('../models/subscription');
const Cart = require('../models/carts'); // Use a single consistent name with PascalCase
const PaymentHistory = require('../models/paymenthistory');
const Tip = require('../models/portfolioTips');
/**
 * Get user's profile information
 */
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password -refreshToken -tokenVersion');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.getAllPortfolios = async (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;
    const user = req.user;
    
    // Build query with filters
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

    // Get all portfolios with basic info
    const portfolios = await Portfolio.find(query).sort('name');
    
    // If user is not logged in, return limited info for all portfolios
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
    
    // For authenticated users, check subscriptions
    let subscribedPortfolioIds = [];
    
    // Get direct portfolio subscriptions
    const directSubscriptions = await Subscription.find({
      user: user._id,
      productType: 'Portfolio',
      isActive: true
    });
    subscribedPortfolioIds = directSubscriptions.map(sub => sub.productId.toString());
    
    // Get bundle subscriptions and extract portfolio IDs
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
    
    // Create response with full details for subscribed portfolios
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
    
    // If user is not logged in, return limited info
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
    
    // Check if admin (full access)
    if (user.isAdmin) {
      return res.json(portfolio);
    }
    
    // Check direct portfolio subscription
    const directSubscription = await Subscription.findOne({
      user: user._id,
      productType: 'Portfolio',
      productId: portfolio._id,
      isActive: true
    });
    
    if (directSubscription) {
      return res.json(portfolio);
    }
    
    // Check bundle subscription
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


/**
 * Get tips with subscription-based access control
 * Public can see titles only, subscribers see full details
 */
exports.getTips = async (req, res) => {
  try {
    const { startDate, endDate, category, portfolioId, status, action, stockId } = req.query;
    const user = req.user;
    const query = {};
    
    // Apply filters
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
    
    // Additional filters
    if (portfolioId) query.portfolio = portfolioId;
    if (status) query.status = status;
    if (action) query.action = action;
    if (stockId) query.stockId = stockId;

    const tips = await Tip.find(query)
      .populate('portfolio', 'name')
      .sort('-createdAt');
    
    // Handle unauthenticated users - show only basic info
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
    
    // For authenticated users, check subscriptions
    
    // 1. Get direct portfolio subscriptions
    const portfolioSubscriptions = await Subscription.find({
      user: user._id,
      productType: 'Portfolio',
      isActive: true
    });
    const subscribedPortfolioIds = portfolioSubscriptions.map(sub => sub.productId.toString());
    
    // 2. Get bundle subscriptions 
    const bundleSubscriptions = await Subscription.find({
      user: user._id,
      productType: 'Bundle',
      isActive: true
    });
    
    // 3. Check for premium access
    let hasPremiumAccess = user.isAdmin || bundleSubscriptions.some(sub => 
      sub.bundle && sub.bundle.category === 'premium'
    );
    
    // 4. Get portfolios accessible through bundles
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
    
    // Combine all accessible portfolio IDs
    const accessiblePortfolioIds = [...new Set([...subscribedPortfolioIds, ...bundlePortfolioIds])];
    
    // Process tips based on access rules
    const processedTips = tips.map(tip => {
      const tipObj = tip.toObject();
      
      // Admin has full access
      if (user.isAdmin) return tipObj;
      
      // Portfolio-associated tips
      if (tip.portfolio) {
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
      }
      
      // Non-portfolio tips - premium vs basic
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
      
      // Basic tips can be accessed by all logged in users
      return tipObj;
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
    
    // For unauthenticated users - return limited info
    if (!user) {
      return res.json({
        _id: tip._id,
        title: tip.title,
        stockId: tip.stockId,
        category: tip.category,
        portfolio: tip.portfolio ? { _id: tip.portfolio._id, name: tip.portfolio.name } : null,
        createdAt: tip.createdAt,
        status: tip.status,
        action: tip.action,
        message: "Login and subscribe to view details"
      });
    }
    
    // Admin has full access
    if (user.isAdmin) {
      return res.json(tip);
    }
    
    // Check access based on whether it's a portfolio tip or regular tip
    if (tip.portfolio) {
      // Portfolio-specific tip - check subscription to that portfolio
      
      // 1. Direct portfolio subscription
      const directSubscription = await Subscription.findOne({
        user: user._id,
        productType: 'Portfolio',
        productId: tip.portfolio._id,
        isActive: true
      });
      
      if (directSubscription) {
        return res.json(tip);
      }
      
      // 2. Bundle subscription that includes this portfolio
      const bundleSubscriptions = await Subscription.find({
        user: user._id,
        productType: 'Bundle',
        isActive: true
      });
      
      if (bundleSubscriptions.length > 0) {
        const bundleIds = bundleSubscriptions.map(sub => sub.productId);
        const hasAccessThroughBundle = await Bundle.countDocuments({
          _id: { $in: bundleIds },
          portfolios: tip.portfolio._id
        });
        
        if (hasAccessThroughBundle > 0) {
          return res.json(tip);
        }
      }
      
      // No access to this portfolio tip
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
    } else {
      // General tip (not portfolio-specific)
      if (tip.category === 'premium') {
        // Check premium access
        const hasPremiumAccess = await Subscription.findOne({
          user: user._id,
          productType: 'Bundle',
          'bundle.category': 'premium',
          isActive: true
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
      
      // Either basic tip or user has premium access
      return res.json(tip);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



const subscription = require('../models/subscription');

// Updated getProfile with incomplete account check
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password -refreshToken -tokenVersion');
    
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Check if profile is complete
    const requiredFields = ['fullName', 'dateofBirth', 'phone'];
    const isComplete = requiredFields.every(field => user[field] && user[field] !== null);
  const hasActiveSubscription = await subscription.exists({
      user: user._id,
    });
  
//force compelte menas user must complete profile if they have an subcription and force them to compelte profile

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

// New update profile function
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const updates = req.body;
    
    // Remove fields that shouldn't be updated via this endpoint
    const restrictedFields = ['password', 'refreshToken', 'tokenVersion', 'provider', 'providerId', 'emailVerified', 'changedPasswordAt'];
    restrictedFields.forEach(field => delete updates[field]);

    // If username is being updated, check uniqueness
    if (updates.username) {
      const existingUser = await User.findOne({ 
        username: updates.username,
        _id: { $ne: userId }
      });
      if (existingUser) {
        return res.status(400).json({ error: 'Username already taken' });
      }
    }

    // If email is being updated, check uniqueness and reset verification
    if (updates.email) {
      const existingUser = await User.findOne({ 
        email: updates.email,
        _id: { $ne: userId }
      });
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }
      // Reset email verification if email is changed
      updates.emailVerified = false;
    }

    // Update user
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password -refreshToken -tokenVersion');

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if profile is complete after update
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
/**
 * Get user's payment history
 */
exports.getUserPaymentHistory = async (req, res) => {
  try {
    const payments = await PaymentHistory.find({ user: req.user._id })
      .populate('portfolio', 'name')
      .select('-signature') // Exclude sensitive data
      .sort('-createdAt');
    
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Get user's cart
 */
exports.getUserPaymentHistory = async (req, res) => {
  try {
    const payments = await PaymentHistory.find({ user: req.user._id })
      .populate('portfolio', 'name')
      .sort('-createdAt');
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Cart operations
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




