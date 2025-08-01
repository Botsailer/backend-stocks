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
const logger = async () => {
  const winston = require("winston");
  return winston.createLogger({
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
};

// Utility functions
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
    isActive: true,
    $or: [
      { subscriptionType: "yearlyEmandate" },
      { subscriptionType: "regular", expiryDate: { $gt: now } }
    ]
  });
};

const getProductInfo = async (productType, productId, planType) => {
  let product, amount;
  if (productType === "Portfolio") {
    product = await Portfolio.findById(productId);
    if (!product) throw new Error("Portfolio not found");
    const subscriptionPlan = product.subscriptionFee.find(fee => fee.type === planType);
    if (!subscriptionPlan) throw new Error(`No ${planType} plan available`);
    amount = subscriptionPlan.price;
  } else if (productType === "Bundle") {
    product = await Bundle.findById(productId);
    if (!product) throw new Error("Bundle not found");
    switch (planType) {
      case "monthly": amount = product.monthlyPrice; break;
      case "quarterly": amount = product.quarterlyPrice; break;
      case "yearly": amount = product.yearlyPrice; break;
      default: throw new Error("Invalid plan type");
    }
  } else {
    throw new Error("Invalid product type");
  }
  if (!amount || amount <= 0) throw new Error("Invalid subscription fee");
  return { product, amount };
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
      name: "Yearly Subscription Plan",
      amount: amountInPaisa,
      currency: "INR",
      description: "Monthly billing for yearly subscription",
    },
    notes: { commitment: "yearly", total_months: "12" },
  });
};

