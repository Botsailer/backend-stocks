/*
 * controllers/adminSubscriptionController.js
 * ------------------------------------------
 * Admin CRUD operations for subscription management
 * Includes listing, fetching, creating, updating, deleting subscriptions
 * with graceful error handling and enhanced data for admin dashboard
 */
const Subscription = require('../models/subscription');
const Bundle = require('../models/bundle');
const PaymentHistory = require('../models/paymenthistory');

exports.listSubscriptions = async (req, res) => {
  try {
    const subs = await Subscription.find()
      .populate('user', 'fullName username email phone') 
      .populate('portfolio', 'portfolioName portfolioDescription PortfolioCategory')
      .populate('bundleId', 'name description category')
      .sort({ createdAt: -1 });
    
    // Enhanced subscription data for admin
    const enhancedSubscriptions = await Promise.all(subs.map(async (sub) => {
      let productName = 'Unknown Product';
      let bundleName = null;
      
      // Get product/bundle name
      if (sub.productType === 'Portfolio' && sub.portfolio) {
        productName = sub.portfolio.portfolioName || 'Portfolio';
      } else if (sub.productType === 'Bundle' && sub.bundleId) {
        productName = sub.bundleId.name || 'Bundle';
        bundleName = sub.bundleId.name;
      }
      
      // Get latest payment info
      let latestPayment = null;
      try {
        latestPayment = await PaymentHistory.findOne({ 
          subscription: sub._id 
        }).sort({ createdAt: -1 });
      } catch (paymentError) {
        console.warn('Could not fetch payment for subscription:', sub._id);
      }
      
      // Determine payment type
      let paymentType = 'Unknown';
      if (sub.type === 'recurring') {
        paymentType = 'Emandate';
      } else if (sub.type === 'one_time') {
        paymentType = 'OneTime';
      }
      
      // Calculate discount (if any)
      let discount = 0;
      let couponCode = null;
      if (sub.discountAmount) {
        discount = sub.discountAmount;
      }
      if (sub.couponCode) {
        couponCode = sub.couponCode;
      }
      
      return {
        _id: sub._id,
        // Product/Bundle Name
        productName,
        bundleName,
        productType: sub.productType,
        
        // User Name
        userName: sub.user ? (sub.user.fullName || sub.user.username || 'Unknown User') : 'Unknown User',
        userEmail: sub.user?.email || 'No email',
        userPhone: sub.user?.phone || 'No phone',
        
        // Payment Type (Emandate/OneTime)
        paymentType,
        
        // Amount
        amount: sub.amount || 0,
        
        // Expiry Date

        
        // Creation Date
        creationDate: sub.createdAt,
        
        // Discount & Coupon
        discount,
        couponCode,
        
        // Payment Status
        paymentStatus: sub.status,
        
        // Additional useful admin info
        planType: sub.planType || 'monthly',
        category: sub.category || 'basic',
        razorpaySubscriptionId: sub.razorpaySubscriptionId,
        lastPaymentAt: sub.lastPaymentAt,
        isRenewal: sub.isRenewal || false,
        compensationDays: sub.compensationDays || 0,
        
        // Latest payment details for invoice
        latestPayment: latestPayment ? {
          paymentId: latestPayment.paymentId,
          orderId: latestPayment.orderId,
          amount: latestPayment.amount,
          status: latestPayment.status,
          createdAt: latestPayment.createdAt
        } : null
      };
    }));
    
    return res.status(200).json({
      success: true,
      count: enhancedSubscriptions.length,
      subscriptions: enhancedSubscriptions
    });
  } catch (err) {
    console.error('Admin listSubscriptions error:', err);
    return res.status(500).json({ 
      success: false,
      error: 'Unable to fetch subscriptions',
      details: err.message 
    });
  }
};

