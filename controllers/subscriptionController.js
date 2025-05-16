const Razorpay = require('razorpay');
const crypto = require('crypto');
const Subscription = require('../models/subscription');
const PaymentHistory = require('../models/paymenthistory');
const Portfolio = require('../models/modelPortFolio');
const { getPaymentConfig } = require('../utils/configSettings');

// Instead of initializing with empty values, declare a variable to hold the instance
let razor = null;

// Function to initialize/update Razorpay instance with current config
async function initRazorpay() {
  const config = await getPaymentConfig();
  
  // Make sure we have valid config values before creating instance
  if (!config.key_id || !config.key_secret) {
    throw new Error('Payment gateway configuration missing: key_id and key_secret are required');
  }
  
  razor = new Razorpay({
    key_id: config.key_id,
    key_secret: config.key_secret
  });
  
  return razor;
}
exports.createOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { portfolioId } = req.body;

    if (!portfolioId) return res.status(400).json({ error: 'portfolioId is required' });

    const portfolio = await Portfolio.findById(portfolioId);
    if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });

    // Handle free subscriptions directly
    if (!portfolio.subscriptionFee || portfolio.subscriptionFee === 0) {
      let sub = await Subscription.findOne({ user: userId, portfolio: portfolioId });
      if (!sub) {
        sub = await Subscription.create({ user: userId, portfolio: portfolioId });
      }
      
      // Directly activate the subscription
      await sub.recordPayment(new Date());
      
      return res.json({ 
        success: true, 
        message: 'Free subscription activated successfully',
        subscription: sub
      });
    }

    // Initialize Razorpay if not already initialized (for paid subscriptions)
    if (!razor) {
      try {
        await initRazorpay();
      } catch (configError) {
        console.error('Payment gateway configuration error:', configError.message);
        return res.status(503).json({ 
          error: 'Payment service temporarily unavailable',
          details: 'Our payment system is currently experiencing issues. Please try again later or contact support.'
        });
      }
    }
    
    // Ensure amount is a valid integer - round and convert to paise
    const amount = Math.round(portfolio.subscriptionFee * 100);
    
    const order = await razor.orders.create({
      amount,
      currency: 'INR',
     receipt: `s_${userId.toString().slice(-8)}_${portfolioId.toString().slice(-8)}_${Date.now().toString().slice(-10)}`,
  });

    let sub = await Subscription.findOne({ user: userId, portfolio: portfolioId });
    if (!sub) sub = await Subscription.create({ user: userId, portfolio: portfolioId });

    await PaymentHistory.create({
      user: userId,
      portfolio: portfolioId,
      subscription: sub._id,
      orderId: order.id,
      amount,
    });

    res.json({ orderId: order.id, amount, currency: order.currency });
  } catch (error) {
    console.error('Error creating order:', error);
    
    // Check for specific Razorpay API errors
    if (error.statusCode === 401) {
      return res.status(503).json({ 
        error: 'Payment authorization failed',
        details: 'Our payment system credentials are invalid or expired. Please contact support.'
      });
    } else if (error.statusCode === 400) {
      return res.status(400).json({
        error: 'Invalid payment parameters',
        details: 'The payment details provided were invalid. Please try again or contact support.'
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to create payment order',
      details: 'There was an issue processing your payment request. Please try again later.'
    });
  }
};
// The rest of your code remains the same
exports.verifyPayment = async (req, res) => {
  try {
    const { orderId, paymentId, signature } = req.body;
    const userId = req.user.id;

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ error: 'orderId, paymentId and signature are required' });
    }

    // Get the latest config for verification
    const config = await getPaymentConfig();
    
    const expected = crypto.createHmac('sha256', config.key_secret)
      .update(orderId + '|' + paymentId)
      .digest('hex');

    if (expected !== signature) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const history = await PaymentHistory.findOne({ orderId });
    if (!history) return res.status(404).json({ error: 'Order not found' });

    history.paymentId = paymentId;
    history.signature = signature;
    history.status = 'VERIFIED';
    await history.save();

    const sub = await Subscription.findById(history.subscription);
    await sub.recordPayment(new Date());

    res.json({ success: true, message: 'Payment verified and subscription activated' });
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const records = await PaymentHistory.find({ user: userId }).sort('-createdAt');
    res.json(records);
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
};