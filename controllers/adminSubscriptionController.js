/*
 * controllers/adminSubscriptionController.js
 * ------------------------------------------
 * Admin CRUD operations for subscription management
 * Includes listing, fetching, creating, updating, deleting subscriptions
 * with graceful error handling
 */
const Subscription = require('../models/subscription');

exports.listSubscriptions = async (req, res) => {
  try {
    // Remove the problematic paymentHistory populate
    const subs = await Subscription.find()
    .populate('user', '-password -refreshToken -tokenVersion -changedPasswordAt -providerId') 
      .populate('portfolio') // Populate all portfolio fields for complete data
      .sort({ createdAt: -1 });
    
    return res.status(200).json({
      count: subs.length,
      subscriptions: subs
    });
  } catch (err) {
    console.error('Admin listSubscriptions error:', err);
    return res.status(500).json({ 
      error: 'Unable to fetch subscriptions',
      details: err.message 
    });
  }
};

exports.getSubscription = async (req, res) => {
  const { id } = req.params;
  try {
    // Remove the problematic paymentHistory populate here as well
    const sub = await Subscription.findById(id)
      .populate('user') // Populate all user fields for admin visibility
      .populate('portfolio'); // Populate all portfolio fields for complete data
      
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    return res.status(200).json(sub);
  } catch (err) {
    console.error(`Admin getSubscription error for id ${id}:`, err);
    return res.status(500).json({ error: 'Failed to retrieve subscription' });
  }
};

exports.createSubscription = async (req, res) => {
  const { userId, portfolioId } = req.body;
  if (!userId || !portfolioId) {
    return res.status(400).json({ error: 'userId and portfolioId are required' });
  }
  try {
    const newSub = await Subscription.create({ user: userId, portfolio: portfolioId });
    return res.status(201).json(newSub);
  } catch (err) {
    console.error('Admin createSubscription error:', err);
    return res.status(500).json({ error: 'Unable to create subscription' });
  }
};

exports.updateSubscription = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  try {
    const updatedSub = await Subscription.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
    if (!updatedSub) return res.status(404).json({ error: 'Subscription not found' });
    return res.status(200).json(updatedSub);
  } catch (err) {
    console.error(`Admin updateSubscription error for id ${id}:`, err);
    return res.status(500).json({ error: 'Failed to update subscription' });
  }
};

exports.deleteSubscription = async (req, res) => {
  const { id } = req.params;
  try {
    const deleted = await Subscription.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: 'Subscription not found' });
    return res.status(200).json({ message: 'Subscription deleted' });
  } catch (err) {
    console.error(`Admin deleteSubscription error for id ${id}:`, err);
    return res.status(500).json({ error: 'Failed to delete subscription' });
  }
};