exports.getSubscription = async (req, res) => {
  const { id } = req.params;
  try {
    const sub = await Subscription.findById(id)
      .populate('user', 'fullName username email phone address') 
      .populate('portfolio', 'portfolioName portfolioDescription PortfolioCategory')
      .populate('bundleId', 'name description category');
      
    if (!sub) return res.status(404).json({ 
      success: false, 
      error: 'Subscription not found' 
    });
    
    // Get payment history for this subscription
    let paymentHistory = [];
    try {
      paymentHistory = await PaymentHistory.find({ 
        subscription: sub._id 
      }).sort({ createdAt: -1 }).limit(10);
    } catch (paymentError) {
      console.warn('Could not fetch payment history for subscription:', sub._id);
    }
    
    // Enhanced subscription details
    let productName = 'Unknown Product';
    if (sub.productType === 'Portfolio' && sub.portfolio) {
      productName = sub.portfolio.portfolioName || 'Portfolio';
    } else if (sub.productType === 'Bundle' && sub.bundleId) {
      productName = sub.bundleId.name || 'Bundle';
    }
    
    const paymentType = sub.type === 'recurring' ? 'Emandate' : 'OneTime';
    
    const enhancedSubscription = {
      _id: sub._id,
      productName,
      productType: sub.productType,
      userName: sub.user ? (sub.user.fullName || sub.user.username || 'Unknown User') : 'Unknown User',
      userEmail: sub.user?.email || 'No email',
      userPhone: sub.user?.phone || 'No phone',
      userAddress: sub.user?.address || 'No address',
      paymentType,
      amount: sub.amount || 0,

      creationDate: sub.createdAt,
      discount: sub.discountAmount || 0,
      couponCode: sub.couponCode || null,
      paymentStatus: sub.status,
      planType: sub.planType || 'monthly',
      category: sub.category || 'basic',
      razorpaySubscriptionId: sub.razorpaySubscriptionId,
      lastPaymentAt: sub.lastPaymentAt,
      isRenewal: sub.isRenewal || false,
      compensationDays: sub.compensationDays || 0,
      paymentHistory,
      
      // Raw subscription data for admin reference
      rawSubscription: sub
    };
    
    return res.status(200).json({
      success: true,
      subscription: enhancedSubscription
    });
  } catch (err) {
    console.error(`Admin getSubscription error for id ${id}:`, err);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to retrieve subscription',
      details: err.message 
    });
  }
};

/**
 * Generate Invoice API for Admin
 * Generates and returns invoice data for a specific subscription
 */
exports.generateInvoice = async (req, res) => {
  const { id } = req.params;
  try {
    const sub = await Subscription.findById(id)
      .populate('user', 'fullName username email phone address')
      .populate('portfolio', 'portfolioName')
      .populate('bundleId', 'name');
    
    if (!sub) {
      return res.status(404).json({ 
        success: false, 
        error: 'Subscription not found' 
      });
    }
    
    // Get latest payment for this subscription
    const latestPayment = await PaymentHistory.findOne({ 
      subscription: sub._id 
    }).sort({ createdAt: -1 });
    
    // Generate invoice data
    const invoiceData = {
      invoiceNumber: `INV-${sub._id.toString().slice(-8)}-${Date.now().toString().slice(-6)}`,
      subscriptionId: sub._id,
      
      // Customer Details
      customerName: sub.user ? (sub.user.fullName || sub.user.username) : 'Unknown User',
      customerEmail: sub.user?.email || 'No email',
      customerPhone: sub.user?.phone || 'No phone',
      customerAddress: sub.user?.address || 'No address',
      
      // Product Details
      productName: sub.productType === 'Portfolio' 
        ? (sub.portfolio?.portfolioName || 'Portfolio')
        : (sub.bundleId?.name || 'Bundle'),
      productType: sub.productType,
      
      // Payment Details
      paymentType: sub.type === 'recurring' ? 'Emandate' : 'OneTime',
      amount: sub.amount || 0,
      discount: sub.discountAmount || 0,
      couponCode: sub.couponCode || null,
      finalAmount: (sub.amount || 0) - (sub.discountAmount || 0),
      
      // Dates
      subscriptionDate: sub.createdAt,

      paymentDate: latestPayment?.createdAt || sub.createdAt,
      
      // Payment Info
      paymentId: latestPayment?.paymentId || null,
      orderId: latestPayment?.orderId || null,
      paymentStatus: sub.status,
      
      // Additional Info
      planType: sub.planType || 'monthly',
      razorpaySubscriptionId: sub.razorpaySubscriptionId || null
    };
    
    return res.status(200).json({
      success: true,
      invoice: invoiceData
    });
    
  } catch (err) {
    console.error(`Admin generateInvoice error for id ${id}:`, err);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to generate invoice',
      details: err.message 
    });
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

/**
 * Process expired subscriptions immediately
 * This allows admins to force the system to check and kick expired users
 * from Telegram groups without waiting for the scheduled cron job
 */
exports.processExpiredSubscriptions = async (req, res) => {
  try {
    const subscriptionCronService = require('../services/subscriptioncron');
    const result = await subscriptionCronService.forceProcessExpiredSubscriptions();
    
    return res.status(200).json({ 
      message: 'Expired subscription processing triggered successfully',
      result
    });
  } catch (err) {
    console.error('Admin processExpiredSubscriptions error:', err);
    return res.status(500).json({ error: 'Failed to process expired subscriptions' });
  }
};