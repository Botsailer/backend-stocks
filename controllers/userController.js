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
    // User is already available from JWT authentication
    const user = await User.findById(req.user._id)
      .select('-password -refreshToken -tokenVersion');
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Get all available portfolios (limited data)
 */
exports.getAllPortfolios = async (req, res) => {
  try {
    const portfolios = await Portfolio.find()
      .select('name description subscriptionFee minInvestment durationMonths createdAt')
      .sort('name');
    res.json(portfolios);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Get portfolio by id (limited data)
 */
exports.getPortfolioById = async (req, res) => {
  try {
    const portfolio = await Portfolio.findById(req.params.id)
      .select('name description subscriptionFee minInvestment durationMonths createdAt');
    
    if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });
    res.json(portfolio);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Get all user subscriptions with limited portfolio data
 */
exports.getUserSubscriptions = async (req, res) => {
  try {
    const subscriptions = await Subscription.find({ user: req.user._id })
      .populate('portfolio', 'name description subscriptionFee minInvestment durationMonths')
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
    // Get all tips with populated portfolio information upfront
    const tips = await Tip.find().populate('portfolio', 'name').sort('-createdAt');
    let userSubscriptions = [];
    
    // If user is authenticated, get their subscriptions
    if (req.user) {
      const subscriptions = await Subscription.find({ 
        user: req.user._id,
        isActive: true 
      });
      userSubscriptions = subscriptions.map(sub => sub.portfolio.toString());
    }
    
    // Process tips based on authentication and subscription status
    const processedTips = tips.map(tip => {
      // If user is not authenticated, or tip has a portfolio they're not subscribed to
      if (!req.user || (tip.portfolio && !userSubscriptions.includes(tip.portfolio._id.toString()))) {
        return {
          _id: tip._id,
          title: tip.title,
          portfolio: tip.portfolio ? { _id: tip.portfolio._id, name: tip.portfolio.name } : null,
          isSubscribed: false
        };
      }

      return {
        ...tip.toObject(),
        isSubscribed: true
      };
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
exports.getCart = async (req, res) => {
  try {
    let userCart = await Cart.findOne({ user: req.user._id })
      .populate('items.portfolio', 'name description subscriptionFee minInvestment durationMonths');
    
    // If cart doesn't exist yet, create an empty one
    if (!userCart) {
      userCart = new Cart({ user: req.user._id, items: [] });
      await userCart.save();
    }
    
    res.json(userCart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Add portfolio to cart
 */
exports.addToCart = async (req, res) => {
  try {
    const { portfolioId, quantity = 1 } = req.body;
    
    // Validate portfolio exists
    const portfolio = await Portfolio.findById(portfolioId);
    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }
    
    // Find user's cart or create one if it doesn't exist
    let userCart = await Cart.findOne({ user: req.user._id });
    if (!userCart) {
      userCart = new Cart({ user: req.user._id, items: [] });
    }
    
    // Check if item already in cart
    const existingItemIndex = userCart.items.findIndex(
      item => item.portfolio.toString() === portfolioId
    );
    
    if (existingItemIndex > -1) {
      // Update quantity if already in cart
      userCart.items[existingItemIndex].quantity += Number(quantity);
    } else {
      // Add new item to cart
      userCart.items.push({
        portfolio: portfolioId,
        quantity: Number(quantity)
      });
    }
    
    await userCart.save();
    
    // Return cart with populated portfolio details
    const updatedCart = await Cart.findOne({ user: req.user._id })
      .populate('items.portfolio', 'name description subscriptionFee minInvestment durationMonths');
      
    res.status(200).json(updatedCart);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * Remove item from cart
 */
exports.removeFromCart = async (req, res) => {
  try {
    const { portfolioId } = req.params;
    
    // Find user's cart
    const userCart = await Cart.findOne({ user: req.user._id });
    if (!userCart) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    
    // Filter out the item to remove
    userCart.items = userCart.items.filter(
      item => item.portfolio.toString() !== portfolioId
    );

    await userCart.save();

    // Return updated cart with populated portfolio details
    const updatedCart = await Cart.findOne({ user: req.user._id })
      .populate('items.portfolio', 'name description subscriptionFee minInvestment durationMonths');
    
    res.json(updatedCart);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * Clear cart
 */
exports.clearCart = async (req, res) => {
  try {
    const userCart = await Cart.findOne({ user: req.user._id });
    if (!userCart) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    userCart.items = [];
    await userCart.save();

    res.json({ message: 'Cart cleared successfully', cart: userCart });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};