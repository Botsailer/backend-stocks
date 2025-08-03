const Razorpay = require("razorpay");
const crypto = require("crypto");
const mongoose = require("mongoose");
const Subscription = require("../models/subscription");
const Portfolio = require("../models/modelPortFolio");
const Cart = require("../models/carts");
const PaymentHistory = require("../models/paymenthistory");
const Bundle = require("../models/bundle");
const User = require("../models/user");
const { getPaymentConfig } = require("../utils/configSettings");
const winston = require("winston");

// Logger configuration
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: "logs/subscription-service.log",
      maxsize: 5 * 1024 * 1024,
      maxFiles: 7
    })
  ]
});

// ===== UTILITY FUNCTIONS =====

const generateShortReceipt = (prefix, userId) => {
  const timestamp = Date.now().toString().slice(-8);
  const userIdShort = userId.toString().slice(-8);
  return `${prefix}_${timestamp}_${userIdShort}`;
};

const validateAndSanitizeName = (name) => {
  if (!name || typeof name !== 'string') return "User Account";
  let sanitizedName = name.trim().replace(/\s+/g, ' ').replace(/[^a-zA-Z\s\-'\.]/g, '');
  if (sanitizedName.length < 4) sanitizedName += " User";
  if (sanitizedName.length > 120) sanitizedName = sanitizedName.substring(0, 120).trim();
  sanitizedName = sanitizedName.replace(/^[\-'\.\s]+|[\-'\.\s]+$/g, '');
  return sanitizedName.length >= 4 ? sanitizedName : "User Account";
};

const validatePhoneNumber = (phone) => {
  if (!phone || typeof phone !== 'string') return "";
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]/.test(digits)) return digits;
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.substring(2))) 
    return digits.substring(2);
  if (digits.length === 13 && digits.startsWith('091')) return digits.substring(3);
  return "";
};

const getRazorpayInstance = async () => {
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
    logger.error("Error creating Razorpay instance", error);
    throw error;
  }
};

const calculateEndDate = (planType) => {
  const endDate = new Date();
  switch (planType) {
    case 'monthly': endDate.setMonth(endDate.getMonth() + 1); break;
    case 'quarterly': endDate.setMonth(endDate.getMonth() + 3); break;
    case 'yearly': endDate.setFullYear(endDate.getFullYear() + 1); break;
    default: endDate.setMonth(endDate.getMonth() + 1);
  }
  return endDate;
};

const isUserSubscribed = async (userId, productType, productId) => {
  const now = new Date();
  return !!await Subscription.findOne({
    user: userId,
    productType,
    productId,
    status: "active",
    expiresAt: { $gt: now }
  });
};

const getProductInfo = async (productType, productId, planType) => {
  let product, amount, category;
  
  if (productType === "Portfolio") {
    product = await Portfolio.findById(productId);
    if (!product) throw new Error("Portfolio not found");
    
    const subscriptionPlan = product.subscriptionFee.find(fee => fee.type === planType);
    if (!subscriptionPlan) throw new Error(`No ${planType} plan available`);
    
    amount = subscriptionPlan.price;
    category = product.PortfolioCategory?.toLowerCase() || 'basic';
  } else if (productType === "Bundle") {
    product = await Bundle.findById(productId).populate('portfolios');
    if (!product) throw new Error("Bundle not found");
    
    switch (planType) {
      case "monthly": amount = product.monthlyPrice; break;
      case "quarterly": amount = product.quarterlyPrice; break;
      case "yearly": amount = product.yearlyPrice; break;
      default: throw new Error("Invalid plan type");
    }
    
    category = product.category || 'basic';
  } else {
    throw new Error("Invalid product type");
  }
  
  if (!amount || amount <= 0) throw new Error("Invalid subscription fee");
  return { product, amount, category };
};

const createOrFetchCustomer = async (razorpay, user) => {
  try {
    const sanitizedName = validateAndSanitizeName(user.fullName || user.username || 'User');
    const validatedPhone = validatePhoneNumber(user.phone || user.mobile || '');
    
    try {
      const existingCustomers = await razorpay.customers.all({ email: user.email, count: 1 });
      if (existingCustomers.items?.length > 0) return existingCustomers.items[0];
    } catch (error) { /* Continue to create */ }

    const customerData = { name: sanitizedName, email: user.email };
    if (validatedPhone) customerData.contact = validatedPhone;
    return await razorpay.customers.create(customerData);
  } catch (error) {
    const simpleName = (user.fullName || user.username || 'User').replace(/[^a-zA-Z\s]/g, '').trim();
    const finalName = simpleName.length >= 4 ? simpleName : 'User Account';
    return await razorpay.customers.create({
      name: finalName,
      email: user.email,
      contact: validatePhoneNumber(user.phone || user.mobile || '') || undefined
    });
  }
};

