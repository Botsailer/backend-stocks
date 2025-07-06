// controllers/subscriptionController.js

const Razorpay = require("razorpay");
const crypto = require("crypto");
const Subscription = require("../models/subscription");
const Portfolio = require("../models/modelPortFolio");
const Cart = require("../models/carts");
const PaymentHistory = require("../models/paymenthistory");
const Bundle = require("../models/bundle");
const { getPaymentConfig } = require("../utils/configSettings");
const { config } = require("dotenv");

function generateShortReceipt(prefix, userId) {
  const timestamp = Date.now().toString().slice(-8);
  const userIdShort = userId.toString().slice(-8);
  return `${prefix}_${timestamp}_${userIdShort}`;
}

async function getRazorpayInstance() {
  try {
    const paymentConfig = await getPaymentConfig();
    
    if (!paymentConfig.key_id || !paymentConfig.key_secret) {
      throw new Error("Razorpay credentials not configured");
    }

    return new Razorpay({
      key_id: paymentConfig.key_id,
      key_secret: paymentConfig.key_secret,
    });
  } catch (error) {
    console.error("Error creating Razorpay instance:", error);
    throw error;
  }
}

async function calculateCartAmount(cart, planType = "monthly") {
  let total = 0;
  for (const item of cart.items) {
    const portfolio = await Portfolio.findById(item.portfolio);
    if (!portfolio) throw new Error("Portfolio not found");

    const plan = portfolio.subscriptionFee.find((fee) => fee.type === planType);
    if (!plan) {
      throw new Error(
        `${planType} plan not found for portfolio: ${portfolio.name}`
      );
    }

    total += plan.price * item.quantity;
  }
  return total;
}

// Check if user is already subscribed to a product
async function isUserSubscribed(userId, productType, productId) {
  const subscription = await Subscription.findOne({
    user: userId,
    productType,
    productId,
    isActive: true
  });
  
  return !!subscription;
}

// Create payment order for a single product
exports.createOrder = async (req, res) => {
  try {
    const { productType, productId, planType = "monthly" } = req.body;

    if (!productType || !productId) {
      return res.status(400).json({ error: "productType and productId are required" });
    }

    // Check if user is already subscribed
    if (await isUserSubscribed(req.user._id, productType, productId)) {
      return res.status(409).json({ 
        error: `You are already subscribed to this ${productType.toLowerCase()}`
      });
    }

    let product;
    let amount;

    if (productType === "Portfolio") {
      product = await Portfolio.findById(productId);
      if (!product) return res.status(404).json({ error: "Portfolio not found" });

      const subscriptionPlan = product.subscriptionFee.find(
        fee => fee.type === planType
      );
      if (!subscriptionPlan) {
        return res.status(400).json({ error: `No ${planType} plan available` });
      }
      amount = subscriptionPlan.price;
    } else if (productType === "Bundle") {
      product = await Bundle.findById(productId);
      if (!product) return res.status(404).json({ error: "Bundle not found" });

      switch (planType) {
        case "monthly": amount = product.monthlyPrice; break;
        case "quarterly": amount = product.quarterlyPrice; break;
        case "yearly": amount = product.yearlyPrice; break;
        default: return res.status(400).json({ error: "Invalid plan type" });
      }
    } else {
      return res.status(400).json({ error: "Invalid product type" });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid subscription fee" });
    }

    const razorpay = await getRazorpayInstance();
    const receipt = generateShortReceipt("ord", req.user._id);

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt,
      notes: {
        userId: req.user._id.toString(),
        productType,
        productId,
        planType,
      },
    });

    res.status(201).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      planType,
    });
  } catch (err) {
    console.error("Create order error:", err);
    
    if (err.error?.description) {
      return res.status(400).json({ error: err.error.description });
    }

    res.status(500).json({ error: err.message || "Failed to create order" });
  }
};

exports.checkoutCart = async (req, res) => {
  try {
    const { planType = "monthly" } = req.body;

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    // Check subscriptions for all cart items
    for (const item of cart.items) {
      if (await isUserSubscribed(req.user._id, "Portfolio", item.portfolio)) {
        return res.status(409).json({
          error: `You are already subscribed to portfolio: ${item.portfolio}`
        });
      }
    }

    const amount = await calculateCartAmount(cart, planType);
    if (amount <= 0) {
      return res.status(400).json({ error: "Invalid cart amount" });
    }

    const razorpay = await getRazorpayInstance();
    const receipt = generateShortReceipt("cart", req.user._id);

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt,
      notes: {
        userId: req.user._id.toString(),
        cartCheckout: true,
        planType,
      },
    });

    res.status(201).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      planType,
    });
  } catch (err) {
    console.error("Checkout cart error:", err);
    
    if (err.error?.description) {
      return res.status(400).json({ error: err.error.description });
    }

    res.status(500).json({ error: err.message || "Failed to checkout cart" });
  }
};


