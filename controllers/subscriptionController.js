const Razorpay = require("razorpay");
const crypto = require("crypto");
const mongoose = require("mongoose");
const cron = require("node-cron");

const Subscription = require("../models/subscription");
const Portfolio = require("../models/modelPortFolio");
const Cart = require("../models/carts");
const PaymentHistory = require("../models/paymenthistory");
const Bundle = require("../models/bundle");
const User = require("../models/user");
const { getPaymentConfig } = require("../utils/configSettings");
const { sendEmail } = require("../services/emailServices"); // Add your email service
const winston = require("winston");

// Logger setup
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
  if (!name || typeof name !== "string") return "User Account";
  let sanitized = name.trim().replace(/\s+/g, " ").replace(/[^a-zA-Z\s\-\.']/g, "");
  if (sanitized.length < 4) sanitized += " User";
  sanitized = sanitized.substring(0, 120).trim();
  sanitized = sanitized.replace(/^[-\.'s]+|[-\.'s]+$/g, "");
  return sanitized.length >= 4 ? sanitized : "User Account";
};

const validatePhoneNumber = (phone) => {
  if (!phone || typeof phone !== "string") return "";
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10 && /^[6-9]/.test(digits)) return digits;
  if (digits.length === 12 && digits.startsWith("91") && /^[6-9]/.test(digits.substring(2))) 
    return digits.substring(2);
  if (digits.length === 13 && digits.startsWith("091")) return digits.substring(3);
  return "";
};

const getRazorpayInstance = async () => {
  const config = await getPaymentConfig();
  if (!config.key_id || !config.key_secret) {
    throw new Error("Razorpay credentials not configured");
  }
  return new Razorpay({ key_id: config.key_id, key_secret: config.key_secret });
};

const calculateEndDate = (planType, startDate = new Date()) => {
  const endDate = new Date(startDate);
  switch(planType) {
    case "monthly": endDate.setMonth(endDate.getMonth() + 1); break;
    case "quarterly": endDate.setMonth(endDate.getMonth() + 3); break;
    case "yearly": endDate.setFullYear(endDate.getFullYear() + 1); break;
    default: endDate.setMonth(endDate.getMonth() + 1);
  }
  return endDate;
};

/**
 * ✨ ENHANCED: Check subscription status with renewal logic
 * Returns object with subscription details and renewal eligibility
 */
const checkSubscriptionStatus = async (userId, productType, productId) => {
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
  
  const existingSubscription = await Subscription.findOne({
    user: userId,
    productType: productType,
    productId: productId,
    status: "active",
    expiresAt: { $gt: now }
  });

  if (!existingSubscription) {
    return {
      hasActiveSubscription: false,
      canRenew: false,
      existingSubscription: null,
      message: "No active subscription found"
    };
  }

  // Check if subscription expires within 7 days (renewal window)
  const canRenew = existingSubscription.expiresAt <= sevenDaysFromNow;
  const daysUntilExpiry = Math.ceil((existingSubscription.expiresAt - now) / (24 * 60 * 60 * 1000));

  return {
    hasActiveSubscription: true,
    canRenew: canRenew,
    existingSubscription: existingSubscription,
    daysUntilExpiry: daysUntilExpiry,
    message: canRenew 
      ? `Can renew - expires in ${daysUntilExpiry} days`
      : `Active subscription expires in ${daysUntilExpiry} days. Renewal available 7 days before expiry.`
  };
};

/**
 * ✨ NEW: Calculate compensation for early renewal
 * Adds remaining days from old subscription to new subscription
 */
const calculateCompensatedEndDate = (planType, oldExpiryDate) => {
  const now = new Date();
  const newBaseEndDate = calculateEndDate(planType, now);
  
  // If old subscription hasn't expired yet, add remaining days
  if (oldExpiryDate > now) {
    const remainingDays = Math.ceil((oldExpiryDate - now) / (24 * 60 * 60 * 1000));
    const compensatedEndDate = new Date(newBaseEndDate.getTime() + (remainingDays * 24 * 60 * 60 * 1000));
    
    logger.info(`Compensation applied: ${remainingDays} days added to new subscription`);
    return {
      endDate: compensatedEndDate,
      compensationDays: remainingDays,
      baseEndDate: newBaseEndDate
    };
  }
  
  return {
    endDate: newBaseEndDate,
    compensationDays: 0,
    baseEndDate: newBaseEndDate
  };
};

const getProductInfo = async (productType, productId, planType) => {
  let product, amount, category;
  
  if (productType === "Portfolio") {
    product = await Portfolio.findById(productId);
    if (!product) throw new Error("Portfolio not found");
    const plan = product.subscriptionFee.find(p => p.type === planType);
    if (!plan) throw new Error(`Plan '${planType}' not available for portfolio`);
    amount = plan.price;
    category = product.PortfolioCategory ? product.PortfolioCategory.toLowerCase() : "basic";
  } else if (productType === "Bundle") {
    product = await Bundle.findById(productId).populate("portfolios");
    if (!product) throw new Error("Bundle not found");
    switch(planType) {
      case "monthly": amount = product.monthlyPrice; break;
      case "quarterly": amount = product.quarterlyPrice; break;
      case "yearly": amount = product.yearlyPrice; break;
      default: throw new Error("Invalid planType");
    }
    category = product.category ? product.category.toLowerCase() : "basic";
  } else {
    throw new Error("Invalid productType");
  }
  
  if (!amount || amount <= 0) throw new Error("Invalid amount");
  return { product, amount, category };
};