const createSubscriptionPlan = async (amountInPaisa) => {
  const razorpay = await getRazorpayInstance();
  try {
    const existingPlans = await razorpay.plans.all({ count: 100 });
    const existingPlan = existingPlans.items.find(
      plan => plan.item.amount === amountInPaisa && plan.period === "monthly" && plan.interval === 1
    );
    if (existingPlan) return existingPlan;
  } catch (error) {
    logger.warn("Error fetching existing plans", error);
  }
  
  return razorpay.plans.create({
    period: "monthly",
    interval: 1,
    item: {
      name: "Subscription Plan",
      amount: amountInPaisa,
      currency: "INR",
      description: "Monthly billing for subscription",
    },
    notes: { commitment: "yearly", total_months: "12" },
  });
};

// Check and update user premium status
const updateUserPremiumStatus = async (userId) => {
  try {
    const now = new Date();
    
    // Check for any active premium subscription (case-insensitive)
    const hasPremiumSubscription = await Subscription.exists({
      user: userId,
      status: "active",
      category: { $regex: /^premium$/i },  // Case-insensitive match
      expiresAt: { $gt: now }
    });
    
    // Update user's premium status
    const updateResult = await User.findByIdAndUpdate(
      userId, 
      { hasPremium: !!hasPremiumSubscription },
      { new: true }
    );
    
    console.log(`Updated user ${userId} hasPremium to: ${!!hasPremiumSubscription}`);
    return !!hasPremiumSubscription;
  } catch (error) {
    console.error('Error updating premium status:', error);
    return false;
  }
};


// ===== CONTROLLER FUNCTIONS =====

// Create order for one-time payment
exports.createOrder = async (req, res) => {
  try {
    const { productType, productId, planType = "monthly" } = req.body;
    
    if (!productType || !productId) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields: productType and productId" 
      });
    }

    if (await isUserSubscribed(req.user._id, productType, productId)) {
      return res.status(409).json({ 
        success: false, 
        error: "Already subscribed to this product" 
      });
    }

    const { amount, category } = await getProductInfo(productType, productId, planType);
    const razorpay = await getRazorpayInstance();
    
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: generateShortReceipt("ord", req.user._id),
      notes: { 
        userId: req.user._id.toString(), 
        productType, 
        productId, 
        planType,
        category,
        paymentType: "one_time"
      },
    });

    res.status(201).json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      planType,
      category
    });
  } catch (err) {
    logger.error("Create order error", err);
    res.status(500).json({ 
      success: false, 
      error: err.message || "Order creation failed" 
    });
  }
};

