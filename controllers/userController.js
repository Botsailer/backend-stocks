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
    const portfolios = await Portfolio.find()
      .select('name description subscriptionFee minInvestment durationMonths createdAt CAGRSinceInception oneYearGains monthlyGains')
      .sort('name');
    res.json(portfolios);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get portfolio by ID (public) 
exports.getPortfolioById = async (req, res) => {
  try {
    const portfolio = await Portfolio.findById(req.params.id)
      .select('name description subscriptionFee minInvestment durationMonths createdAt CAGRSinceInception oneYearGains monthlyGains');
    if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });
    res.json(portfolio);
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
    const tips = await Tip.find().populate('portfolio', 'name').sort('-createdAt');
    let hasPremiumAccess = false;
    let portfolioAccess = [];

    // Check subscription status if authenticated
    if (req.user) {
      const subscriptions = await Subscription.find({ 
        user: req.user._id,
        isActive: true 
      });
      
      portfolioAccess = subscriptions
        .filter(sub => sub.productType === 'Portfolio')
        .map(sub => sub.productId.toString());
      
      hasPremiumAccess = subscriptions.some(sub => 
        sub.productType === 'Bundle' && sub.bundle?.category === 'premium'
      );
    }

    // Process tips based on access rules
    const processedTips = tips.map(tip => {
      // Portfolio-specific tips
      if (tip.portfolio) {
        const hasAccess = portfolioAccess.includes(tip.portfolio._id.toString());
        return hasAccess 
          ? tip.toObject() 
          : { _id: tip._id, title: tip.title, portfolio: tip.portfolio };
      }
      
      // Premium tips
      if (tip.category === 'premium') {
        return hasPremiumAccess 
          ? tip.toObject()
          : { _id: tip._id, title: tip.title, category: 'premium' };
      }
      
      // Basic tips
      if (tip.category === 'basic') {
        const hasBasicAccess = req.user && (portfolioAccess.length > 0 || hasPremiumAccess);
        return hasBasicAccess
          ? tip.toObject()
          : { _id: tip._id, title: tip.title, category: 'basic' };
      }
      
      // Unclassified tips (default to restricted)
      return { _id: tip._id, title: tip.title };
    });
    
    res.json(processedTips);
  } catch (err) {
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