const createOrFetchCustomer = async (razorpay, user) => {
  try {
    const sanitizedName = validateAndSanitizeName(user.fullName || user.username || "User");
    const phone = validatePhoneNumber(user.phone || user.mobile || "");
    
    const existingCustomers = await razorpay.customers.all({ email: user.email, count: 1 });
    if (existingCustomers.items.length > 0) return existingCustomers.items[0];
    
    const customerData = { name: sanitizedName, email: user.email };
    if (phone) customerData.contact = phone;
    return await razorpay.customers.create(customerData);
  } catch (err) {
    const simpleName = (user.fullName || user.username || "User").replace(/[^a-zA-Z\s]/g, "").trim();
    const finalName = simpleName.length >= 4 ? simpleName : "User Account";
    return await razorpay.customers.create({
      name: finalName,
      email: user.email,
      contact: validatePhoneNumber(user.phone || user.mobile || "") || undefined
    });
  }
};

const createSubscriptionPlan = async (amountInPaisa) => {
  const razorpay = await getRazorpayInstance();
  try {
    const existingPlans = await razorpay.plans.all({ count: 100 });
    const found = existingPlans.items.find(p => 
      p.item.amount === amountInPaisa && p.period === "monthly" && p.interval === 1
    );
    if (found) return found;
  } catch(e) {
    logger.warn("Error fetching plans", e);
  }
  
  return await razorpay.plans.create({
    period: "monthly",
    interval: 1,
    item: {
      name: "Subscription Plan",
      amount: amountInPaisa,
      currency: "INR",
      description: "Monthly billing for yearly commitment",
    },
    notes: { commitment: "yearly", total_months: "12" }
  });
};

const updateUserPremiumStatus = async (userId) => {
  try {
    const now = new Date();
    const hasPremiumSubscription = await Subscription.exists({
      user: userId,
      status: "active",
      category: { $regex: /^premium$/i },
      expiresAt: { $gt: now }
    });
    
    await User.findByIdAndUpdate(userId, { hasPremium: !!hasPremiumSubscription });
    return !!hasPremiumSubscription;
  } catch (error) {
    logger.error('Error updating premium status:', error);
    return false;
  }
};

// ===== EMAIL FUNCTIONS =====

/**
 * ✨ NEW: Send subscription renewal reminder email
 */
const sendRenewalReminderEmail = async (user, subscription, portfolio) => {
  const daysUntilExpiry = Math.ceil((subscription.expiresAt - new Date()) / (24 * 60 * 60 * 1000));
  const renewalUrl = `${process.env.FRONTEND_URL}/renew-subscription/${subscription._id}`;
  
  const subject = `Subscription Renewal Reminder - ${portfolio.name}`;
  const text = `Your subscription to ${portfolio.name} expires in ${daysUntilExpiry} days. Renew now to continue your access.`;
  const html = `
    <div style="max-width:600px; margin:0 auto; padding:20px; font-family:sans-serif;">
      <h2 style="color:#4a77e5;">Subscription Renewal Reminder</h2>
      <p>Dear ${user.fullName || user.username},</p>
      <p>Your subscription to <strong>${portfolio.name}</strong> will expire in <strong>${daysUntilExpiry} days</strong>.</p>
      <p>Expiry Date: <strong>${subscription.expiresAt.toDateString()}</strong></p>
      
      <div style="margin:30px 0;">
        <a href="${renewalUrl}" style="background-color:#4a77e5; color:white; padding:12px 24px; text-decoration:none; border-radius:5px; display:inline-block;">Renew Subscription</a>
      </div>
      
      <div style="background-color:#f8f9fa; padding:15px; border-radius:5px; margin:20px 0;">
        <h3 style="color:#28a745; margin-top:0;">Renewal Benefits:</h3>
        <ul>
          <li>✅ Seamless continuation of your access</li>
          <li>✅ No service interruption</li>
          <li>✅ Early renewal compensation - remaining days will be added to your new subscription</li>
        </ul>
      </div>
      
      <p>You can renew your subscription up to 7 days before expiry. Any remaining days from your current subscription will be automatically added to your new subscription period.</p>
      
      <p>Or copy and paste this link in your browser:</p>
      <p style="word-break:break-all;">${renewalUrl}</p>
      
      <hr style="margin:30px 0; border:none; border-top:1px solid #eee;">
      <p style="color:#666; font-size:12px;">This is an automated reminder. If you have any questions, please contact our support team.</p>
    </div>
  `;
  
  try {
    await sendEmail(user.email, subject, text, html);
    logger.info(`Renewal reminder sent to ${user.email} for subscription ${subscription._id}`);
    return true;
  } catch (error) {
    logger.error(`Failed to send renewal reminder to ${user.email}:`, error);
    return false;
  }
};

/**
 * ✨ NEW: Send successful renewal confirmation email
 */