// Create eMandate for recurring payments
exports.createEmandate = async (req, res) => {
  try {
    const { productType, productId } = req.body;
    const userId = req.user._id;
    
    if (!productType || !productId) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields: productType and productId" 
      });
    }

    if (await isUserSubscribed(userId, productType, productId)) {
      return res.status(409).json({ 
        success: false, 
        error: "Already subscribed to this product" 
      });
    }

    const { product, amount: yearlyAmount, category } = await getProductInfo(productType, productId, "yearly");
    const monthlyAmount = Math.round(yearlyAmount / 12);

    const razorpay = await getRazorpayInstance();
    const customer = await createOrFetchCustomer(razorpay, req.user);
    const plan = await createSubscriptionPlan(monthlyAmount * 100);

    const startDate = new Date();
    const commitmentEndDate = new Date();
    commitmentEndDate.setFullYear(startDate.getFullYear() + 1);

    const subscriptionData = {
      plan_id: plan.id,
      customer_id: customer.id,
      quantity: 1,
      total_count: 12,
      start_at: Math.floor(Date.now() / 1000) + 60,
      expire_by: Math.floor(commitmentEndDate.getTime() / 1000),
      notes: {
        subscription_type: "yearly_emandate",
        user_id: userId.toString(),
        product_type: productType,
        product_id: productId,
        category,
        created_at: new Date().toISOString()
      },
    };

    const razorPaySubscription = await razorpay.subscriptions.create(subscriptionData);

    try {
      if (productType === "Bundle" && product.portfolios?.length) {
        const monthlyPerPortfolio = Math.round(monthlyAmount / product.portfolios.length);
        
        for (const portfolio of product.portfolios) {
          await Subscription.findOneAndUpdate(
            { user: userId, productType: "Portfolio", productId: portfolio._id },
            {
              user: userId,
              productType: "Portfolio",
              productId: portfolio._id,
              portfolio: portfolio._id,
              type: "recurring",
              status: "pending",
              amount: monthlyPerPortfolio,
              category: portfolio.PortfolioCategory?.toLowerCase() || category,
              planType: "yearly",
              expiresAt: commitmentEndDate,
              razorpaySubscriptionId: razorPaySubscription.id,
              bundleId: productId
            },
            { upsert: true, new: true }
          );
        }
      } else {
        await Subscription.findOneAndUpdate(
          { user: userId, productType, productId },
          {
            user: userId,
            productType,
            productId,
            portfolio: productType === "Portfolio" ? productId : null,
            type: "recurring",
            status: "pending",
            amount: monthlyAmount,
            category,
            planType: "yearly",
            expiresAt: commitmentEndDate,
            razorpaySubscriptionId: razorPaySubscription.id
          },
          { upsert: true, new: true }
        );
      }
    } catch (dbError) {
      try { 
        await razorpay.subscriptions.cancel(razorPaySubscription.id); 
      } catch (cancelError) { 
        logger.error("Failed to cleanup subscription", cancelError); 
      }
      throw dbError;
    }

    res.status(201).json({
      success: true,
      subscriptionId: razorPaySubscription.id,
      setupUrl: razorPaySubscription.short_url,
      amount: monthlyAmount,
      yearlyAmount,
      category,
      commitmentEndDate: commitmentEndDate.toISOString().split('T')[0],
      status: "pending_authentication"
    });
  } catch (err) {
    logger.error("eMandate creation failed", err);
    res.status(500).json({ 
      success: false, 
      error: err.message || "eMandate creation failed" 
    });
  }
};

// Verify one-time payment
exports.verifyPayment = async (req, res) => {
  try {
    const { paymentId, orderId, signature } = req.body;
    
    if (!paymentId || !orderId || !signature) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing payment details" 
      });
    }

    // Verify signature
    const { key_secret } = await getPaymentConfig();
    const expectedSignature = crypto
      .createHmac("sha256", key_secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    if (expectedSignature !== signature) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid payment signature" 
      });
    }

    // Fetch order details
    const razorpay = await getRazorpayInstance();
    const order = await razorpay.orders.fetch(orderId);
    const notes = order.notes || {};
    const { productType, productId, planType = "monthly", category } = notes;
    const userId = req.user._id;
    const amount = order.amount / 100;
    const expiryDate = calculateEndDate(planType);

    // Create subscription and payment history
    if (productType === "Bundle") {
      const bundle = await Bundle.findById(productId).populate("portfolios");
      if (!bundle || !bundle.portfolios?.length) {
        return res.status(400).json({ 
          success: false, 
          error: "Bundle not found or has no portfolios" 
        });
      }

      const amountPerPortfolio = amount / bundle.portfolios.length;
      
      // Create subscriptions for each portfolio in bundle
      for (const portfolio of bundle.portfolios) {
        await Subscription.findOneAndUpdate(
          { user: userId, productType: "Portfolio", productId: portfolio._id },
          {
            user: userId,
            productType: "Portfolio",
            productId: portfolio._id,
            portfolio: portfolio._id,
            type: "one_time",
            status: "active",
            amount: amountPerPortfolio,
            category: portfolio.PortfolioCategory?.toLowerCase() || category,
            planType,
            expiresAt: expiryDate,
            paymentId,
            orderId,
            bundleId: productId,
            lastPaymentAt: new Date()
          },
          { upsert: true, new: true }
        );
        
        // Create payment history
        await PaymentHistory.create({
          user: userId,
          portfolio: portfolio._id,
          amount: amountPerPortfolio,
          paymentId,
          orderId,
          signature,
          status: "VERIFIED",
        });
      }
      
      await updateUserPremiumStatus(userId);
      
      return res.json({ 
        success: true, 
        message: "Bundle payment verified successfully",
        portfoliosActivated: bundle.portfolios.length,
        category
      });
    } 
    
    if (productType === "Portfolio") {
      // Create subscription
      const subscription = await Subscription.findOneAndUpdate(
        { user: userId, productType, productId },
        {
          user: userId,
          productType,
          productId,
          portfolio: productId,
          type: "one_time",
          status: "active",
          amount,
          category,
          planType,
          expiresAt: expiryDate,
          paymentId,
          orderId,
          lastPaymentAt: new Date()
        },
        { upsert: true, new: true }
      );

      // Create payment history
      await PaymentHistory.create({
        user: userId,
        portfolio: productId,
        amount,
        paymentId,
        orderId,
        signature,
        status: "VERIFIED",
      });

      await updateUserPremiumStatus(userId);

      return res.json({ 
        success: true, 
        message: "Portfolio payment verified successfully",
        subscriptionId: subscription._id,
        category
      });
    }
    
    return res.status(400).json({ 
      success: false, 
      error: "Invalid product type specified" 
    });

  } catch (error) {
    logger.error("Payment verification error", {
      error: error.message,
      stack: error.stack,
      orderId: req.body?.orderId,
      paymentId: req.body?.paymentId,
      userId: req.user?._id
    });
    
    res.status(500).json({ 
      success: false,
      error: "Payment verification failed"
    });
  }
};

