const Razorpay = require('razorpay');
const crypto = require('crypto');
const Subscription = require('../models/subscription');
const PaymentHistory = require('../models/paymenthistory');
const Portfolio = require('../models/modelPortFolio');
const Bundle = require('../models/bundle');
const { getPaymentConfig } = require('../utils/configSettings');

let razorpayInstance = null;

async function initializeRazorpay() {
  try {
    const config = await getPaymentConfig();
    
    if (!config.key_id || !config.key_secret) {
      throw new Error('Razorpay configuration incomplete');
    }

    razorpayInstance = new Razorpay({
      key_id: config.key_id,
      key_secret: config.key_secret
    });

    return razorpayInstance;
  } catch (error) {
    console.error('Razorpay initialization failed:', error.message);
    throw error;
  }
}

const subscriptionController = {
  createOrder: async (req, res) => {
    try {
      const { productType, productId } = req.body;
      const userId = req.user.id;

      // Validate input
      if (!productType || !productId) {
        return res.status(400).json({
          error: 'Validation failed',
          details: 'Both productType and productId are required'
        });
      }

      // Resolve product model
      const productModels = {
        Portfolio: Portfolio,
        Bundle: Bundle
      };

      if (!productModels[productType]) {
        return res.status(400).json({
          error: 'Invalid product type',
          details: 'Allowed values: Portfolio, Bundle'
        });
      }

      // Fetch product details
      const product = await productModels[productType].findById(productId);
      if (!product) {
        return res.status(404).json({
          error: 'Product not found',
          details: `${productType} with ID ${productId} not found`
        });
      }

      // Handle free subscriptions
      const subscriptionAmount = productType === 'Bundle' ?
        product.subscription.amount :
        product.subscriptionFee;

      if (!subscriptionAmount || subscriptionAmount === 0) {
        let subscription = await Subscription.findOne({
          user: userId,
          productType,
          productId
        });

        if (!subscription) {
          subscription = await Subscription.create({
            user: userId,
            productType,
            productId
          });
        }

        await subscription.recordPayment(new Date());
        return res.status(200).json({
          success: true,
          message: 'Free subscription activated',
          subscription
        });
      }

      // Initialize Razorpay if needed
      if (!razorpayInstance) {
        try {
          await initializeRazorpay();
        } catch (error) {
          return res.status(503).json({
            error: 'Payment service unavailable',
            details: 'Payment gateway configuration error'
          });
        }
      }

      // Create Razorpay order
      const amountInPaise = Math.round(subscriptionAmount * 100);
      const order = await razorpayInstance.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: `sub_${userId.toString().slice(-8)}_${productId.toString().slice(-8)}_${Date.now().toString().slice(-10)}`
      });

      // Create/update subscription record
      let subscription = await Subscription.findOne({
        user: userId,
        productType,
        productId
      });

      if (!subscription) {
        subscription = await Subscription.create({
          user: userId,
          productType,
          productId
        });
      }

      // Record payment history
      await PaymentHistory.create({
        user: userId,
        productType,
        productId,
        subscription: subscription._id,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        status: 'CREATED'
      });

      res.status(201).json({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency
      });

    } catch (error) {
      console.error('Order creation error:', error);

      const response = {
        error: 'Payment processing failed',
        details: 'Failed to create payment order'
      };

      if (error.statusCode === 401) {
        response.details = 'Invalid payment gateway credentials';
        res.status(503);
      } else if (error.statusCode === 400) {
        response.details = 'Invalid payment parameters';
        res.status(400);
      } else {
        res.status(500);
      }

      res.json(response);
    }
  },

  verifyPayment: async (req, res) => {
    try {
      const { orderId, paymentId, signature } = req.body;
      const userId = req.user.id;

      // Validate input
      if (!orderId || !paymentId || !signature) {
        return res.status(400).json({
          error: 'Validation failed',
          details: 'orderId, paymentId, and signature are required'
        });
      }

      // Verify payment signature
      const config = await getPaymentConfig();
      const expectedSignature = crypto
        .createHmac('sha256', config.key_secret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      if (expectedSignature !== signature) {
        return res.status(400).json({
          error: 'Invalid signature',
          details: 'Payment verification failed'
        });
      }

      // Update payment history
      const paymentRecord = await PaymentHistory.findOneAndUpdate(
        { orderId },
        {
          paymentId,
          signature,
          status: 'VERIFIED',
          $unset: { error: 1 }
        },
        { new: true }
      );

      if (!paymentRecord) {
        return res.status(404).json({
          error: 'Order not found',
          details: 'Payment record does not exist'
        });
      }

      // Update subscription
      const subscription = await Subscription.findById(paymentRecord.subscription);
      if (!subscription) {
        return res.status(404).json({
          error: 'Subscription not found',
          details: 'Associated subscription does not exist'
        });
      }

      await subscription.recordPayment(new Date());

      res.status(200).json({
        success: true,
        message: 'Payment verified and subscription activated',
        subscription
      });

    } catch (error) {
      console.error('Payment verification error:', error);
      res.status(500).json({
        error: 'Payment verification failed',
        details: 'Internal server error during verification'
      });
    }
  },

  getHistory: async (req, res) => {
    try {
      const userId = req.user.id;
      const paymentHistory = await PaymentHistory.find({ user: userId })
        .sort('-createdAt')
        .populate({
          path: 'subscription',
          select: 'productType productId isActive'
        });

      res.status(200).json(paymentHistory);

    } catch (error) {
      console.error('History fetch error:', error);
      res.status(500).json({
        error: 'Failed to retrieve payment history',
        details: 'Database operation failed'
      });
    }
  }
};

module.exports = subscriptionController;