// Controller functions
exports.createOrder = async (req, res) => {
  try {
    const { productType, productId, planType = "monthly" } = req.body;
    if (!productType || !productId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (await isUserSubscribed(req.user._id, productType, productId)) {
      return res.status(409).json({ error: "Already subscribed to this product" });
    }

    const { amount } = await getProductInfo(productType, productId, planType);
    const razorpay = await getRazorpayInstance();
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: generateShortReceipt("ord", req.user._id),
      notes: { userId: req.user._id.toString(), productType, productId, planType },
    });

    res.status(201).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      planType,
    });
  } catch (err) {
    logger.error("Create order error", err);
    res.status(500).json({ error: err.message || "Order creation failed" });
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

exports.verifyPayment = async (req, res) => {
  try {
    const { paymentId, orderId, signature } = req.body;
    if (!paymentId || !orderId || !signature) {
      return res.status(400).json({ error: "Missing payment details" });
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
    const { productType, productId, planType = "monthly", cartCheckout } = notes;
    const userId = req.user._id;
    const amount = order.amount / 100;
    const expiryDate = calculateEndDate(planType);

    await PaymentHistory.create({
      user: userId,
      subscription: productId,
      amount,
      paymentId,
      orderId,
      signature,
      status: "VERIFIED",
    });

    if (cartCheckout) {
      const cart = await Cart.findOne({ user: userId });
      if (cart) {
        for (const item of cart.items) {
          await Subscription.findOneAndUpdate(
            { user: userId, productType: "Portfolio", productId: item.portfolio },
            {
              user: userId,
              productType: "Portfolio",
              productId: item.portfolio,
              portfolio: item.portfolio,
              isActive: true,
              subscriptionType: "regular",
              planType,
              expiryDate,
              lastPaidAt: new Date()
            },
            { upsert: true, new: true }
          );
        }
        await Cart.findOneAndUpdate({ user: userId }, { $set: { items: [] } });
      }
      return res.json({ success: true, message: "Cart payment verified" });
    }

    if (productType === "Bundle") {
      const bundle = await Bundle.findById(productId).populate("portfolios");
      if (!bundle?.portfolios?.length) {
        return res.status(400).json({ error: "Bundle has no portfolios" });
      }

      for (const portfolio of bundle.portfolios) {
        await Subscription.findOneAndUpdate(
          { user: userId, productType: "Portfolio", productId: portfolio._id },
          {
            user: userId,
            productType: "Portfolio",
            productId: portfolio._id,
            portfolio: portfolio._id,
            isActive: true,
            subscriptionType: "regular",
            planType,
            expiryDate,
            lastPaidAt: new Date()
          },
          { upsert: true, new: true }
        );
      }
      return res.json({ success: true, message: "Bundle payment verified" });
    } 
    
    if (productType === "Portfolio") {
      await Subscription.findOneAndUpdate(
        { user: userId, productType, productId },
        {
          user: userId,
          productType,
          productId,
          portfolio: productId,
          isActive: true,
          subscriptionType: "regular",
          planType,
          expiryDate,
          lastPaidAt: new Date()
        },
        { upsert: true, new: true }
      );
      return res.json({ success: true, message: "Payment verified" });
    }
    
    return res.status(400).json({ error: "Invalid product type" });
  } catch (error) {
    logger.error("Payment verification error", error);
    res.status(500).json({ error: "Payment verification failed" });
  }
};



exports.createEmandate = async (req, res) => {
  try {
    const { productType, productId } = req.body;
    const userId = req.user._id;
    if (!productType || !productId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Check existing subscriptions
    if (await isUserSubscribed(userId, productType, productId)) {
      return res.status(409).json({ error: "Already subscribed to this product" });
    }

    // Get product and pricing
    let product, yearlyAmount;
    if (productType === "Portfolio") {
      product = await Portfolio.findById(productId);
      if (!product) throw new Error("Portfolio not found");
      const yearlyPlan = product.subscriptionFee.find(fee => fee.type === "yearly");
      if (!yearlyPlan) throw new Error("No yearly plan available");
      yearlyAmount = yearlyPlan.price;
    } else if (productType === "Bundle") {
      product = await Bundle.findById(productId).populate("portfolios");
      if (!product) throw new Error("Bundle not found");
      if (!product.yearlyPrice) throw new Error("No yearly pricing available");
      yearlyAmount = product.yearlyPrice;
    } else {
      throw new Error("Invalid product type");
    }

    if (!yearlyAmount || yearlyAmount <= 0) throw new Error("Invalid subscription fee");
    const monthlyAmount = Math.round(yearlyAmount / 12);

    // Create Razorpay customer
    const razorpay = await getRazorpayInstance();
    const customer = await createOrFetchCustomer(razorpay, req.user);

    // Create or fetch subscription plan
    const plan = await createSubscriptionPlan(monthlyAmount * 100);

    // Calculate dates (FIX: Reduced start time to 60 seconds)
    const startDate = new Date();
    const commitmentEndDate = new Date();
    commitmentEndDate.setFullYear(startDate.getFullYear() + 1);

    // Create subscription data
    const subscriptionData = {
      plan_id: plan.id,
      customer_id: customer.id,
      quantity: 1,
      total_count: 12,
      start_at: Math.floor(Date.now() / 1000) + 60, // 60 seconds from now
      expire_by: Math.floor(commitmentEndDate.getTime() / 1000),
      notes: {
        subscription_type: "yearly_monthly_billing",
        commitment_period: "12_months",
        user_id: userId.toString(),
        product_type: productType,
        product_id: productId,
        created_at: new Date().toISOString()
      },
    };

    // Create Razorpay subscription
    const razorPaySubscription = await razorpay.subscriptions.create(subscriptionData);

    try {
      // Create database subscriptions
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
              subscriptionType: "yearlyEmandate",
              commitmentEndDate,
              monthlyAmount: monthlyPerPortfolio,
              eMandateId: razorPaySubscription.id,
              isActive: false,
              planType: "yearly",
              bundleId: productId,
              Category: product.category,
              status: "pending_authentication"
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
            subscriptionType: "yearlyEmandate",
            commitmentEndDate,
            monthlyAmount,
            eMandateId: razorPaySubscription.id,
            isActive: false,
            planType: "yearly",
            status: "pending_authentication"
          },
          { upsert: true, new: true }
        );
      }
    } catch (dbError) {
      // Cleanup on error
      try { await razorpay.subscriptions.cancel(razorPaySubscription.id); } 
      catch (cancelError) { logger.error("Failed to clean up subscription", cancelError); }
      throw dbError;
    }

    res.status(201).json({
      success: true,
      commitmentEndDate: commitmentEndDate.toISOString().split('T')[0],
      setupUrl: razorPaySubscription.short_url,
      subscriptionId: razorPaySubscription.id,
      amount: monthlyAmount,
      yearlyAmount,
      customerId: customer.id,
      currency: "INR",
      nextSteps: "Complete authentication via Razorpay",
      status: "pending_authentication"
    });
  } catch (err) {
    logger.error("eMandate creation failed", err);
    res.status(500).json({ error: err.message || "eMandate creation failed" });
  }
};