const sendRenewalConfirmationEmail = async (user, subscription, portfolio, compensationDays) => {
  const subject = `Subscription Renewed Successfully - ${portfolio.name}`;
  const text = `Your subscription to ${portfolio.name} has been renewed successfully.`;
  const html = `
    <div style="max-width:600px; margin:0 auto; padding:20px; font-family:sans-serif;">
      <h2 style="color:#28a745;">Subscription Renewed Successfully!</h2>
      <p>Dear ${user.fullName || user.username},</p>
      <p>Great news! Your subscription to <strong>${portfolio.name}</strong> has been renewed successfully.</p>
      
      <div style="background-color:#f8f9fa; padding:20px; border-radius:5px; margin:20px 0;">
        <h3 style="color:#4a77e5; margin-top:0;">Subscription Details:</h3>
        <p><strong>Portfolio:</strong> ${portfolio.name}</p>
        <p><strong>Plan Type:</strong> ${subscription.planType}</p>
        <p><strong>New Expiry Date:</strong> ${subscription.expiresAt.toDateString()}</p>
        <p><strong>Amount Paid:</strong> ₹${subscription.amount}</p>
        ${compensationDays > 0 ? `<p><strong>Bonus Days Added:</strong> ${compensationDays} days (from your previous subscription)</p>` : ''}
      </div>
      
      <div style="margin:30px 0;">
        <a href="${process.env.FRONTEND_URL}/dashboard" style="background-color:#28a745; color:white; padding:12px 24px; text-decoration:none; border-radius:5px; display:inline-block;">Access Dashboard</a>
      </div>
      
      <p>Thank you for continuing with us! You now have uninterrupted access to all features.</p>
      
      <hr style="margin:30px 0; border:none; border-top:1px solid #eee;">
      <p style="color:#666; font-size:12px;">This is an automated confirmation. If you have any questions, please contact our support team.</p>
    </div>
  `;
  
  try {
    await sendEmail(user.email, subject, text, html);
    logger.info(`Renewal confirmation sent to ${user.email} for subscription ${subscription._id}`);
    return true;
  } catch (error) {
    logger.error(`Failed to send renewal confirmation to ${user.email}:`, error);
    return false;
  }
};

// ===== CONTROLLER FUNCTIONS =====

/**
 * Create order for one-time payment
 * ✨ ENHANCED: Supports renewal with compensation logic
 */
exports.createOrder = async (req, res) => {
  const { productType, productId, planType = "monthly", isRenewal = false } = req.body;
  const userId = req.user._id;

  try {
    if (!productType || !productId) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields: productType and productId" 
      });
    }

    // ✨ ENHANCED: Check subscription status with renewal logic
    const subscriptionStatus = await checkSubscriptionStatus(userId, productType, productId);
    
    if (subscriptionStatus.hasActiveSubscription && !subscriptionStatus.canRenew) {
      return res.status(409).json({ 
        success: false, 
        error: subscriptionStatus.message,
        canRenewAfter: new Date(subscriptionStatus.existingSubscription.expiresAt.getTime() - (7 * 24 * 60 * 60 * 1000)),
        currentExpiry: subscriptionStatus.existingSubscription.expiresAt
      });
    }

    const { amount, category } = await getProductInfo(productType, productId, planType);
    const razorpay = await getRazorpayInstance();

    const receipt = generateShortReceipt("ord", userId);
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt,
      notes: {
        userId: userId.toString(),
        productType,
        productId: productId.toString(),
        planType,
        category,
        isRenewal: subscriptionStatus.canRenew.toString(),
        existingSubscriptionId: subscriptionStatus.existingSubscription?._id?.toString() || null
      }
    });

    const responseData = { 
      success: true, 
      orderId: order.id, 
      amount: order.amount, 
      currency: order.currency, 
      planType, 
      category 
    };

    // Add renewal information if applicable
    if (subscriptionStatus.canRenew) {
      responseData.isRenewal = true;
      responseData.compensationDays = Math.ceil((subscriptionStatus.existingSubscription.expiresAt - new Date()) / (24 * 60 * 60 * 1000));
      responseData.message = `Renewal order created. You will get ${responseData.compensationDays} bonus days added to your new subscription.`;
    }

    res.status(201).json(responseData);
  } catch (err) {
    logger.error("Error in createOrder", err);
    res.status(500).json({ success: false, error: err.message || "Order creation failed" });
  }
};

/**
 * Create eMandate for recurring payments
 * ✨ ENHANCED: Supports renewal with compensation logic
 */
