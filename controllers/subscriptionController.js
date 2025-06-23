const Razorpay = require('razorpay');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Subscription = require('../models/subscription');
const Portfolio = require('../models/modelPortFolio');
const Cart = require('../models/carts');
const PaymentHistory = require('../models/paymenthistory');
const Bundle = require('../models/bundle');
const { getPaymentConfig } = require('../utils/configSettings');

// Utility function to generate short receipts for Razorpay (max 40 chars)
function generateShortReceipt(prefix, userId) {
  const timestamp = Date.now().toString().slice(-8);
  const userIdShort = userId.toString().slice(-8);
  return `${prefix}_${timestamp}_${userIdShort}`;
}

async function getRazorpayInstance() {
  try {
    const paymentConfig = await getPaymentConfig();
    
    if (!paymentConfig.key_id || !paymentConfig.key_secret) {
      throw new Error('Razorpay key_id or key_secret not configured');
    }
    
    return new Razorpay({
      key_id: paymentConfig.key_id,
      key_secret: paymentConfig.key_secret
    });
  } catch (error) {
    console.error('Error creating Razorpay instance:', error);
    throw error;
  }
}

async function calculateCartAmount(cart) {
  let total = 0;
  
  for (const item of cart.items) {
    if (item.productType === 'Portfolio') {
      const portfolio = await Portfolio.findById(item.productId);
      if (!portfolio) throw new Error(`Portfolio not found: ${item.productId}`);
      
      const plan = portfolio.subscriptionFee.find(
        fee => fee.type === item.planType
      );
      
      if (!plan) {
        throw new Error(`No ${item.planType} plan found for portfolio: ${portfolio.name}`);
      }
      
      total += plan.price * item.quantity;
    } 
    else if (item.productType === 'Bundle') {
      const bundle = await Bundle.findById(item.productId).populate('portfolios');
      if (!bundle) throw new Error(`Bundle not found: ${item.productId}`);
      
      // Use virtual prices based on plan type
      switch (item.planType) {
        case 'monthly':
          total += bundle.monthlyPrice * item.quantity;
          break;
        case 'quarterly':
          total += bundle.quarterlyPrice * item.quantity;
          break;
        case 'yearly':
          total += bundle.yearlyPrice * item.quantity;
          break;
        default:
          throw new Error('Invalid plan type for bundle');
      }
    }
  }
  
  return total;
}

// Create payment order for a single product
exports.createOrder = async (req, res) => {
  try {
    const { productType, productId, planType = 'monthly' } = req.body;
    
    // Validate input
    if (!productType || !productId || !['Portfolio', 'Bundle'].includes(productType)) {
      return res.status(400).json({ error: 'Invalid product type or ID' });
    }

    let amount;
    let product;
    
    if (productType === 'Portfolio') {
      product = await Portfolio.findById(productId);
      if (!product) return res.status(404).json({ error: 'Portfolio not found' });
      
      const plan = product.subscriptionFee.find(fee => fee.type === planType);
      if (!plan) {
        return res.status(400).json({ error: `No ${planType} plan available` });
      }
      amount = plan.price;
    } else {
      product = await Bundle.findById(productId).populate('portfolios');
      if (!product) return res.status(404).json({ error: 'Bundle not found' });
      
      switch (planType) {
        case 'monthly': amount = product.monthlyPrice; break;
        case 'quarterly': amount = product.quarterlyPrice; break;
        case 'yearly': amount = product.yearlyPrice; break;
        default: return res.status(400).json({ error: 'Invalid plan type' });
      }
    }
     
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid subscription fee' });
    }

    // Create Razorpay instance
    const razorpay = await getRazorpayInstance();

    // Generate short receipt
    const receipt = generateShortReceipt('ord', req.user._id);
    
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: 'INR',
      receipt: receipt,
      notes: {
        userId: req.user._id.toString(),
        productType,
        productId,
        planType
      }
    });

    res.status(201).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      planType
    });
    
  } catch (err) {
    console.error('Create order error:', err);
    
    if (err.error?.description) {
      return res.status(400).json({ error: err.error.description });
    }
    
    res.status(500).json({ error: err.message || 'Failed to create order' });
  }
};