exports.verifyEmandate = async (req, res) => {
  try {
    const { subscription_id } = req.body;
    if (!subscription_id) return res.status(400).json({ error: "Subscription ID required" });

    const razorpay = await getRazorpayInstance();
    const userId = req.user._id;

    // Fetch subscription status with retry logic
    let razorpaySubscription;
    let status;
    let retryCount = 0;
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 2000; // 2 seconds
    
    do {
      try {
        razorpaySubscription = await razorpay.subscriptions.fetch(subscription_id);
        status = razorpaySubscription.status;
        
        if (status !== "pending" && status !== "created") break;
        
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        retryCount++;
      } catch (error) {
        logger.error("Razorpay fetch error", error);
        return res.status(500).json({ error: "Failed to verify subscription" });
      }
    } while (retryCount < MAX_RETRIES);

    // Verify user ownership
    if (!razorpaySubscription.notes?.user_id || 
        razorpaySubscription.notes.user_id !== userId.toString()) {
      return res.status(403).json({ error: "Unauthorized operation" });
    }

    // Get database subscriptions
    const existingSubscriptions = await Subscription.find({ 
      user: userId, 
      eMandateId: subscription_id 
    });
    
    if (!existingSubscriptions.length) {
      return res.status(404).json({ error: "No subscriptions found" });
    }

    // Handle different status cases
    let updateData = {};
    let shouldActivate = false;
    let responseMessage = "";
    let activationCount = 0;

    switch (status) {
      case "authenticated":
      case "active":
        updateData = { 
          isActive: true, 
          lastPaidAt: new Date(), 
          status: "active"
        };
        
        const updateResult = await Subscription.updateMany(
          { eMandateId: subscription_id, user: userId },
          updateData
        );
        
        activationCount = updateResult.modifiedCount;
        shouldActivate = true;
        responseMessage = `eMandate ${status === "authenticated" ? "authenticated" : "active"}. Activated ${activationCount} subscriptions.`;
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
          { eMandateId: subscription_id, user: userId },
          { isActive: false, status }
        );
        responseMessage = `Subscription ${status}.`;
        break;
        
      default:
        responseMessage = `Subscription in ${status} state.`;
    }

    // Update user premium status if needed
    if (shouldActivate && existingSubscriptions.some(sub => sub.Category === "premium")) {
      await User.findByIdAndUpdate(userId, { hasPremium: true });
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
    res.status(500).json({ error: "eMandate verification failed" });
  }
};