exports.createEmandate = async (req, res) => {
  const { productType, productId } = req.body;
  const userId = req.user._id;
  
  try {
    if (!productType || !productId) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields: productType and productId" 
      });
    }

    // ✨ ENHANCED: Check subscription status with renewal logic
    const subscriptionStatus = await checkSubscriptionStatus(userId, productType, productId);
    
    if (subscriptionStatus.hasActiveSubscription && !subscriptionStatus.canRenew) {
      return res.status(409).json({ 
        success: false, 
        error: subscriptionStatus.message,
        canRenewAfter: new Date(subscriptionStatus.existingSubscription.expiresAt.getTime() - (7 * 24 * 60 * 60 * 1000)),
        currentExpiry: subscriptionStatus.existingSubscription.expiresAt
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

    // ✨ ENHANCED: Apply compensation if renewing
    if (subscriptionStatus.canRenew) {
      const compensation = calculateCompensatedEndDate("yearly", subscriptionStatus.existingSubscription.expiresAt);
      commitmentEndDate.setTime(compensation.endDate.getTime());
    }

    const subscriptionParams = {
      plan_id: plan.id,
      customer_id: customer.id,
      total_count: 12,
      quantity: 1,
      start_at: Math.floor(Date.now() / 1000) + 60,
      expire_by: Math.floor(commitmentEndDate.getTime() / 1000),
      notes: {
        user_id: userId.toString(),
        product_type: productType,
        product_id: productId.toString(),
        category,
        isRenewal: subscriptionStatus.canRenew.toString(),
        existingSubscriptionId: subscriptionStatus.existingSubscription?._id?.toString() || null
      }
    };

    const razorpaySubscription = await razorpay.subscriptions.create(subscriptionParams);
    
    // ✨ ENHANCED: Save to DB with compensation logic
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      if (productType === "Bundle") {
        for (const portfolio of product.portfolios) {
          await Subscription.findOneAndUpdate(
            { 
              user: userId, 
              productType: "Portfolio", 
              productId: portfolio._id, 
              type: "recurring" 
            },
            {
              user: userId,
              productType: "Portfolio",
              productId: portfolio._id,
              portfolio: portfolio._id,
              type: "recurring",
              status: "pending",
              amount: Math.round(monthlyAmount / product.portfolios.length),
              category: portfolio.PortfolioCategory ? portfolio.PortfolioCategory.toLowerCase() : category,
              planType: "yearly",
              expiresAt: commitmentEndDate,
              razorpaySubscriptionId: razorpaySubscription.id,
              bundleId: productId,
              isRenewal: subscriptionStatus.canRenew,
              previousSubscriptionId: subscriptionStatus.existingSubscription?._id || null
            },
            { upsert: true, new: true, session }
          );
        }
      } else {
        await Subscription.findOneAndUpdate(
          { 
            user: userId, 
            productType, 
            productId, 
            type: "recurring" 
          },
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
            razorpaySubscriptionId: razorpaySubscription.id,
            isRenewal: subscriptionStatus.canRenew,
            previousSubscriptionId: subscriptionStatus.existingSubscription?._id || null
          },
          { upsert: true, new: true, session }
        );
      }
    });
    await session.endSession();

    const responseData = { 
      success: true, 
      subscriptionId: razorpaySubscription.id, 
      setupUrl: razorpaySubscription.short_url,
      amount: monthlyAmount,
      yearlyAmount,
      category,
      status: "pending_authentication"
    };

    // Add renewal information if applicable
    if (subscriptionStatus.canRenew) {
      responseData.isRenewal = true;
      responseData.compensationDays = Math.ceil((subscriptionStatus.existingSubscription.expiresAt - new Date()) / (24 * 60 * 60 * 1000));
      responseData.message = `eMandate renewal created. You will get ${responseData.compensationDays} bonus days added to your new subscription.`;
    }

    res.status(201).json(responseData);
  } catch(err) {
    logger.error("Error in createEmandate", err);
    res.status(500).json({ success: false, error: err.message || "eMandate creation failed" });
  }
};

/**
 * Verify one-time payment
 * ✨ ENHANCED: Handles renewal with compensation logic
 */