// Verify eMandate
exports.verifyEmandate = async (req, res) => {
  try {
    const { subscription_id } = req.body;
    
    if (!subscription_id) {
      return res.status(400).json({ 
        success: false, 
        error: "Subscription ID required" 
      });
    }

    const razorpay = await getRazorpayInstance();
    const userId = req.user._id;

    // Fetch subscription status with retry logic
    let razorpaySubscription;
    let status;
    let retryCount = 0;
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 2000;
    
    do {
      try {
        razorpaySubscription = await razorpay.subscriptions.fetch(subscription_id);
        status = razorpaySubscription.status;
        
        if (status !== "pending" && status !== "created") break;
        
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        retryCount++;
      } catch (error) {
        logger.error("Razorpay fetch error", error);
        return res.status(500).json({ 
          success: false, 
          error: "Failed to verify subscription" 
        });
      }
    } while (retryCount < MAX_RETRIES);

    // Verify user ownership
    if (!razorpaySubscription.notes?.user_id || 
        razorpaySubscription.notes.user_id !== userId.toString()) {
      return res.status(403).json({ 
        success: false, 
        error: "Unauthorized operation" 
      });
    }

    // Get database subscriptions
    const existingSubscriptions = await Subscription.find({ 
      user: userId, 
      razorpaySubscriptionId: subscription_id 
    });
    
    if (!existingSubscriptions.length) {
      return res.status(404).json({ 
        success: false, 
        error: "No subscriptions found" 
      });
    }

    let updateData = {};
    let shouldActivate = false;
    let responseMessage = "";
    let activationCount = 0;

    switch (status) {
      case "authenticated":
      case "active":
        updateData = { 
          status: "active", 
          lastPaymentAt: new Date()
        };
        
        const updateResult = await Subscription.updateMany(
          { razorpaySubscriptionId: subscription_id, user: userId },
          updateData
        );
        
        activationCount = updateResult.modifiedCount;
        shouldActivate = true;
        responseMessage = `eMandate ${status}. Activated ${activationCount} subscriptions.`;
        break;
        
      case "created":
        responseMessage = "Subscription created. Awaiting authentication.";
        break;
        
      case "pending":
        responseMessage = "Authentication still pending. Please try again later.";
        break;
        
      case "halted":
      case "cancelled":
      case "expired":
        await Subscription.updateMany(
          { razorpaySubscriptionId: subscription_id, user: userId },
          { status: "cancelled" }
        );
        responseMessage = `Subscription ${status}.`;
        break;
        
      default:
        responseMessage = `Subscription in ${status} state.`;
    }

    // Update premium status
    if (shouldActivate) {
      await updateUserPremiumStatus(userId);
    }

    res.json({
      success: shouldActivate,
      message: responseMessage,
      subscriptionStatus: status,
      activatedSubscriptions: activationCount,
      requiresAction: status === "pending" || status === "created"
    });
  } catch (error) {
    logger.error("eMandate verification failed", error);
    res.status(500).json({ 
      success: false, 
      error: "eMandate verification failed" 
    });
  }
};