exports.checkoutCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id }).populate({
      path: 'items.productId',
      select: 'name subscriptionFee'
    });
    
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Calculate cart amount
    const amount = await calculateCartAmount(cart);
    if (amount <= 0) {
      return res.status(400).json({ error: 'Invalid cart amount' });
    }

    const razorpay = await getRazorpayInstance();
    const receipt = generateShortReceipt('cart', req.user._id);
    
    // Prepare cart items for order notes
    const cartItems = cart.items.map(item => ({
      productType: item.productType,
      productId: item.productId._id.toString(),
      planType: item.planType,
      quantity: item.quantity
    }));
    
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: 'INR',
      receipt: receipt,
      notes: {
        userId: req.user._id.toString(),
        cartCheckout: true,
        cartItems: JSON.stringify(cartItems)
      }
    });

    res.status(201).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency
    });
  } catch (err) {
    console.error('Checkout cart error:', err);
    
    if (err.error?.description) {
      return res.status(400).json({ error: err.error.description });
    }
    
    res.status(500).json({ error: err.message || 'Failed to checkout cart' });
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const razorpay = await getRazorpayInstance();
    const { orderId, paymentId, signature } = req.body;
    
    // Verify signature
    const generatedSignature = crypto
      .createHmac('sha256', (await getPaymentConfig()).key_secret)
      .update(orderId + '|' + paymentId)
      .digest('hex');

    if (generatedSignature !== signature) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Fetch order details
    const order = await razorpay.orders.fetch(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const userId = order.notes.userId;
    const subscriptions = [];
    const products = [];
    let paymentHistory;

    // Handle cart checkout
    if (order.notes.cartCheckout) {
      const cart = await Cart.findOne({ user: userId });
      if (!cart) {
        return res.status(404).json({ error: 'Cart not found' });
      }

      // Parse cart items from order notes
      const cartItems = JSON.parse(order.notes.cartItems || '[]');
      
      for (const item of cartItems) {
        if (item.productType === 'Bundle') {
          const bundle = await Bundle.findById(item.productId).populate('portfolios');
          if (!bundle) continue;
          
          // Create subscriptions for each portfolio in bundle
          for (const portfolio of bundle.portfolios) {
            const sub = await Subscription.create({
              user: userId,
              productType: 'Portfolio',
              productId: portfolio._id,
              bundle: bundle._id,
              portfolio: portfolio._id,
              planType: item.planType,
              isActive: true,
              lastPaidAt: new Date()
            });
            subscriptions.push(sub);
            products.push({
              productType: 'Portfolio',
              productId: portfolio._id,
              bundleId: bundle._id
            });
          }
        } else {
          // Portfolio subscription
          const sub = await Subscription.create({
            user: userId,
            productType: 'Portfolio',
            productId: item.productId,
            portfolio: item.productId,
            planType: item.planType,
            isActive: true,
            lastPaidAt: new Date()
          });
          subscriptions.push(sub);
          products.push({
            productType: 'Portfolio',
            productId: item.productId
          });
        }
      }

      // Clear cart
      cart.items = [];
      await cart.save();
    } 
    // Handle single product order
    else {
      const { productType, productId, planType = 'monthly' } = order.notes;
      
      if (productType === 'Bundle') {
        const bundle = await Bundle.findById(productId).populate('portfolios');
        if (!bundle) {
          return res.status(404).json({ error: 'Bundle not found' });
        }
        
        // Create subscriptions for each portfolio in bundle
        for (const portfolio of bundle.portfolios) {
          const sub = await Subscription.create({
            user: userId,
            productType: 'Portfolio',
            productId: portfolio._id,
            bundle: bundle._id,
            portfolio: portfolio._id,
            planType,
            isActive: true,
            lastPaidAt: new Date()
          });
          subscriptions.push(sub);
          products.push({
            productType: 'Portfolio',
            productId: portfolio._id,
            bundleId: bundle._id
          });
        }
      } else {
        // Portfolio subscription
        const sub = await Subscription.create({
          user: userId,
          productType: 'Portfolio',
          productId,
          portfolio: productId,
          planType,
          isActive: true,
          lastPaidAt: new Date()
        });
        subscriptions.push(sub);
        products.push({
          productType: 'Portfolio',
          productId
        });
      }
    }

    // Create payment history
    paymentHistory = await PaymentHistory.create({
      user: userId,
      orderId,
      paymentId,
      signature,
      amount: order.amount,
      currency: order.currency || 'INR',
      planType: order.notes.planType || 'monthly',
      products,
      status: 'VERIFIED'
    });

    res.json({ 
      success: true, 
      message: 'Payment verified and subscriptions activated',
      subscriptions,
      paymentHistory
    });
    
  } catch (err) {
    console.error('Verify payment error:', err);
    res.status(400).json({ error: err.message || 'Payment verification failed' });
  }
};