exports.verifyPayment = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    const { paymentId, orderId, signature } = req.body;
    if (!paymentId || !orderId || !signature) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing payment details" 
      });
    }

    // Check for duplicate payment processing first
    const existingPayment = await PaymentHistory.findOne({ paymentId });
    if (existingPayment) {
      return res.status(409).json({ 
        success: false, 
        error: "Payment already processed" 
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
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        error: "Order not found" 
      });
    }

    const notes = order.notes || {};
    const { productType, productId, planType = "monthly", category, isRenewal, existingSubscriptionId } = notes;
    const userId = req.user._id;
    const amount = order.amount / 100;

    let expiryDate = calculateEndDate(planType);
    let compensationDays = 0;

    // ✨ ENHANCED: Apply compensation for renewal
    if (isRenewal === 'true' && existingSubscriptionId) {
      const existingSubscription = await Subscription.findById(existingSubscriptionId);
      if (existingSubscription && existingSubscription.expiresAt > new Date()) {
        const compensation = calculateCompensatedEndDate(planType, existingSubscription.expiresAt);
        expiryDate = compensation.endDate;
        compensationDays = compensation.compensationDays;
      }
    }

    // Process payment with atomic transaction
    let responseData = {};
    await session.withTransaction(async () => {
      if (productType === "Bundle") {
        const bundle = await Bundle.findById(productId).populate("portfolios");
        if (!bundle || !bundle.portfolios.length) {
          throw new Error("Bundle not found or has no portfolios");
        }

        const amountPerPortfolio = amount / bundle.portfolios.length;
        
        // If renewal, cancel existing subscriptions first
        if (isRenewal === 'true') {
          await Subscription.updateMany(
            {
              user: userId,
              productType: "Portfolio",
              productId: { $in: bundle.portfolios.map(p => p._id) },
              status: "active"
            },
            { status: "cancelled", cancelledAt: new Date(), cancelReason: "Renewed" },
            { session }
          );
        }

        // Create subscriptions for each portfolio in bundle
        for (let i = 0; i < bundle.portfolios.length; i++) {
          const portfolio = bundle.portfolios[i];
          
          await Subscription.findOneAndUpdate(
            { 
              user: userId, 
              productType: "Portfolio", 
              productId: portfolio._id, 
              type: "one_time" 
            },
            {
              user: userId,
              productType: "Portfolio",
              productId: portfolio._id,
              portfolio: portfolio._id,
              type: "one_time",
              status: "active",
              amount: amountPerPortfolio,
              category: portfolio.PortfolioCategory ? portfolio.PortfolioCategory.toLowerCase() : category,
              planType,
              expiresAt: expiryDate,
              paymentId,
              orderId,
              bundleId: productId,
              lastPaymentAt: new Date(),
              isRenewal: isRenewal === 'true',
              compensationDays: compensationDays,
              previousSubscriptionId: existingSubscriptionId || null
            },
            { upsert: true, new: true, session }
          );

          // Create unique payment history for each portfolio
          await PaymentHistory.create([{
            user: userId,
            subscription: null,
            portfolio: portfolio._id,
            amount: amountPerPortfolio,
            paymentId: `${paymentId}_portfolio_${i}`,
            orderId,
            signature,
            status: "VERIFIED",
            description: `Bundle payment - Portfolio ${i + 1}/${bundle.portfolios.length}${isRenewal === 'true' ? ' (Renewal)' : ''}`
          }], { session });
        }

        responseData = {
          success: true, 
          message: `Bundle payment verified successfully${isRenewal === 'true' ? ' (Renewal)' : ''}`,
          portfoliosActivated: bundle.portfolios.length,
          category,
          isRenewal: isRenewal === 'true',
          compensationDays: compensationDays,
          newExpiryDate: expiryDate
        };
        
      } else {
        // If renewal, cancel existing subscription first
        if (isRenewal === 'true' && existingSubscriptionId) {
          await Subscription.findByIdAndUpdate(
            existingSubscriptionId,
            { 
              status: "cancelled", 
              cancelledAt: new Date(), 
              cancelReason: "Renewed" 
            },
            { session }
          );
        }

        const newSubscription = await Subscription.findOneAndUpdate(
          { 
            user: userId, 
            productType, 
            productId, 
            type: "one_time" 
          },
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
            lastPaymentAt: new Date(),
            isRenewal: isRenewal === 'true',
            compensationDays: compensationDays,
            previousSubscriptionId: existingSubscriptionId || null
          },
          { upsert: true, new: true, session }
        );

        // Create payment history
        await PaymentHistory.create([{
          user: userId,
          subscription: newSubscription._id,
          portfolio: productId,
          amount,
          paymentId,
          orderId,
          signature,
          status: "VERIFIED",
          description: `Single portfolio payment${isRenewal === 'true' ? ' (Renewal)' : ''}`
        }], { session });

        responseData = {
          success: true, 
          message: `Portfolio payment verified successfully${isRenewal === 'true' ? ' (Renewal)' : ''}`,
          subscriptionId: newSubscription._id,
          category,
          isRenewal: isRenewal === 'true',
          compensationDays: compensationDays,
          newExpiryDate: expiryDate
        };

        // ✨ NEW: Send renewal confirmation email for single portfolio
        if (isRenewal === 'true') {
          try {
            const user = await User.findById(userId);
            const portfolio = await Portfolio.findById(productId);
            await sendRenewalConfirmationEmail(user, newSubscription, portfolio, compensationDays);
          } catch (emailError) {
            logger.error("Failed to send renewal confirmation email", emailError);
          }
        }
      }
    });

    await session.endSession();

    // Update premium status after successful payment
    await updateUserPremiumStatus(userId);

    res.json(responseData);

  } catch(error) {
    await session.endSession();
    
    logger.error("Error in verifyPayment", error);
    
    if (error.code === 11000) {
      return res.status(409).json({ 
        success: false, 
        error: "Subscription already exists. Payment may have been processed already." 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message || "Payment verification failed" 
    });
  }
};

/**
 * Verify eMandate subscription
 * ✨ ENHANCED: Handles renewal with compensation logic
 */
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
    const razorpaySubscription = await razorpay.subscriptions.fetch(subscription_id);
    const userId = req.user._id;
    
    // Verify user ownership
    if (!razorpaySubscription || !razorpaySubscription.notes || 
        razorpaySubscription.notes.user_id !== userId.toString()) {
      return res.status(403).json({ 
        success: false, 
        error: "Unauthorized access" 
      });
    }

    // Get database subscriptions
    const existingSubscriptions = await Subscription.find({ 
      razorpaySubscriptionId: subscription_id 
    });
    
    if (!existingSubscriptions.length) {
      return res.status(404).json({ 
        success: false, 
        error: "No subscriptions found for this ID" 
      });
    }

    const status = razorpaySubscription.status;
    const isRenewal = razorpaySubscription.notes.isRenewal === 'true';
    const existingSubscriptionId = razorpaySubscription.notes.existingSubscriptionId;
    
    let shouldActivate = false;
    let responseMessage = "";
    let activationCount = 0;

    // Handle different subscription statuses
    if (["authenticated", "active"].includes(status)) {
      const session = await mongoose.startSession();
      
      await session.withTransaction(async () => {
        // If renewal, cancel existing subscriptions first
        if (isRenewal && existingSubscriptionId) {
          await Subscription.findByIdAndUpdate(
            existingSubscriptionId,
            { 
              status: "cancelled", 
              cancelledAt: new Date(), 
              cancelReason: "Renewed via eMandate" 
            },
            { session }
          );
        }

        // Activate new subscriptions
        const updateResult = await Subscription.updateMany(
          { razorpaySubscriptionId: subscription_id, user: userId },
          { 
            status: "active", 
            lastPaymentAt: new Date() 
          },
          { session }
        );
        
        activationCount = updateResult.modifiedCount;
      });
      
      await session.endSession();
      
      shouldActivate = true;
      responseMessage = `eMandate ${status}. Activated ${activationCount} subscriptions.${isRenewal ? ' (Renewal)' : ''}`;
      
      // Update premium status
      await updateUserPremiumStatus(userId);

      // ✨ NEW: Send renewal confirmation emails
      if (isRenewal) {
        try {
          const user = await User.findById(userId);
          for (const subscription of existingSubscriptions) {
            const portfolio = await Portfolio.findById(subscription.portfolio);
            if (portfolio) {
              await sendRenewalConfirmationEmail(user, subscription, portfolio, subscription.compensationDays || 0);
            }
          }
        } catch (emailError) {
          logger.error("Failed to send renewal confirmation emails", emailError);
        }
      }
      
    } else if (["halted", "cancelled", "expired"].includes(status)) {
      await Subscription.updateMany(
        { razorpaySubscriptionId: subscription_id, user: userId },
        { status: "cancelled" }
      );
      responseMessage = `Subscription ${status}.`;
      
      // Update premium status
      await updateUserPremiumStatus(userId);
    } else {
      responseMessage = `Subscription in ${status} state.`;
    }

    res.json({
      success: shouldActivate,
      message: responseMessage,
      subscriptionStatus: status,
      activatedSubscriptions: activationCount,
      isRenewal: isRenewal,
      requiresAction: ["pending", "created"].includes(status)
    });

  } catch(error) {
    logger.error("Error in verifyEmandate", error);
    res.status(500).json({ 
      success: false, 
      error: error.message || "eMandate verification failed" 
    });
  }
};