// Get user subscriptions
exports.getUserSubscriptions = async (req, res) => {
  try {
    const subscriptions = await Subscription.find({ 
      user: req.user._id,
      status: "active",
      expiresAt: { $gt: new Date() }
    })
      .populate('productId')
      .populate('portfolio')
      .sort({ createdAt: -1 });

    // Update user premium status
    await updateUserPremiumStatus(req.user._id);

    // Group eMandate subscriptions
    const groupedSubscriptions = {};
    const individualSubscriptions = [];

    subscriptions.forEach(sub => {
      if (sub.razorpaySubscriptionId && sub.type === 'recurring') {
        if (!groupedSubscriptions[sub.razorpaySubscriptionId]) {
          groupedSubscriptions[sub.razorpaySubscriptionId] = {
            razorpaySubscriptionId: sub.razorpaySubscriptionId,
            type: sub.type,
            status: sub.status,
            expiresAt: sub.expiresAt,
            totalAmount: 0,
            portfolios: [],
            bundleId: sub.bundleId,
            category: sub.category
          };
        }
        groupedSubscriptions[sub.razorpaySubscriptionId].totalAmount += sub.amount || 0;
        groupedSubscriptions[sub.razorpaySubscriptionId].portfolios.push(sub);
      } else {
        individualSubscriptions.push(sub);
      }
    });

    res.json({
      success: true,
      bundleSubscriptions: Object.values(groupedSubscriptions),
      individualSubscriptions,
      totalSubscriptions: subscriptions.length
    });
  } catch (error) {
    logger.error("Fetch subscriptions error", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch subscriptions" 
    });
  }
};

// Cancel subscription
exports.cancelSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findOne({
      user: req.user._id,
      _id: req.params.subscriptionId,
    });

    if (!subscription) {
      return res.status(404).json({ 
        success: false, 
        error: "Subscription not found" 
      });
    }

    // Handle eMandate cancellation
    if (subscription.type === "recurring" && subscription.razorpaySubscriptionId) {
      try {
        const razorpay = await getRazorpayInstance();
        await razorpay.subscriptions.cancel(subscription.razorpaySubscriptionId, {
          cancel_at_cycle_end: false,
        });
      } catch (error) {
        logger.error("Razorpay cancellation error", error);
      }
    }

    // Cancel all related subscriptions
    const updateResult = await Subscription.updateMany(
      {
        user: req.user._id,
        $or: [
          { razorpaySubscriptionId: subscription.razorpaySubscriptionId },
          { _id: subscription._id }
        ]
      },
      { status: "cancelled" }
    );

    // Update premium status
    await updateUserPremiumStatus(req.user._id);

    res.json({
      success: true,
      message: "Subscription cancelled successfully",
      cancelledSubscriptions: updateResult.modifiedCount
    });
  } catch (err) {
    logger.error("Cancel subscription error", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to cancel subscription" 
    });
  }
};

