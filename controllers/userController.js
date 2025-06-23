const mongoose = require('mongoose');
const User = require('../models/user');
const Portfolio = require('../models/modelPortFolio');
const Bundle = require('../models/bundle');
const Subscription = require('../models/subscription');
const Cart = require('../models/carts');
const PaymentHistory = require('../models/paymenthistory');
const Tip = require('../models/portfolioTips');

// Helper function for consistent error handling
const handleError = (res, err, status = 500) => {
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ error: err.message });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ error: 'Invalid ID format' });
  }
  res.status(status).json({ error: err.message });
};

// Helper to populate cart items
const populateCart = async (cart) => {
  return cart.populate([
    {
      path: 'items.productId',
      select: 'name description subscriptionFee monthlyPrice quarterlyPrice yearlyPrice',
      model: 'Portfolio'
    },
    {
      path: 'items.productId',
      select: 'name description monthlyPrice quarterlyPrice yearlyPrice',
      model: 'Bundle'
    }
  ]);
};

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
    handleError(res, err);
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
    handleError(res, err);
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
    handleError(res, err);
  }
};

/**
 * Get all user subscriptions
 */
exports.getUserSubscriptions = async (req, res) => {
  try {
    const subscriptions = await Subscription.find({ user: req.user._id })
      .populate({
        path: 'productId',
        select: 'name description',
        model: 'Portfolio'
      })
      .populate({
        path: 'bundle',
        select: 'name description',
        model: 'Bundle'
      })
      .sort('-createdAt');
    
    res.json(subscriptions);
  } catch (err) {
    handleError(res, err);
  }
};

/**
 * Get tips with subscription-based access control
 */
exports.getTips = async (req, res) => {
  try {
    const tips = await Tip.find().populate('portfolio', 'name').sort('-createdAt');
    let userSubscriptions = [];
    
    if (req.user) {
      const subscriptions = await Subscription.find({ 
        user: req.user._id,
        isActive: true 
      });
      
      // Get both portfolio and bundle subscriptions
      userSubscriptions = [
        ...subscriptions.map(sub => sub.portfolio?.toString()),
        ...subscriptions.flatMap(sub => 
          sub.bundle?.portfolios?.map(p => p.toString()) || []
        )
      ].filter(Boolean);
    }
    
    const processedTips = tips.map(tip => {
      const isSubscribed = req.user && tip.portfolio && 
        userSubscriptions.includes(tip.portfolio._id.toString());
      
      return isSubscribed ? 
        { ...tip.toObject(), isSubscribed: true } :
        {
          _id: tip._id,
          title: tip.title,
          portfolio: tip.portfolio ? { _id: tip.portfolio._id, name: tip.portfolio.name } : null,
          isSubscribed: false
        };
    });
    
    res.json(processedTips);
  } catch (err) {
    handleError(res, err);
  }
};

/**
 * Get user's payment history
 */
exports.getUserPaymentHistory = async (req, res) => {
  try {
    const payments = await PaymentHistory.find({ user: req.user._id })
      .populate('portfolio', 'name')
      .populate('bundle', 'name')
      .select('-signature')
      .sort('-createdAt');
    
    res.json(payments);
  } catch (err) {
    handleError(res, err);
  }
};

/**
 * Get user's cart
 */
exports.getCart = async (req, res) => {
  try {
    let userCart = await Cart.findOne({ user: req.user._id });
    
    if (!userCart) {
      userCart = new Cart({ user: req.user._id, items: [] });
      await userCart.save();
    }
    
    const populatedCart = await populateCart(userCart);
    res.json(populatedCart);
  } catch (err) {
    handleError(res, err);
  }
};

/**
 * Add product to cart
 */
exports.addToCart = async (req, res) => {
  try {
    const { productType, productId, planType = 'monthly', quantity = 1 } = req.body;
    
    // Validate input
    if (!['Portfolio', 'Bundle'].includes(productType)) {
      return res.status(400).json({ error: 'Invalid product type' });
    }
    
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }
    
    if (!['monthly', 'quarterly', 'yearly'].includes(planType)) {
      return res.status(400).json({ error: 'Invalid plan type' });
    }
    
    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ error: 'Quantity must be a positive integer' });
    }
    
    // Verify product exists
    const Model = productType === 'Portfolio' ? Portfolio : Bundle;
    const product = await Model.findById(productId);
    if (!product) {
      return res.status(404).json({ error: `${productType} not found` });
    }
    
    // Atomic operation to update cart
    const userCart = await Cart.findOneAndUpdate(
      { user: req.user._id },
      {
        $setOnInsert: { items: [] },
        $addToSet: {
          items: {
            $each: [{
              productType,
              productId,
              planType,
              quantity
            }]
          }
        }
      },
      {
        new: true,
        upsert: true,
        runValidators: true
      }
    );
    
    // For existing items, update quantity
    const existingItem = userCart.items.find(item => 
      item.productType === productType &&
      item.productId.equals(productId) &&
      item.planType === planType
    );
    
    if (existingItem) {
      existingItem.quantity += quantity;
      await userCart.save();
    }
    
    const populatedCart = await populateCart(userCart);
    res.status(200).json(populatedCart);
  } catch (err) {
    handleError(res, err, 400);
  }
};

/**
 * Remove item from cart
 */
exports.removeFromCart = async (req, res) => {
  try {
    const { itemId } = req.params;
    
    // Atomic operation to remove item
    const userCart = await Cart.findOneAndUpdate(
      { user: req.user._id },
      { $pull: { items: { _id: itemId } } },
      { new: true }
    );
    
    if (!userCart) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    
    const populatedCart = await populateCart(userCart);
    res.json(populatedCart);
  } catch (err) {
    handleError(res, err, 400);
  }
};

/**
 * Clear cart
 */
exports.clearCart = async (req, res) => {
  try {
    // Atomic operation to clear cart
    const userCart = await Cart.findOneAndUpdate(
      { user: req.user._id },
      { $set: { items: [] } },
      { new: true }
    );
    
    if (!userCart) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    
    const populatedCart = await populateCart(userCart);
    res.json({ message: 'Cart cleared successfully', cart: populatedCart });
  } catch (err) {
    handleError(res, err, 400);
  }
};