exports.verifyPayment = async (req, res) => {
  try {
    const { paymentId, orderId, signature } = req.body;
    if (!paymentId || !orderId || !signature) {
      return res.status(400).json({ error: "Missing required payment details" });
    }

    const { key_secret } = await getPaymentConfig();

    const expectedSignature = crypto
      .createHmac("sha256", key_secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    if (expectedSignature !== signature) {
      return res.status(400).json({ error: "Invalid payment signature" });
    }

    const razorpay = await getRazorpayInstance();
    const order = await razorpay.orders.fetch(orderId);
    const notes = order.notes || {};

    const { productType, productId, planType = "monthly" } = notes;

    if (!productType || !productId) {
      return res.status(400).json({ error: "Invalid order notes: missing product info" });
    }

    const subscriptionType = planType;

    let product = null;
    let portfolios = [];
    let amount = 0;

    if (productType === "Bundle") {
      const bundle = await Bundle.findById(productId).populate("portfolios");
      if (!bundle) return res.status(404).json({ error: "Bundle not found" });

      product = bundle;
      portfolios = bundle.portfolios || [];

      if (portfolios.length === 0) {
        return res.status(400).json({ error: "Bundle has no portfolios" });
      }

      switch (subscriptionType) {
        case "monthly":
          amount = bundle.monthlyPrice;
          break;
        case "quarterly":
          amount = bundle.quarterlyPrice;
          break;
        case "yearly":
          amount = bundle.yearlyPrice;
          break;
        default:
          return res.status(400).json({ error: "Invalid subscription type" });
      }
    } else if (productType === "Portfolio") {
      const portfolio = await Portfolio.findById(productId);
      if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });

      product = portfolio;
      portfolios = [portfolio];

      const plan = portfolio.subscriptionFee.find(f => f.type === subscriptionType);
      if (!plan) return res.status(400).json({ error: "Invalid plan type" });
      amount = plan.price;
    } else {
      return res.status(400).json({ error: "Invalid product type" });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: `Invalid price for ${subscriptionType} subscription` });
    }

    const userId = req.user.id;

    const paymentHistory = new PaymentHistory({
      user: userId,
      subscription: productId,
      portfolio: portfolios[0]._id,
      amount,
      razorpayPaymentId: paymentId,
      razorpayOrderId: orderId,
      razorpaySignature: signature,
      subscriptionType,
      status: "completed",
      paymentMethod: "razorpay"
    });

    await paymentHistory.save();

    const subscription = new Subscription({
      user: userId,
      productType,
      productId,
      portfolio: portfolios[0]._id,
      isActive: true,
      subscriptionType: subscriptionType === "yearly" ? "yearlyEmandate" : "regular",
      monthlyAmount: subscriptionType === "yearly" ? amount / 12 : amount,
      commitmentEndDate: subscriptionType === "yearly" ? calculateEndDate("yearly") : null,
    });

    await subscription.recordPayment(new Date());

    return res.json({
      success: true,
      message: "Payment verified and subscription activated successfully",
      subscription: {
        id: subscription._id,
        productType,
        productId,
        portfolioCount: portfolios.length,
        subscriptionType,
        amount,
        isActive: true
      }
    });
  } catch (error) {
    console.error("Verify payment error:", error);
    return res.status(500).json({ error: "Payment verification failed" });
  }
};


function calculateEndDate(subscriptionType) {
  const now = new Date();
  switch(subscriptionType) {
    case 'monthly':
      return new Date(now.setMonth(now.getMonth() + 1));
    case 'quarterly':
      return new Date(now.setMonth(now.getMonth() + 3));
    case 'yearly':
      return new Date(now.setFullYear(now.getFullYear() + 1));
    default:
      return new Date(now.setMonth(now.getMonth() + 1));
  }
}