// Webhook handler (optional)
exports.razorpayWebhook = async (req, res) => {
  try {
    // Check if webhook secret is configured
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    
    if (webhookSecret) {
      // Verify webhook signature only if secret is provided
      const webhookSignature = req.headers['x-razorpay-signature'];
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      
      if (webhookSignature !== expectedSignature) {
        return res.status(400).json({ error: 'Invalid webhook signature' });
      }
    }

    const { event, payload } = req.body;

    switch (event) {
      case "subscription.activated":
        await handleSubscriptionActivated(payload);
        break;
      case "subscription.charged":
        await handleSubscriptionCharged(payload);
        break;
      case "subscription.halted":
      case "subscription.cancelled":
        await handleSubscriptionCancelled(payload);
        break;
      case "payment.failed":
        await handlePaymentFailed(payload);
        break;
    }

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Webhook processing error', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

// Webhook handlers
const handleSubscriptionActivated = async (payload) => {
  const subscriptionId = payload.subscription.id;
  const userId = payload.subscription.notes?.user_id;
  
  if (!userId) return;

  await Subscription.updateMany(
    { razorpaySubscriptionId: subscriptionId, user: userId },
    { status: "active", lastPaymentAt: new Date() }
  );

  await updateUserPremiumStatus(userId);
};

const handleSubscriptionCharged = async (payload) => {
  const { subscription_id, payment_id, amount } = payload;
  
  // Prevent duplicate processing
  const existingPayment = await PaymentHistory.findOne({ paymentId: payment_id });
  if (existingPayment) return;
  
  const subscriptions = await Subscription.find({ razorpaySubscriptionId: subscription_id });
  
  if (subscriptions.length) {
    const userId = subscriptions[0].user;
    const paymentAmount = amount / 100 / subscriptions.length;
    
    // Create payment history records
    await Promise.all(subscriptions.map(sub => 
      PaymentHistory.create({
        user: userId,
        subscription: sub._id,
        portfolio: sub.portfolio,
        amount: paymentAmount,
        paymentId: payment_id,
        status: "completed"
      })
    ));
    
    // Update last payment date
    await Subscription.updateMany(
      { razorpaySubscriptionId: subscription_id, user: userId },
      { lastPaymentAt: new Date() }
    );
  }
};


exports.checkoutCart = async (req, res) => {
  try {
    const { planType = "monthly" } = req.body;
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart?.items?.length) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    for (const item of cart.items) {
      if (await isUserSubscribed(req.user._id, "Portfolio", item.portfolio)) {
        return res.status(409).json({ error: `Already subscribed to portfolio: ${item.portfolio}` });
      }
    }

    let total = 0;
    for (const item of cart.items) {
      const portfolio = await Portfolio.findById(item.portfolio);
      if (!portfolio) throw new Error(`Portfolio ${item.portfolio} not found`);
      const plan = portfolio.subscriptionFee.find(fee => fee.type === planType);
      if (!plan) throw new Error(`${planType} plan not found`);
      total += plan.price * item.quantity;
    }

    if (total <= 0) return res.status(400).json({ error: "Invalid cart amount" });
    
    const razorpay = await getRazorpayInstance();
    const order = await razorpay.orders.create({
      amount: Math.round(total * 100),
      currency: "INR",
      receipt: generateShortReceipt("cart", req.user._id),
      notes: { userId: req.user._id.toString(), cartCheckout: true, planType },
    });

    res.status(201).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      planType,
    });
  } catch (err) {
    logger.error("Checkout cart error", err);
    res.status(500).json({ error: err.message || "Cart checkout failed" });
  }
};


const handleSubscriptionCancelled = async (payload) => {
  const subscriptionId = payload.subscription.id;
  const subscriptions = await Subscription.find({ razorpaySubscriptionId: subscriptionId });
  
  if (subscriptions.length) {
    const userId = subscriptions[0].user;
    await Subscription.updateMany(
      { razorpaySubscriptionId: subscriptionId, user: userId },
      { status: "cancelled" }
    );
    
    await updateUserPremiumStatus(userId);
  }
};

const handlePaymentFailed = async (payload) => {
  // Handle payment failure logic here
  logger.warn("Payment failed", payload);
};

// Get payment history
exports.getHistory = async (req, res) => {
  try {
    const paymentHistory = await PaymentHistory.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .populate('subscription')
      .populate('portfolio', 'name')
      .populate('user', 'fullName email');
      
    res.json({ 
      success: true, 
      paymentHistory 
    });
  } catch (error) {
    logger.error("Payment history error", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to get history" 
    });
  }
};

// Cleanup expired subscriptions (can be called via cron)
exports.cleanupExpiredSubscriptions = async (req, res) => {
  try {
    const now = new Date();
    
    // Mark expired subscriptions as expired
    const expiredResult = await Subscription.updateMany(
      {
        status: "active",
        type: "one_time",
        expiresAt: { $lt: now }
      },
      { status: "expired" }
    );

    // Update premium status for affected users
    const affectedUsers = await Subscription.distinct('user', {
      status: "expired",
      updatedAt: { $gte: new Date(now.getTime() - 60000) } // Last minute
    });

    for (const userId of affectedUsers) {
      await updateUserPremiumStatus(userId);
    }

    res.json({
      success: true,
      message: `Expired ${expiredResult.modifiedCount} subscriptions`,
      updatedUsers: affectedUsers.length
    });
  } catch (error) {
    logger.error("Cleanup error", error);
    res.status(500).json({ 
      success: false, 
      error: "Cleanup failed" 
    });
  }
};

module.exports = exports;