// Razorpay webhook for reliable payment verification
exports.razorpayWebhook = async (req, res) => {
  try {
    const razorpay = await getRazorpayInstance();
    const paymentConfig = await getPaymentConfig();
    
    // Validate webhook signature
    const signature = req.headers['x-razorpay-signature'];
    const expectedSignature = crypto
      .createHmac('sha256', paymentConfig.key_secret)
      .update(req.rawBody)
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const body = req.body;
    
    // Handle payment captured event
    if (body.event === 'payment.captured') {
      const payment = body.payload.payment.entity;
      const orderId = payment.order_id;
      const order = await razorpay.orders.fetch(orderId);
      const userId = order.notes.userId;
      const products = [];

      // Cart checkout
      if (order.notes.cartCheckout) {
        const cart = await Cart.findOne({ user: userId });
        if (!cart) return res.status(200).json({ status: 'Cart not found' });
        
        // Parse cart items from order notes
        const cartItems = JSON.parse(order.notes.cartItems || '[]');
        
        for (const item of cartItems) {
          if (item.productType === 'Bundle') {
            const bundle = await Bundle.findById(item.productId).populate('portfolios');
            if (!bundle) continue;
            
            for (const portfolio of bundle.portfolios) {
              await Subscription.create({
                user: userId,
                productType: 'Portfolio',
                productId: portfolio._id,
                bundle: bundle._id,
                portfolio: portfolio._id,
                planType: item.planType,
                isActive: true,
                lastPaidAt: new Date()
              });
              products.push({
                productType: 'Portfolio',
                productId: portfolio._id,
                bundleId: bundle._id
              });
            }
          } else {
            await Subscription.create({
              user: userId,
              productType: 'Portfolio',
              productId: item.productId,
              portfolio: item.productId,
              planType: item.planType,
              isActive: true,
              lastPaidAt: new Date()
            });
            products.push({
              productType: 'Portfolio',
              productId: item.productId
            });
          }
        }
        cart.items = [];
        await cart.save();
      } 
      // Single product
      else {
        const { productType, productId, planType = 'monthly' } = order.notes;
        
        if (productType === 'Bundle') {
          const bundle = await Bundle.findById(productId).populate('portfolios');
          if (!bundle) return res.status(200).json({ status: 'Bundle not found' });
          
          for (const portfolio of bundle.portfolios) {
            await Subscription.create({
              user: userId,
              productType: 'Portfolio',
              productId: portfolio._id,
              bundle: bundle._id,
              portfolio: portfolio._id,
              planType,
              isActive: true,
              lastPaidAt: new Date()
            });
            products.push({
              productType: 'Portfolio',
              productId: portfolio._id,
              bundleId: bundle._id
            });
          }
        } else {
          await Subscription.create({
            user: userId,
            productType: 'Portfolio',
            productId,
            portfolio: productId,
            planType,
            isActive: true,
            lastPaidAt: new Date()
          });
          products.push({
            productType: 'Portfolio',
            productId
          });
        }
      }

      // Record payment history
      await PaymentHistory.create({
        user: userId,
        orderId,
        paymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        planType: order.notes.planType || 'monthly',
        products,
        status: 'PAID'
      });
    }

    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(400).json({ error: err.message || 'Webhook processing failed' });
  }
};

// Get payment history
exports.getHistory = async (req, res) => {
  try {
    const payments = await PaymentHistory.find({ user: req.user._id })
      .populate({
        path: 'products.productId',
        select: 'name'
      })
      .sort('-createdAt');
      
    res.json(payments);
  } catch (err) {
    console.error('Get history error:', err);
    res.status(500).json({ error: err.message || 'Failed to get payment history' });
  }
};