exports.razorpayWebhook = async (req, res) => {
  try {
    const { event, payload } = req.body;
    const razorpay = await getRazorpayInstance();

    if (event === "subscription.activated") {
      const subscriptionId = payload.subscription.id;
      const razorpaySubscription = await razorpay.subscriptions.fetch(subscriptionId);
      const userId = razorpaySubscription.notes?.user_id;
      
      if (!userId) return res.status(400).json({ error: "User ID missing" });

      await Subscription.updateMany(
        { eMandateId: subscriptionId, user: userId },
        { 
          isActive: true, 
          lastPaidAt: new Date(),
          status: "active"
        }
      );

      const subscriptions = await Subscription.find({ eMandateId: subscriptionId, user: userId });
      if (subscriptions.some(sub => sub.Category === "premium")) {
        await User.findByIdAndUpdate(userId, { hasPremium: true });
      }
    } 
    else if (event === "subscription.charged") {
      const { subscription_id, payment_id, amount } = payload;
      
      // Prevent duplicate processing
      const existingPayment = await PaymentHistory.findOne({ paymentId: payment_id });
      if (existingPayment) return res.status(200).end();
      
      const subscriptions = await Subscription.find({ eMandateId: subscription_id });
      
      if (subscriptions.length) {
        const userId = subscriptions[0].user;
        const paymentAmount = amount / 100 / subscriptions.length;
        
        await Promise.all(subscriptions.map(sub => 
          PaymentHistory.create({
            user: userId,
            subscription: sub._id,
            amount: paymentAmount,
            paymentId: payment_id,
            status: "completed"
          })
        ));
        
        await Subscription.updateMany(
          { eMandateId: subscription_id, user: userId },
          { lastPaidAt: new Date(), $inc: { paymentsCount: 1 } }
        );
      }
    }
    else if (event === "subscription.cancelled") {
      const subscriptionId = payload.subscription.id;
      await Subscription.updateMany(
        { eMandateId: subscriptionId },
        { isActive: false, status: "cancelled" }
      );
    }

    res.status(200).end();
  } catch (error) {
    logger.error("Webhook processing error", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
};  


exports.getUserSubscriptions = async (req, res) => {
  try {
    const subscriptions = await Subscription.find({ user: req.user._id })
      .populate('productId')
      .populate('portfolio')
      .sort({ createdAt: -1 });



    const groupedSubscriptions = {};
    const individualSubscriptions = [];

    subscriptions.forEach(sub => {
      if (sub.eMandateId && sub.subscriptionType === 'yearlyEmandate') {
        if (!groupedSubscriptions[sub.eMandateId]) {
          groupedSubscriptions[sub.eMandateId] = {
            eMandateId: sub.eMandateId,
            subscriptionType: sub.subscriptionType,
            isActive: sub.isActive,
            commitmentEndDate: sub.commitmentEndDate,
            monthlyAmount: 0,
            portfolios: [],
            bundleId: sub.bundleId,
            Category: sub.Category
          };
        }
        groupedSubscriptions[sub.eMandateId].monthlyAmount += sub.monthlyAmount || 0;
        groupedSubscriptions[sub.eMandateId].portfolios.push(sub);
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
    res.status(500).json({ error: "Failed to fetch subscriptions" });
  }
};

const checkSubscriptionExpiry = async (subscription) => {
  const now = new Date();
  
  // Regular subscriptions (one-time payments)
  if (subscription.subscriptionType === "regular") {
    if (subscription.expiryDate < now) {
      await Subscription.findByIdAndUpdate(subscription._id, { isActive: false });
      return true;
    }
    return false;
  }
  
  // eMandate subscriptions (yearly commitment)
  if (subscription.subscriptionType === "yearlyEmandate") {
    // Commitment period ended
    if (subscription.commitmentEndDate < now) {
      await Subscription.findByIdAndUpdate(subscription._id, { isActive: false });
      return true;
    }
    
    // Check payment status (if we have a Razorpay ID)
    if (subscription.eMandateId) {
      try {
        const razorpay = await getRazorpayInstance();
        const razorpaySub = await razorpay.subscriptions.fetch(subscription.eMandateId);
        
        if (["cancelled", "halted", "expired"].includes(razorpaySub.status)) {
          await Subscription.findByIdAndUpdate(subscription._id, { isActive: false });
          return true;
        }
      } catch (error) {
        logger.error("Razorpay status check failed", error);
      }
    }
  }
  
  return false;
};

exports.cancelSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findOne({
      user: req.user._id,
      _id: req.params.subscriptionId,
    });

    if (!subscription) return res.status(404).json({ error: "Subscription not found" });

    if (subscription.subscriptionType === "yearlyEmandate") {
      const now = new Date();
      if (subscription.commitmentEndDate && now < subscription.commitmentEndDate) {
        return res.status(400).json({ error: "Cannot cancel during commitment period" });
      }

      if (subscription.eMandateId) {
        try {
          const razorpay = await getRazorpayInstance();
          await razorpay.subscriptions.cancel(subscription.eMandateId, {
            cancel_at_cycle_end: false,
          });
        } catch (error) {
          logger.error("Razorpay cancellation error", error);
        }
      }
    }

    const updateResult = await Subscription.updateMany(
      {
        user: req.user._id,
        $or: [{ eMandateId: subscription.eMandateId }, { _id: subscription._id }]
      },
      { isActive: false }
    );

    if (subscription.Category === "premium") {
      const hasActivePremium = await Subscription.exists({
        user: req.user._id,
        Category: "premium",
        isActive: true
      });
      if (!hasActivePremium) await User.findByIdAndUpdate(req.user._id, { hasPremium: false });
    }

    res.json({
      success: true,
      message: "Subscription cancelled",
      cancelledSubscriptions: updateResult.modifiedCount
    });
  } catch (err) {
    logger.error("Cancel subscription error", err);
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
};

exports.cleanupOrphanedSubscriptions = async (req, res) => {
  try {
    const userId = req.user._id;
    const orphanedSubscriptions = await Subscription.find({
      user: userId,
      isActive: false,
      lastPaidAt: null,
      eMandateId: { $exists: false },
      createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    if (!orphanedSubscriptions.length) {
      return res.json({ success: true, message: "No orphaned subscriptions" });
    }
    
    const deleteResult = await Subscription.deleteMany({
      _id: { $in: orphanedSubscriptions.map(s => s._id) }
    });

    res.json({
      success: true,
      deletedCount: deleteResult.deletedCount,
      message: `Cleaned up ${deleteResult.deletedCount} subscriptions`
    });
  } catch (error) {
    logger.error("Cleanup error", error);
    res.status(500).json({ error: "Cleanup failed" });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const paymentHistory = await PaymentHistory.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .populate('subscription')
      .populate('user', 'fullName email');
    res.json({ success: true, paymentHistory });
  } catch (error) {
    logger.error("Payment history error", error);
    res.status(500).json({ error: "Failed to get history" });
  }
};

exports.razorpayWebhook = async (req, res) => {
  try {
    const { event, payload } = req.body;
    const razorpay = await getRazorpayInstance();

    if (event === "subscription.activated") {
      const subscriptionId = payload.subscription.id;
      const razorpaySubscription = await razorpay.subscriptions.fetch(subscriptionId);
      const userId = razorpaySubscription.notes?.user_id;
      
      if (!userId) return res.status(400).json({ error: "User ID missing" });

      await Subscription.updateMany(
        { eMandateId: subscriptionId, user: userId },
        { 
          isActive: true, 
          lastPaidAt: new Date(),
          missedCycles: 0 
        }
      );

      const subscriptions = await Subscription.find({ eMandateId: subscriptionId, user: userId });
      if (subscriptions.some(sub => sub.Category === "premium")) {
        await User.findByIdAndUpdate(userId, { hasPremium: true });
      }
    } 
    else if (event === "subscription.charged") {
      const { subscription_id, payment_id, amount } = payload;
      const subscriptions = await Subscription.find({ eMandateId: subscription_id });
      
      if (subscriptions.length) {
        const userId = subscriptions[0].user;
        const paymentAmount = amount / 100 / subscriptions.length;
        
        await Promise.all(subscriptions.map(sub => 
          PaymentHistory.create({
            user: userId,
            subscription: sub._id,
            amount: paymentAmount,
            paymentId: payment_id,
            status: "completed"
          })
        ));
        
        await Subscription.updateMany(
          { eMandateId: subscription_id, user: userId },
          { lastPaidAt: new Date(), $inc: { paymentsCount: 1 } }
        );
      }
    }
    else if (event === "subscription.cancelled") {
      const subscriptionId = payload.subscription.id;
      const subscriptions = await Subscription.find({ eMandateId: subscriptionId });
      
      if (subscriptions.length) {
        const userId = subscriptions[0].user;
        await Subscription.updateMany(
          { eMandateId: subscriptionId, user: userId },
          { isActive: false }
        );
      }
    }

    res.status(200).json({ success: true, message: "Webhook processed" });
  } catch (error) {
    logger.error("Webhook processing error", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
};