/**
 * Get user subscriptions
 * ✨ ENHANCED: Shows renewal eligibility information
 */
exports.getUserSubscriptions = async (req, res) => {
  try {
    const subscriptions = await Subscription.find({ 
      user: req.user._id, 
      status: "active", 
      expiresAt: { $gt: new Date() } 
    })
    .populate("productId")
    .populate("portfolio")
    .sort({ createdAt: -1 });

    // Update premium status
    await updateUserPremiumStatus(req.user._id);

    // ✨ ENHANCED: Add renewal eligibility to each subscription
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
    
    const enhancedSubscriptions = subscriptions.map(sub => {
      const daysUntilExpiry = Math.ceil((sub.expiresAt - now) / (24 * 60 * 60 * 1000));
      const canRenew = sub.expiresAt <= sevenDaysFromNow;
      
      return {
        ...sub.toObject(),
        daysUntilExpiry,
        canRenew,
        renewalEligibleDate: sub.expiresAt.getTime() - (7 * 24 * 60 * 60 * 1000)
      };
    });

    // Group subscriptions by type
    const groupedSubscriptions = {};
    const individualSubscriptions = [];

    enhancedSubscriptions.forEach(sub => {
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
            category: sub.category,
            canRenew: sub.canRenew,
            daysUntilExpiry: sub.daysUntilExpiry
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
      totalSubscriptions: subscriptions.length,
      renewalInfo: {
        eligibleForRenewal: enhancedSubscriptions.filter(s => s.canRenew).length,
        totalActive: subscriptions.length
      }
    });
  } catch(error) {
    logger.error("Error in getUserSubscriptions", error);
    res.status(500).json({ 
      success: false, 
      error: error.message || "Failed to fetch subscriptions" 
    });
  }
};

// ===== REST OF THE CONTROLLER (UNCHANGED) =====
// [Include all other functions like cancelSubscription, razorpayWebhook, etc. - they remain the same]

/**
 * Cancel subscription
 */
