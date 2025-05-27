const Razorpay = require('razorpay');
const crypto = require('crypto');
const Subscription = require('../models/subscription');
const Portfolio = require('../models/modelPortFolio');
const Cart = require('../models/carts');
const PaymentHistory = require('../models/paymenthistory');
const bundle = require('../models/bundle');
const modelPortFolio = require('../models/modelPortFolio');


async function getRazorpayInstance() {
  const paymentConfig = await getPaymentConfig();
  if (!paymentConfig.key_id || !paymentConfig.key_secret) {
    throw new Error('Razorpay key_id or key_secret not configured');
  }
  return new Razorpay(paymentConfig);
}

// Helper: Calculate total amount for cart
async function calculateCartAmount(cart) {
  let total = 0;
  for (const item of cart.items) {
    const portfolio = await Portfolio.findById(item.portfolio);
    if (!portfolio) throw new Error('Portfolio not found');
    total += (portfolio.subscriptionFee || 0) * item.quantity;
  }
  return total;
}

// Create payment order for a single product
exports.createOrder = async (req, res) => {
  try {
    const razorpay = await getRazorpayInstance();
    const { productType, productId } = req.body;
    let product;
    if (productType === 'Portfolio') {
      product = await modelPortFolio.findById(productId);
    } else if(productType === "Bundle") {
      product = await bundle.findById(productId)

    }
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const amount = product.subscriptionFee;
    if (!amount) return res.status(400).json({ error: 'Invalid subscription fee' });

    const order = await razorpay.orders.create({
      amount: amount * 100, // INR to paise
      currency: 'INR',
      receipt: `order_${Date.now()}_${req.user._id}`,
      notes: {
        userId: req.user._id.toString(),
        productType,
        productId
      }
    });

    res.status(201).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency
    });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
};

// Checkout cart and create payment order for all items
exports.checkoutCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    const amount = await calculateCartAmount(cart);
    if (amount <= 0) return res.status(400).json({ error: 'Invalid cart amount' });

    const order = await razorpay.orders.create({
      amount: amount * 100,
      currency: 'INR',
      receipt: `cart_${Date.now()}_${req.user._id}`,
      notes: {
        userId: req.user._id.toString(),
        cartCheckout: true
      }
    });

    res.status(201).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency
    });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
};

// Verify payment (client-side)
exports.verifyPayment = async (req, res) => {
  try {
    const razorpay = await getRazorpayInstance(); // <-- ADD THIS LINE
    const { orderId, paymentId, signature } = req.body;
    const generatedSignature = crypto
      .createHmac('sha256', (await getRazorpayInstance()).key_secret) // Use the correct secret
      .update(orderId + '|' + paymentId)
      .digest('hex');

    if (generatedSignature !== signature) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Find order details from Razorpay
    const order = await razorpay.orders.fetch(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // If cart checkout, subscribe to all items in cart
    if (order.notes && order.notes.cartCheckout) {
      const cart = await Cart.findOne({ user: req.user._id });
      if (!cart) return res.status(404).json({ error: 'Cart not found' });

      for (const item of cart.items) {
        await Subscription.findOneAndUpdate(
          {
            user: req.user._id,
            productType: 'Portfolio',
            productId: item.portfolio
          },
          {
            $set: { isActive: true, lastPaidAt: new Date(), missedCycles: 0 }
          },
          { upsert: true, new: true }
        );
      }
      // Optionally clear cart after successful payment
      cart.items = [];
      await cart.save();
    } else {
      // Single product subscription
      await Subscription.findOneAndUpdate(
        {
          user: req.user._id,
          productType: order.notes.productType,
          productId: order.notes.productId
        },
        {
          $set: { isActive: true, lastPaidAt: new Date(), missedCycles: 0 }
        },
        { upsert: true, new: true }
      );
    }

    // Record payment history
    await PaymentHistory.create({
      user: req.user._id,
      orderId,
      paymentId,
      amount: order.amount,
      currency: order.currency,
      status: 'captured'
    });

    res.json({ success: true, message: 'Payment verified and subscription activated' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Razorpay webhook for reliable payment verification
exports.razorpayWebhook = async (req, res) => {
  try {
    const razorpay = await getRazorpayInstance(); // <-- ADD THIS LINE
    // Validate webhook signature
    const webhookSecret = (await getRazorpayInstance()).key_secret; // Or use your config getter
    const signature = req.headers['x-razorpay-signature'];
    const body = req.body;

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(req.rawBody)
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    // Handle payment captured event
    if (body.event === 'payment.captured') {
      const payment = body.payload.payment.entity;
      const orderId = payment.order_id;
      const order = await razorpay.orders.fetch(orderId);

      // If cart checkout, subscribe to all items in cart
      if (order.notes && order.notes.cartCheckout) {
        const userId = order.notes.userId;
        const cart = await Cart.findOne({ user: userId });
        if (cart) {
          for (const item of cart.items) {
            await Subscription.findOneAndUpdate(
              {
                user: userId,
                productType: 'Portfolio',
                productId: item.portfolio
              },
              {
                $set: { isActive: true, lastPaidAt: new Date(), missedCycles: 0 }
              },
              { upsert: true, new: true }
            );
          }
          cart.items = [];
          await cart.save();
        }
      } else {
        // Single product subscription
        await Subscription.findOneAndUpdate(
          {
            user: order.notes.userId,
            productType: order.notes.productType,
            productId: order.notes.productId
          },
          {
            $set: { isActive: true, lastPaidAt: new Date(), missedCycles: 0 }
          },
          { upsert: true, new: true }
        );
      }

      // Record payment history
      await PaymentHistory.create({
        user: order.notes.userId,
        orderId,
        paymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status
      });
    }

    res.status(200).json({ status: 'ok' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Get payment history
exports.getHistory = async (req, res) => {
  try {
    const payments = await PaymentHistory.find({ user: req.user._id })
      .sort('-createdAt');
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