exports.verifyEmandate = async (req, res) => {
  try {
    const { subscription_id, signature } = req.body;

    const { key_secret } = await getPaymentConfig();
    const expectedSignature = crypto
      .createHmac("sha256", key_secret)
      .update(subscription_id)
      .digest("hex");

    if (expectedSignature !== signature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    const razorpay = await getRazorpayInstance();
    const subscription = await razorpay.subscriptions.fetch(subscription_id);
    const customer = await razorpay.customers.fetch(subscription.customer_id);

    if (customer.email !== req.user.email) {
      return res.status(403).json({ error: "Unauthorized eMandate verification" });
    }

    if (subscription.status === "authenticated") {
      await Subscription.updateMany(
        { eMandateId: subscription.id },
        {
          isActive: true,
          lastPaidAt: new Date(),
        }
      );

      return res.json({
        success: true,
        message: "eMandate authenticated successfully",
      });
    }

    return res.json({
      success: false,
      message: "eMandate not authenticated yet",
    });
  } catch (error) {
    console.error("eMandate authentication error:", error);
    return res.status(500).json({ error: "eMandate authentication failed" });
  }
};


exports.razorpayWebhook = async (req, res) => {
  try {
    const paymentConfig = await getPaymentConfig();
    const signature = req.headers["x-razorpay-signature"];

    // Validate webhook signature
    const expectedSignature = crypto
      .createHmac("sha256", paymentConfig.RAZORPAY_KEY_ID)
      .update(req.rawBody)
      .digest("hex");

    if (signature !== expectedSignature) {
      return res.status(400).json({ error: "Invalid webhook signature" });
    }

    const event = req.body.event;
    const payment = req.body.payload?.payment?.entity;

    switch (event) {
      case "payment.captured":
        const orderId = payment.order_id;
        const razorpay = await getRazorpayInstance();
        const order = await razorpay.orders.fetch(orderId);

        if (order.notes?.cartCheckout) {
          const cart = await Cart.findOne({ user: order.notes.userId });
          if (cart) {
            for (const item of cart.items) {
              await Subscription.findOneAndUpdate(
                {
                  user: order.notes.userId,
                  productType: "Portfolio",
                  productId: item.portfolio,
                },
                {
                  isActive: true,
                  lastPaidAt: new Date(),
                  missedCycles: 0,
                },
                { upsert: true }
              );
            }
            cart.items = [];
            await cart.save();
          }
        } else {
          await Subscription.findOneAndUpdate(
            {
              user: order.notes.userId,
              productType: order.notes.productType,
              productId: order.notes.productId,
            },
            {
              isActive: true,
              lastPaidAt: new Date(),
              missedCycles: 0,
            },
            { upsert: true }
          );
        }

        await PaymentHistory.create({
          user: order.notes.userId,
          orderId,
          paymentId: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
        });
        break;

      // Handle other subscription events
      case "subscription.activated":
      case "subscription.charged":
      case "subscription.cancelled":
      case "subscription.completed":
      case "subscription.paused":
      case "subscription.resumed":
        console.log(`Handled ${event} event`);
        break;

      default:
        console.log(`Unhandled Razorpay event: ${event}`);
    }

    res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(400).json({ error: "Webhook processing failed" });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const payments = await PaymentHistory.find({ user: req.user._id })
      .sort("-createdAt")
      .lean();
    res.json(payments);
  } catch (err) {
    console.error("Get history error:", err);
    res.status(500).json({ error: "Failed to get payment history" });
  }
};

async function createSubscriptionPlan(amountInPaisa) {
  const razorpay = await getRazorpayInstance();

  // Check if plan already exists
  const existingPlans = await razorpay.plans.all();
  const existingPlan = existingPlans.items.find(
    plan => plan.item.amount === amountInPaisa &&
           plan.period === "monthly" &&
           plan.interval === 1
  );

  if (existingPlan) return existingPlan;

  return await razorpay.plans.create({
    period: "monthly",
    interval: 1,
    item: {
      name: "Yearly Subscription Plan",
      amount: amountInPaisa,
      currency: "INR",
      description: "Monthly billing for yearly subscription",
    },
    notes: {
      commitment: "yearly",
      total_months: "12",
    },
  });
}

exports.createEmandate = async (req, res) => {
  try {
    const { productType, productId } = req.body;

    if (!productType || !productId) {
      return res.status(400).json({ error: "productType and productId are required" });
    }

    // Check if user is already subscribed
    if (await isUserSubscribed(req.user._id, productType, productId)) {
      return res.status(409).json({ 
        error: `You are already subscribed to this ${productType.toLowerCase()}`
      });
    }

    let product;
    let yearlyAmount;

    if (productType === "Portfolio") {
      product = await Portfolio.findById(productId);
      if (!product) return res.status(404).json({ error: "Portfolio not found" });

      const yearlyPlan = product.subscriptionFee.find(fee => fee.type === "quarterly");
      if (!yearlyPlan) return res.status(400).json({ error: "No yearly plan available" });
      yearlyAmount = yearlyPlan.price;
    } else if (productType === "Bundle") {
      product = await Bundle.findById(productId);
      if (!product) return res.status(404).json({ error: "Bundle not found" });
      yearlyAmount = product.quarterlyPrice * 12;
    } else {
      return res.status(400).json({ error: "Invalid product type" });
    }

    if (!yearlyAmount || yearlyAmount <= 0) {
      return res.status(400).json({ error: "Invalid subscription fee" });
    }

    const monthlyAmount = yearlyAmount / 12;
    const razorpay = await getRazorpayInstance();

    // Find or create customer
    let customer;
    try {
      const existingCustomers = await razorpay.customers.all({ email: req.user.email });
      customer = existingCustomers.items?.[0] || await razorpay.customers.create({
        name: req.user.name,
        email: req.user.email,
        contact: req.user.phone || "",
      });
    } catch (error) {
      customer = await razorpay.customers.create({
        name: req.user.name,
        email: req.user.email,
        contact: req.user.phone || "",
      });
    }

    const plan = await createSubscriptionPlan(monthlyAmount * 100);
    const commitmentEndDate = new Date();
    commitmentEndDate.setFullYear(commitmentEndDate.getFullYear() + 1);

    const razorPaySubscription = await razorpay.subscriptions.create({
      plan_id: plan.id,
      customer_id: customer.id,
      quantity: 1,
      total_count: 12,
      start_at: Math.floor(Date.now() / 1000) + 300,
      expire_by: Math.floor(commitmentEndDate / 1000),
      notes: {
        subscription_type: "yearly_monthly_billing",
        commitment_period: "12_months",
      },
    });

    // Create subscription record
    if (productType === "Bundle") {
      const bundle = await Bundle.findById(productId).populate("portfolios");
      for (const portfolio of bundle.portfolios) {
        await Subscription.findOneAndUpdate(
          {
            user: req.user._id,
            productType: "Portfolio",
            productId: portfolio._id,
            portfolio: portfolio._id,
          },
          {
            subscriptionType: "yearlyEmandate",
            commitmentEndDate,
            monthlyAmount: monthlyAmount / bundle.portfolios.length,
            eMandateId: razorPaySubscription.id,
          },
          { upsert: true }
        );
      }
    } else {
      await Subscription.findOneAndUpdate(
        {
          user: req.user._id,
          productType,
          productId,
          portfolio: productId,
        },
        {
          subscriptionType: "yearlyEmandate",
          commitmentEndDate,
          monthlyAmount,
          eMandateId: razorPaySubscription.id,
        },
        { upsert: true }
      );
    }

    res.status(201).json({
      commitmentEndDate,
      setupUrl: razorPaySubscription.short_url,
      subscriptionId: razorPaySubscription.id,
      amount: monthlyAmount,
      customer_id: customer.id,
      currency: razorPaySubscription.currency,
      planType: "quarterly",
    });
  } catch (err) {
    console.error("Create eMandate error:", err);
    
    if (err.error?.description) {
      return res.status(400).json({ error: err.error.description });
    }

    res.status(500).json({ error: "Failed to create eMandate" });
  }
};


exports.cancelSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findOne({
      user: req.user._id,
      _id: req.params.subscriptionId,
    });

    if (!subscription) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    // Check if subscription can be cancelled
    if (subscription.subscriptionType === "yearlyEmandate") {
      const now = new Date();
      if (subscription.commitmentEndDate && now < subscription.commitmentEndDate) {
        return res.status(400).json({
          error: "Cannot cancel during yearly commitment period",
          commitmentEndDate: subscription.commitmentEndDate,
        });
      }

      // Cancel Razorpay subscription
      if (subscription.eMandateId) {
        try {
          const razorpay = await getRazorpayInstance();
          await razorpay.subscriptions.cancel(subscription.eMandateId, {
            cancel_at_cycle_end: false,
          });
        } catch (error) {
          console.error("Error cancelling Razorpay subscription:", error);
        }
      }
    }

    // Cancel all subscriptions with the same eMandateId
    await Subscription.updateMany(
      { 
        user: req.user._id,
        eMandateId: subscription.eMandateId 
      },
      { isActive: false }
    );

    res.json({
      success: true,
      message: "Subscription cancelled successfully",
    });
  } catch (err) {
    console.error("Cancel subscription error:", err);
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
};