exports.cancelSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findOne({ 
      _id: req.params.subscriptionId, 
      user: req.user._id 
    });
    
    if (!subscription) {
      return res.status(404).json({ 
        success: false, 
        error: "Subscription not found" 
      });
    }

    // Cancel recurring subscription in Razorpay
    if (subscription.type === "recurring" && subscription.razorpaySubscriptionId) {
      try {
        const razorpay = await getRazorpayInstance();
        await razorpay.subscriptions.cancel(subscription.razorpaySubscriptionId, { 
          cancel_at_cycle_end: false 
        });
      } catch(error) {
        logger.error("Razorpay cancellation error", error);
      }
    }

    // Cancel all related subscriptions
    const updateResult = await Subscription.updateMany(
      {
        user: req.user._id,
        $or: [
          { _id: subscription._id },
          { razorpaySubscriptionId: subscription.razorpaySubscriptionId }
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
  } catch(error) {
    logger.error("Error in cancelSubscription", error);
    res.status(500).json({ 
      success: false, 
      error: error.message || "Failed to cancel subscription" 
    });
  }
};

/**
 * Razorpay webhook handler
 */
exports.razorpayWebhook = async (req, res) => {
  try {
    // Verify webhook signature if secret is configured
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (webhookSecret) {
      const webhookSignature = req.headers["x-razorpay-signature"];
      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(req.rawBody || JSON.stringify(req.body))
        .digest("hex");
        
      if (webhookSignature !== expectedSignature) {
        logger.warn("Invalid webhook signature");
        return res.status(400).json({ error: "Invalid webhook signature" });
      }
    }

    const { event, payload } = req.body;

    switch(event) {
      case "subscription.activated":
      case "subscription.authenticated":
        await handleSubscriptionActivated(payload);
        break;
      case "subscription.charged":
        await handleSubscriptionCharged(payload);
        break;
      case "subscription.cancelled":
      case "subscription.halted":
        await handleSubscriptionCancelled(payload);
        break;
      case "payment.failed":
        await handlePaymentFailed(payload);
        break;
      default:
        logger.info(`Unhandled webhook event: ${event}`);
    }
    
    res.json({ success: true });
  } catch(error) {
    logger.error("Webhook processing error", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
};

// ===== WEBHOOK HANDLERS =====

async function handleSubscriptionActivated(payload) {
  const subscriptionId = payload.subscription.id;
  const userId = payload.subscription.notes?.user_id;
  
  if (!userId) return;

  await Subscription.updateMany(
    { razorpaySubscriptionId: subscriptionId, user: userId },
    { status: "active", lastPaymentAt: new Date() }
  );

  await updateUserPremiumStatus(userId);
  logger.info(`Subscription activated for user ${userId}`);
}

async function handleSubscriptionCharged(payload) {
  const subscriptionId = payload.subscription.id;
  const userId = payload.subscription.notes?.user_id;
  const paymentId = payload.payment?.entity?.id;
  
  if (!userId || !paymentId) return;

  // Check for duplicate payment
  const existingPayment = await PaymentHistory.findOne({ paymentId });
  if (existingPayment) return;

  const subscriptions = await Subscription.find({ razorpaySubscriptionId: subscriptionId });
  if (!subscriptions.length) return;

  const totalAmount = payload.payment?.entity?.amount || payload.amount || 0;
  const amountPerSubscription = totalAmount / 100 / subscriptions.length;

  const session = await mongoose.startSession();
  await session.withTransaction(async () => {
    // Create payment history for each subscription
    for (const subscription of subscriptions) {
      await PaymentHistory.create([{
        user: userId,
        subscription: subscription._id,
        portfolio: subscription.portfolio,
        amount: amountPerSubscription,
        paymentId,
        status: "completed",
        description: "Recurring payment via webhook"
      }], { session });
    }

    // Update last payment date
    await Subscription.updateMany(
      { razorpaySubscriptionId: subscriptionId, user: userId },
      { lastPaymentAt: new Date() },
      { session }
    );
  });
  
  await session.endSession();
  logger.info(`Subscription charged for user ${userId}`);
}

async function handleSubscriptionCancelled(payload) {
  const subscriptionId = payload.subscription.id;
  const userId = payload.subscription.notes?.user_id;
  
  if (!userId) return;

  await Subscription.updateMany(
    { razorpaySubscriptionId: subscriptionId, user: userId },
    { status: "cancelled" }
  );

  await updateUserPremiumStatus(userId);
  logger.info(`Subscription cancelled for user ${userId}`);
}

async function handlePaymentFailed(payload) {
  logger.warn("Payment failed webhook received", payload);
}

// ===== ADDITIONAL FUNCTIONS =====

/**
 * Cart checkout
 */
exports.checkoutCart = async (req, res) => {
  try {
    const { planType = "monthly" } = req.body;
    const cart = await Cart.findOne({ user: req.user._id });
    
    if (!cart?.items?.length) {
      return res.status(400).json({ 
        success: false, 
        error: "Cart is empty" 
      });
    }

    // ✨ ENHANCED: Check subscription status for each item
    const subscriptionIssues = [];
    for (const item of cart.items) {
      const status = await checkSubscriptionStatus(req.user._id, "Portfolio", item.portfolio);
      if (status.hasActiveSubscription && !status.canRenew) {
        subscriptionIssues.push({
          portfolio: item.portfolio,
          message: status.message,
          canRenewAfter: new Date(status.existingSubscription.expiresAt.getTime() - (7 * 24 * 60 * 60 * 1000))
        });
      }
    }

    if (subscriptionIssues.length > 0) {
      return res.status(409).json({ 
        success: false, 
        error: "Some portfolios in cart have active subscriptions",
        subscriptionIssues
      });
    }

    // Calculate total amount
    let total = 0;
    for (const item of cart.items) {
      const portfolio = await Portfolio.findById(item.portfolio);
      if (!portfolio) {
        throw new Error(`Portfolio ${item.portfolio} not found`);
      }
      
      const plan = portfolio.subscriptionFee.find(fee => fee.type === planType);
      if (!plan) {
        throw new Error(`${planType} plan not found for portfolio`);
      }
      
      total += plan.price * item.quantity;
    }

    if (total <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid cart amount" 
      });
    }
    
    const razorpay = await getRazorpayInstance();
    const order = await razorpay.orders.create({
      amount: Math.round(total * 100),
      currency: "INR",
      receipt: generateShortReceipt("cart", req.user._id),
      notes: { 
        userId: req.user._id.toString(), 
        cartCheckout: true, 
        planType 
      }
    });

    res.status(201).json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      planType
    });
  } catch (error) {
    logger.error("Cart checkout error", error);
    res.status(500).json({ 
      success: false, 
      error: error.message || "Cart checkout failed" 
    });
  }
};

/**
 * Get payment history
 */
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
      error: "Failed to get payment history" 
    });
  }
};

/**
 * ✨ ENHANCED CRON JOB: Cleanup expired subscriptions and send renewal reminders
 */
