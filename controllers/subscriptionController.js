const Razorpay = require('razorpay');
const crypto = require('crypto');
const Subscription = require('../models/subscription');
const PaymentHistory = require('../models/paymenthistory');
const Portfolio = require('../models/Portfolio');
const { getPaymentConfig } = require('../utils/configManager');

// Initialize Razorpay with default empty values, will be populated before use
let razor = new Razorpay({
  key_id: '',
  key_secret: ''
});

// Function to initialize/update Razorpay instance with current config
async function initRazorpay() {
  const config = await getPaymentConfig();
  razor = new Razorpay({
    key_id: config.key_id,
    key_secret: config.key_secret
  });
}

// Initialize on module load
initRazorpay().catch(console.error);

exports.createOrder = async (req, res) => {
  try {
    // Ensure we have the latest payment config
    await initRazorpay();
    
    const userId = req.user.id;
    const { portfolioId } = req.body;

    if (!portfolioId) return res.status(400).json({ error: 'portfolioId is required' });

    const portfolio = await Portfolio.findById(portfolioId);
    if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });

    const amount = portfolio.subscriptionFee * 100; // Convert to paise
    const order = await razor.orders.create({
      amount,
      currency: 'INR',
      receipt: `sub_${userId}_${portfolioId}_${Date.now()}`,
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
    res.status(500).json({ error: 'Failed to create payment order' });
  }
};

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