exports.startCleanupJob = () => {
  let isCleanupRunning = false;

  // Main cleanup job - runs every 5 hours
  const cleanupJob = cron.schedule("0 */5 * * *", async () => {
    if (isCleanupRunning) {
      logger.warn("Cleanup job skipped - previous run still in progress");
      return;
    }

    isCleanupRunning = true;
    const now = new Date();
    
    try {
      logger.info("Starting subscription cleanup job...");

      // 1. Expire one-time subscriptions past their expiration date
      const expiredResult = await Subscription.updateMany(
        { 
          status: "active", 
          type: "one_time", 
          expiresAt: { $lt: now } 
        },
        { status: "expired" }
      );

      // 2. Cancel recurring subscriptions unpaid for 30+ days
      const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
      const unpaidSubscriptions = await Subscription.find({
        status: "active",
        type: "recurring",
        lastPaymentAt: { $lt: thirtyDaysAgo }
      });

      let cancelledCount = 0;
      if (unpaidSubscriptions.length > 0) {
        const razorpay = await getRazorpayInstance();
        
        for (const subscription of unpaidSubscriptions) {
          try {
            await razorpay.subscriptions.cancel(subscription.razorpaySubscriptionId);
            logger.info(`Cancelled Razorpay subscription: ${subscription.razorpaySubscriptionId}`);
          } catch (razorpayError) {
            logger.error(`Failed to cancel Razorpay subscription ${subscription.razorpaySubscriptionId}:`, razorpayError);
          }
          
          await Subscription.updateOne(
            { _id: subscription._id },
            { status: "cancelled" }
          );
          cancelledCount++;
        }
      }

      // 3. Update premium status for affected users
      const affectedUsers = await Subscription.distinct("user", {
        status: { $in: ["expired", "cancelled"] },
        updatedAt: { $gte: new Date(now.getTime() - 60000) }
      });

      for (const userId of affectedUsers) {
        await updateUserPremiumStatus(userId);
      }

      logger.info(`Cleanup job completed: expired ${expiredResult.modifiedCount} one-time subscriptions, cancelled ${cancelledCount} recurring subscriptions, updated ${affectedUsers.length} user statuses`);

    } catch (error) {
      logger.error("Cleanup job error:", error);
    } finally {
      isCleanupRunning = false;
    }
  }, {
    timezone: "Asia/Kolkata"
  });

  // ✨ NEW: Renewal reminder job - runs daily at 9 AM
  const reminderJob = cron.schedule("0 9 * * *", async () => {
    try {
      logger.info("Starting renewal reminder job...");
      
      const now = new Date();
      const threeDaysFromNow = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
      const sevenDaysFromNow = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));

      // Find subscriptions expiring within 7 days
      const expiringSubscriptions = await Subscription.find({
        status: "active",
        expiresAt: { 
          $gte: threeDaysFromNow, // At least 3 days away
          $lte: sevenDaysFromNow  // But within 7 days
        },
        // Don't send reminders for subscriptions we've already sent reminders for today
        $or: [
          { lastReminderSent: { $exists: false } },
          { lastReminderSent: { $lt: new Date(now.getTime() - (24 * 60 * 60 * 1000)) } }
        ]
      })
      .populate('user')
      .populate('portfolio');

      let remindersSent = 0;

      for (const subscription of expiringSubscriptions) {
        if (subscription.user && subscription.portfolio) {
          const success = await sendRenewalReminderEmail(
            subscription.user, 
            subscription, 
            subscription.portfolio
          );
          
          if (success) {
            // Mark that we sent a reminder
            await Subscription.updateOne(
              { _id: subscription._id },
              { lastReminderSent: now }
            );
            remindersSent++;
          }
        }
      }

      logger.info(`Renewal reminder job completed: ${remindersSent} reminders sent`);

    } catch (error) {
      logger.error("Renewal reminder job error:", error);
    }
  }, {
    timezone: "Asia/Kolkata"
  });

  cleanupJob.start();
  reminderJob.start();
  
  logger.info("Subscription cron jobs initialized:");
  logger.info("- Cleanup: Every 5 hours (0 */5 * * *)");
  logger.info("- Renewal reminders: Daily at 9 AM (0 9 * * *)");
};

/**
 * Manual cleanup endpoint for testing/admin use
 */
exports.cleanupExpiredSubscriptions = async (req, res) => {
  try {
    const now = new Date();
    
    const expiredResult = await Subscription.updateMany(
      {
        status: "active",
        type: "one_time",
        expiresAt: { $lt: now }
      },
      { status: "expired" }
    );

    const affectedUsers = await Subscription.distinct('user', {
      status: "expired",
      updatedAt: { $gte: new Date(now.getTime() - 60000) }
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
    logger.error("Manual cleanup error", error);
    res.status(500).json({ 
      success: false, 
      error: "Cleanup failed" 
    });
  }
};

/**
 * ✨ NEW: Manual send renewal reminders endpoint
 */
exports.sendRenewalReminders = async (req, res) => {
  try {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));

    const expiringSubscriptions = await Subscription.find({
      status: "active",
      expiresAt: { $lte: sevenDaysFromNow, $gt: now }
    })
    .populate('user')
    .populate('portfolio');

    let remindersSent = 0;

    for (const subscription of expiringSubscriptions) {
      if (subscription.user && subscription.portfolio) {
        const success = await sendRenewalReminderEmail(
          subscription.user, 
          subscription, 
          subscription.portfolio
        );
        
        if (success) {
          await Subscription.updateOne(
            { _id: subscription._id },
            { lastReminderSent: now }
          );
          remindersSent++;
        }
      }
    }

    res.json({
      success: true,
      message: `Sent ${remindersSent} renewal reminder emails`,
      totalEligible: expiringSubscriptions.length
    });

  } catch (error) {
    logger.error("Manual renewal reminder error", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to send renewal reminders" 
    });
  }
};

module.exports = exports;
