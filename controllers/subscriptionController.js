const Razorpay = require("razorpay");
const crypto = require("crypto");
const mongoose = require("mongoose");
const cron = require("node-cron");
const Coupon = require("../models/couponScheama");
const Subscription = require("../models/subscription");
const Portfolio = require("../models/modelPortFolio");
const Cart = require("../models/carts");
const PaymentHistory = require("../models/paymenthistory");
const Bundle = require("../models/bundle");
const User = require("../models/user");
const DigioSign = require("../models/DigioSign");
const { getPaymentConfig } = require("../utils/configSettings");
const { sendEmail } = require("../services/emailServices"); // Add your email service
const TelegramService = require("../services/tgservice");
const { generateAndSendBill, generateBillHTML } = require("../services/billService");
const { COMPANY_INFO } = require("../config/billConfig");
const emailQueue = require("../services/emailQueue");
const { handleTelegramIntegration, sendTelegramInviteEmail } = require("./portfolioController");
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
  if (digits.length === 12 && digits.startsWith("91") && /^[6-9]/.test(digits.substring(2))) {
    return digits.substring(2);
  }
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

const calculateEmandateInterval = (emandateType) => {
  switch(emandateType) {
    case "monthly": return 1; // Charge every 1 month
    case "quarterly": return 3; // Charge every 3 months
    case "yearly": return 12; // Charge every 12 months
    default: return 1;
  }
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

const getProductInfo = async (productType, productId, planType, emandateType = null) => {
  let product, amount, category;
  
  if (productType === "Portfolio") {
    product = await Portfolio.findById(productId);
    if (!product) throw new Error("Portfolio not found");
    
    if (emandateType) {
      // Use emandate subscription fees if available
      if (!product.emandateSubriptionFees || product.emandateSubriptionFees.length === 0) {
        throw new Error(`Emandate subscription fees not configured for this portfolio`);
      }
      const plan = product.emandateSubriptionFees.find(p => p.type === emandateType);
      if (!plan) throw new Error(`Emandate plan '${emandateType}' not available for portfolio`);
      amount = plan.price;
    } else {
      // Use regular subscription fees
      const plan = product.subscriptionFee.find(p => p.type === planType);
      if (!plan) throw new Error(`Plan '${planType}' not available for portfolio`);
      amount = plan.price;
    }
    category = product.PortfolioCategory ? product.PortfolioCategory.toLowerCase() : "basic";
  } else if (productType === "Bundle") {
    product = await Bundle.findById(productId).populate("portfolios");
    if (!product) throw new Error("Bundle not found");
    
    if (emandateType) {
      // Use emandate pricing for bundles
      switch(emandateType) {
        case "monthly": amount = product.monthlyemandateprice; break;
        case "quarterly": amount = product.quarterlyemandateprice; break;
        case "yearly": amount = product.yearlyemandateprice; break;
        default: throw new Error("Invalid emandate type");
      }
    } else {
      // Use regular pricing for bundles
      switch(planType) {
        case "monthly": amount = product.monthlyPrice; break;
        case "quarterly": amount = product.monthlyemandateprice; break; // Fallback to monthly emandate price
        case "yearly": amount = product.yearlyPrice; break;
        default: throw new Error("Invalid planType");
      }
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
    
    // Enhanced validation for emandate
    if (!user.email || !user.email.includes('@')) {
      throw new Error("Valid email is required for emandate subscription");
    }
    
    if (!phone) {
      logger.warn("Creating customer without phone number", { 
        userId: user._id?.toString(),
        email: user.email 
      });
    }
    
    // Check for existing customer first
    try {
      const existingCustomers = await razorpay.customers.all({ 
        email: user.email, 
        count: 1 
      });
      
      if (existingCustomers.items && existingCustomers.items.length > 0) {
        const existingCustomer = existingCustomers.items[0];
        logger.info("Using existing Razorpay customer", {
          customerId: existingCustomer.id,
          email: user.email
        });
        return existingCustomer;
      }
    } catch (fetchError) {
      logger.warn("Failed to fetch existing customers, creating new", {
        error: fetchError.message,
        email: user.email
      });
    }
    
    // Create new customer with enhanced data
    const customerData = { 
      name: sanitizedName, 
      email: user.email.toLowerCase().trim()
    };
    
    if (phone) {
      customerData.contact = phone;
    }
    
    // Add additional metadata for emandate
    customerData.notes = {
      user_id: user._id?.toString() || 'unknown',
      created_for: 'emandate_subscription',
      created_at: new Date().toISOString()
    };
    
    logger.info("Creating new Razorpay customer", {
      email: customerData.email,
      name: customerData.name,
      hasPhone: !!customerData.contact
    });
    
    const newCustomer = await razorpay.customers.create(customerData);
    
    if (!newCustomer || !newCustomer.id) {
      throw new Error("Razorpay customer creation returned invalid response");
    }
    
    logger.info("Successfully created Razorpay customer", {
      customerId: newCustomer.id,
      email: newCustomer.email
    });
    
    return newCustomer;
    
  } catch (err) {
    logger.error("Customer creation/fetch failed", {
      error: err.message,
      stack: err.stack,
      userEmail: user.email,
      userId: user._id?.toString()
    });
    
    // Fallback: try with minimal data
    try {
      const simpleName = (user.fullName || user.username || "User").replace(/[^a-zA-Z\s]/g, "").trim();
      const finalName = simpleName.length >= 4 ? simpleName : "User Account";
      const phone = validatePhoneNumber(user.phone || user.mobile || "");
      
      const fallbackData = {
        name: finalName,
        email: user.email.toLowerCase().trim()
      };
      
      if (phone) {
        fallbackData.contact = phone;
      }
      
      logger.info("Attempting customer creation with fallback data", {
        name: fallbackData.name,
        email: fallbackData.email,
        hasPhone: !!fallbackData.contact
      });
      
      const fallbackCustomer = await razorpay.customers.create(fallbackData);
      
      if (!fallbackCustomer || !fallbackCustomer.id) {
        throw new Error("Fallback customer creation also failed");
      }
      
      return fallbackCustomer;
      
    } catch (fallbackError) {
      logger.error("Both primary and fallback customer creation failed", {
        primaryError: err.message,
        fallbackError: fallbackError.message,
        userEmail: user.email
      });
      throw new Error("Unable to create customer profile. Please verify your email address and try again.");
    }
  }
};

const createSubscriptionPlan = async (amountInPaisa, emandateType = "monthly") => {
  const razorpay = await getRazorpayInstance();
  
  // Validate amount
  if (!amountInPaisa || amountInPaisa < 100) {
    throw new Error(`Invalid plan amount: ₹${amountInPaisa/100}. Minimum ₹1 required.`);
  }
  
  if (amountInPaisa > 100000000) { // ₹10,00,000
    throw new Error(`Plan amount too high: ₹${amountInPaisa/100}. Maximum ₹10,00,000 allowed.`);
  }
  
  const interval = calculateEmandateInterval(emandateType);
  
  try {
    // Check for existing plans first
    logger.info("Checking for existing subscription plans", { amountInPaisa, emandateType, interval });
    
    const existingPlans = await razorpay.plans.all({ count: 100 });
    const found = existingPlans.items.find(p => 
      p.item.amount === amountInPaisa && 
      p.period === "monthly" && 
      p.interval === interval &&
      p.item.currency === "INR"
    );
    
    if (found) {
      logger.info("Using existing subscription plan", {
        planId: found.id,
        amount: found.item.amount,
        period: found.period,
        interval: found.interval
      });
      return found;
    }
    
    logger.info("Creating new subscription plan", { amountInPaisa, emandateType, interval });
    
  } catch(planFetchError) {
    logger.warn("Error fetching existing plans, proceeding with creation", {
      error: planFetchError.message
    });
  }
  
  try {
    // Create new plan with enhanced metadata
    const planData = {
      period: "monthly",
      interval: interval,
      item: {
        name: `${emandateType.charAt(0).toUpperCase() + emandateType.slice(1)} Emandate Plan - ₹${amountInPaisa/100}`,
        amount: amountInPaisa,
        currency: "INR",
        description: `${emandateType.charAt(0).toUpperCase() + emandateType.slice(1)} billing for emandate subscription`,
      },
      notes: { 
        emandate_type: emandateType,
        interval: interval.toString(),
        created_at: new Date().toISOString(),
        plan_type: `emandate_${emandateType}`
      }
    };
    
    const newPlan = await razorpay.plans.create(planData);
    
    if (!newPlan || !newPlan.id) {
      throw new Error("Plan creation returned invalid response");
    }
    
    logger.info("Successfully created new subscription plan", {
      planId: newPlan.id,
      amount: newPlan.item.amount,
      period: newPlan.period,
      interval: newPlan.interval,
      emandateType
    });
    
    return newPlan;
    
  } catch (planCreateError) {
    logger.error("Failed to create subscription plan", {
      error: planCreateError.message,
      stack: planCreateError.stack,
      amountInPaisa,
      emandateType,
      interval,
      razorpayError: planCreateError.error || null
    });
    
    throw new Error(`Failed to create subscription plan: ${planCreateError.message}`);
  }
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
    await emailQueue.addEmail({
      to: user.email,
      subject,
      text,
      html,
      type: 'renewal_reminder',
      userId: user._id,
      metadata: {
        subscriptionId: subscription._id,
        portfolioName: portfolio.name,

      }
    });
    
    logger.info(`Renewal reminder queued for ${user.email} for subscription ${subscription._id}`, {
      userId: user._id,
      portfolioName: portfolio.name,
      
    });
    return true;
  } catch (error) {
    logger.error(`Failed to queue renewal reminder for ${user.email}:`, error);
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
     
      
      <p>Thank you for continuing with us! You now have uninterrupted access to all features.</p>
      
      <hr style="margin:30px 0; border:none; border-top:1px solid #eee;">
      <p style="color:#666; font-size:12px;">This is an automated confirmation. If you have any questions, please contact our support team.</p>
    </div>
  `;
  
  try {
    await emailQueue.addEmail({
      to: user.email,
      subject,
      text,
      html,
      type: 'renewal_confirmation',
      userId: user._id,
      metadata: {
        subscriptionId: subscription._id,
        portfolioName: portfolio.name,
        compensationDays,

      }
    });
    
    logger.info(`Renewal confirmation queued for ${user.email} for subscription ${subscription._id}`, {
      userId: user._id,
      portfolioName: portfolio.name,
      compensationDays
    });
    return true;
  } catch (error) {
    logger.error(`Failed to queue renewal confirmation for ${user.email}:`, error);
    return false;
  }
};

// ===== CONTROLLER FUNCTIONS =====

/**
 * Create order for one-time payment
 * ✨ ENHANCED: Supports renewal with compensation logic
 */
exports.createOrder = async (req, res) => {
  const { productType, productId, planType = "monthly", isRenewal = false, couponCode } = req.body;
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

 

    // ENHANCED: Find user's eSign for this specific product
    let userEsignForProduct = await DigioSign.findOne({
      userId: userId,
      productType: productType,
      productId: productId,
      isTemplate: false,
      status: { $in: ['signed', 'completed'] }
    }).sort({ createdAt: -1 });

    // ENHANCED: Log the eSign lookup attempt
    logger.info('Looking up eSign for product purchase', {
      userId: userId.toString(),
      productType,
      productId: productId.toString(),
      foundSpecificEsign: !!userEsignForProduct
    });

    if (!userEsignForProduct) {
      // Try to find the most recent DigioSign record for this user+product in any pending state
      let latestDoc = await DigioSign.findOne({
        userId: userId,
        productType: productType,
        productId: productId,
        isTemplate: false
      }).sort({ createdAt: -1 });

      // Log the pending doc lookup attempt
      logger.info('Looking for pending eSign for product', {
        userId: userId.toString(),
        productType,
        productId: productId.toString(),
        foundPendingDoc: !!latestDoc
      });

      // As a fallback, if product linkage wasn't stored, pick latest user's doc
      if (!latestDoc) {
        latestDoc = await DigioSign.findOne({ userId: userId, isTemplate: false }).sort({ createdAt: -1 });
        
        // If we found a generic document (no product association), log it
        if (latestDoc) {
          logger.info('Found non-product-specific eSign document', {
            userId: userId.toString(),
            documentId: latestDoc.documentId,
            status: latestDoc.status,
            createdAt: latestDoc.createdAt
          });
        }
      }

      // If we have a document, attempt a just-in-time sync with Digio
      if (latestDoc && latestDoc.documentId) {
        try {
          logger.info('Attempting JIT sync of eSign status', {
            userId: userId.toString(),
            documentId: latestDoc.documentId,
            currentStatus: latestDoc.status
          });
          
          const { syncDocument } = require('../services/digioWebhookService');
          const syncResult = await syncDocument(latestDoc.documentId);
          
          if (syncResult?.document && ['signed', 'completed'].includes(syncResult.document.status)) {
            userEsignForProduct = syncResult.document;
            
            // ENHANCED: If we successfully found and synced a document that was signed,
            // but it wasn't associated with this product yet, update it now
            if (!userEsignForProduct.productType || !userEsignForProduct.productId) {
              userEsignForProduct = await DigioSign.findByIdAndUpdate(
                userEsignForProduct._id,
                {
                  productType: productType,
                  productId: productId,
                  productName: productType === 'Portfolio' ? 
                    (await Portfolio.findById(productId))?.name : 
                    (await Bundle.findById(productId))?.name
                },
                { new: true }
              );
              
              logger.info('Updated product association for eSign document', {
                userId: userId.toString(),
                documentId: userEsignForProduct.documentId,
                productType,
                productId: productId.toString()
              });
            }
          }
        } catch (e) {
          logger.warn('Digio JIT sync failed during order creation', { error: e.message });
        }
      }

      if (!userEsignForProduct) {
        // Fallback: allow any recent signed/completed eSign for this user (within 30 days)
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const anySigned = await DigioSign.findOne({
          userId: userId,
          isTemplate: false,
          status: { $in: ['signed', 'completed'] },
          createdAt: { $gte: thirtyDaysAgo }
        }).sort({ createdAt: -1 });

        if (anySigned) {
          logger.info('Found recent signed eSign document for user', {
            userId: userId.toString(),
            documentId: anySigned.documentId,
            status: anySigned.status,
            createdAt: anySigned.createdAt,
            signedAt: anySigned.signedAt
          });
          
          // ENHANCED: Update the product association for this eSign
          userEsignForProduct = await DigioSign.findByIdAndUpdate(
            anySigned._id,
            {
              productType: productType,
              productId: productId,
              productName: productType === 'Portfolio' ? 
                (await Portfolio.findById(productId))?.name : 
                (await Bundle.findById(productId))?.name
            },
            { new: true }
          );
          
          logger.info('Updated recent eSign with product association', {
            userId: userId.toString(),
            documentId: userEsignForProduct.documentId,
            productType,
            productId: productId.toString()
          });
        }
      }

      if (!userEsignForProduct) {
        // Get user-friendly status for the last document to show in the frontend
        let userFriendlyStatus = 'not_started';
        let authUrl = null;
        
        if (latestDoc) {
          // Convert technical status to user-friendly status
          if (['signed', 'completed'].includes(latestDoc.status)) {
            userFriendlyStatus = 'completed';
          } else if (['viewed', 'sent', 'initiated', 'document_created'].includes(latestDoc.status)) {
            userFriendlyStatus = 'pending';
            // Get authentication URL from various possible locations in the response
            authUrl = latestDoc?.digioResponse?.signing_parties?.[0]?.authentication_url || 
                      latestDoc?.digioResponse?.authentication_url || 
                      latestDoc?.digioResponse?.sign_url || null;
          } else {
            userFriendlyStatus = 'failed'; // expired, declined, failed
          }
        }
        
        // Custom response for frontend to trigger eSign creation/continuation
        return res.status(412).json({
          success: false,
          error: 'eSign required for this product before purchase',
          code: 'ESIGN_REQUIRED',
          productType,
          productId,
          lastDocument: latestDoc ? {
            documentId: latestDoc.documentId,
            status: latestDoc.status,
            userFriendlyStatus,
            authenticationUrl: authUrl
          } : null
        });
      }
    }

    // Get product info and original amount
    const { amount: originalAmount, category } = await getProductInfo(productType, productId, planType);
    let finalAmount = originalAmount;
    let discountApplied = 0;
    let couponUsed = null;
    let couponDetails = null;

    // ✨ NEW: Apply coupon if provided
    if (couponCode) {
      try {
        const coupon = await Coupon.findOne({ code: couponCode.toUpperCase() });
        
        if (!coupon) {
          return res.status(404).json({
            success: false,
            error: 'Invalid coupon code'
          });
        }

        // Check if coupon is valid (active and not expired)
        if (!coupon.isValid) {
          let reason = 'Coupon is not valid';
          if (coupon.status !== 'active') {
            reason = 'Coupon is inactive';
          } else if (coupon.isExpired) {
            reason = 'Coupon has expired';
          } else {
            reason = 'Coupon is not yet active';
          }
          
          return res.status(400).json({
            success: false,
            error: reason
          });
        }

        // Check usage limit
        if (coupon.usageLimit !== -1 && coupon.usedCount >= coupon.usageLimit) {
          return res.status(400).json({
            success: false,
            error: 'Coupon usage limit exceeded'
          });
        }

        // Check if user can use this coupon
        const userCheck = coupon.canUserUseCoupon(userId);
        if (!userCheck.canUse) {
          return res.status(400).json({
            success: false,
            error: userCheck.reason
          });
        }

        // Check if coupon applies to the product
        if (!coupon.appliesTo(productType, productId)) {
          return res.status(400).json({
            success: false,
            error: 'Coupon is not applicable to this product'
          });
        }

        // Check for new users only restriction
        if (coupon.userRestrictions.newUsersOnly) {
          const hasAnySubscription = await Subscription.findOne({ user: userId });
          if (hasAnySubscription) {
            return res.status(400).json({
              success: false,
              error: 'This coupon is only for new users'
            });
          }
        }

        // Calculate discount
        const discountResult = coupon.calculateDiscount(originalAmount);
        
        if (discountResult.reason) {
          return res.status(400).json({
            success: false,
            error: discountResult.reason
          });
        }

        // Apply discount
        finalAmount = discountResult.finalAmount;
        discountApplied = discountResult.discount;
        couponUsed = coupon._id;
        couponDetails = {
          code: coupon.code,
          title: coupon.title,
          description: coupon.description,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue
        };

        logger.info('Coupon applied successfully in order creation', {
          userId: userId.toString(),
          couponCode: coupon.code,
          originalAmount,
          discountApplied,
          finalAmount,
          productType,
          productId: productId.toString()
        });

      } catch (couponError) {
        logger.error('Error processing coupon in order creation', {
          error: couponError.message,
          stack: couponError.stack,
          userId: userId.toString(),
          couponCode
        });
        
        return res.status(500).json({
          success: false,
          error: 'Failed to process coupon. Please try again.'
        });
      }
    }

    // Validate final amount
    if (finalAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid final amount after discount'
      });
    }

    const razorpay = await getRazorpayInstance();
    const receipt = generateShortReceipt("ord", userId);
    
    const order = await razorpay.orders.create({
      amount: Math.round(finalAmount * 100), // Use final amount after discount
      currency: "INR",
      receipt,
      notes: {
        userId: userId.toString(),
        productType,
        productId: productId.toString(),
        planType,
        category,
        isRenewal: subscriptionStatus.canRenew.toString(),
        existingSubscriptionId: subscriptionStatus.existingSubscription?._id?.toString() || null,
        // Coupon related notes
        couponCode: couponCode || null,
        couponUsed: couponUsed?.toString() || null,
        originalAmount: originalAmount.toString(),
        discountApplied: discountApplied.toString(),
        finalAmount: finalAmount.toString()
      }
    });

    const responseData = { 
      success: true, 
      orderId: order.id, 
      amount: order.amount, // This is in paisa (finalAmount * 100)
      currency: order.currency, 
      planType, 
      category,
      // Pricing breakdown
      originalAmount,
      discountApplied,
      finalAmount,
      savings: discountApplied
    };

    // Add coupon information to response
    if (couponDetails) {
      responseData.couponApplied = couponDetails;
      responseData.message = `Coupon "${couponDetails.code}" applied successfully! You saved ₹${discountApplied}`;
    }

    // Add renewal information if applicable
    if (subscriptionStatus.canRenew) {
      responseData.isRenewal = true;
      responseData.compensationDays = Math.ceil((subscriptionStatus.existingSubscription.expiresAt - new Date()) / (24 * 60 * 60 * 1000));
      const renewalMessage = `Renewal order created. You will get ${responseData.compensationDays} bonus days added to your new subscription.`;
      responseData.message = responseData.message ? `${responseData.message} ${renewalMessage}` : renewalMessage;
    }

    logger.info('Order created successfully with coupon support', {
      userId: userId.toString(),
      orderId: order.id,
      originalAmount,
      finalAmount,
      discountApplied,
      couponCode: couponCode || 'none',
      isRenewal: subscriptionStatus.canRenew
    });

    res.status(201).json(responseData);
    
  } catch (err) {
    logger.error("Error in createOrder", {
      error: err.message,
      stack: err.stack,
      userId: userId.toString(),
      productType,
      productId: productId?.toString(),
      couponCode
    });
    
    res.status(500).json({ 
      success: false, 
      error: err.message || "Order creation failed" 
    });
  }
};

/**
 * Create eMandate for recurring payments
 * ✨ ENHANCED: Supports renewal with compensation logic + Enhanced Error Handling
 */
exports.createEmandate = async (req, res) => {
  const { productType, productId, couponCode, emandateType = "monthly" } = req.body;
  const userId = req.user._id;
  
  try {
    if (!productType || !productId) {
      logger.error("EMandate creation failed: Missing required fields", {
        userId: userId.toString(),
        productType,
        productId,
        timestamp: new Date().toISOString()
      });
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields: productType and productId",
        code: "MISSING_FIELDS"
      });
    }

    logger.info("EMandate creation started", {
      userId: userId.toString(),
      productType,
      productId: productId.toString(),
      userEmail: req.user.email,
      couponCode: couponCode || 'none',
      timestamp: new Date().toISOString()
    });

    const subscriptionStatus = await checkSubscriptionStatus(userId, productType, productId);
    
    if (subscriptionStatus.hasActiveSubscription && !subscriptionStatus.canRenew) {
      logger.warn("EMandate creation blocked: Active subscription exists", {
        userId: userId.toString(),
        productType,
        productId: productId.toString(),
        existingExpiry: subscriptionStatus.existingSubscription.expiresAt
      });
      return res.status(409).json({ 
        success: false, 
        error: subscriptionStatus.message,
        code: "ACTIVE_SUBSCRIPTION_EXISTS",
        canRenewAfter: new Date(subscriptionStatus.existingSubscription.expiresAt.getTime() - (7 * 24 * 60 * 60 * 1000)),
        currentExpiry: subscriptionStatus.existingSubscription.expiresAt
      });
    }

    let product, originalAmount, category;
    try {
      const productInfo = await getProductInfo(productType, productId, null, emandateType);
      product = productInfo.product;
      originalAmount = productInfo.amount;
      category = productInfo.category;
      
      if (!originalAmount || originalAmount < 100) {
        throw new Error(`Invalid ${emandateType} amount: ${originalAmount}. Minimum ₹100 required for emandate.`);
      }
      
      if (originalAmount > 1000000) {
        throw new Error(`Amount too high: ₹${originalAmount}. Maximum ₹10,00,000 allowed for emandate.`);
      }
      
    } catch (error) {
      logger.error("EMandate creation failed: Product validation error", {
        userId: userId.toString(),
        productType,
        productId: productId.toString(),
        emandateType,
        error: error.message
      });
      return res.status(400).json({
        success: false,
        error: error.message,
        code: "PRODUCT_VALIDATION_ERROR"
      });
    }

    let finalAmount = originalAmount;
    let discountApplied = 0;
    let couponUsed = null;
    let couponDetails = null;

    if (couponCode) {
      try {
        const coupon = await Coupon.findOne({ code: couponCode.toUpperCase() });
        
        if (!coupon) {
          return res.status(404).json({
            success: false,
            error: 'Invalid coupon code',
            code: "INVALID_COUPON"
          });
        }

        if (!coupon.isValid) {
          let reason = 'Coupon is not valid';
          if (coupon.status !== 'active') {
            reason = 'Coupon is inactive';
          } else if (coupon.isExpired) {
            reason = 'Coupon has expired';
          } else {
            reason = 'Coupon is not yet active';
          }
          
          return res.status(400).json({
            success: false,
            error: reason,
            code: "COUPON_INVALID"
          });
        }

        if (coupon.usageLimit !== -1 && coupon.usedCount >= coupon.usageLimit) {
          return res.status(400).json({
            success: false,
            error: 'Coupon usage limit exceeded',
            code: "COUPON_LIMIT_EXCEEDED"
          });
        }

        const userCheck = coupon.canUserUseCoupon(userId);
        if (!userCheck.canUse) {
          return res.status(400).json({
            success: false,
            error: userCheck.reason,
            code: "COUPON_USER_RESTRICTED"
          });
        }

        if (!coupon.appliesTo(productType, productId)) {
          return res.status(400).json({
            success: false,
            error: 'Coupon is not applicable to this product',
            code: "COUPON_NOT_APPLICABLE"
          });
        }

        if (coupon.userRestrictions.newUsersOnly) {
          const hasAnySubscription = await Subscription.findOne({ user: userId });
          if (hasAnySubscription) {
            return res.status(400).json({
              success: false,
              error: 'This coupon is only for new users',
              code: "COUPON_NEW_USERS_ONLY"
            });
          }
        }

        const discountResult = coupon.calculateDiscount(originalAmount);
        
        if (discountResult.reason) {
          return res.status(400).json({
            success: false,
            error: discountResult.reason,
            code: "COUPON_CALCULATION_ERROR"
          });
        }

        finalAmount = discountResult.finalAmount;
        discountApplied = discountResult.discount;
        couponUsed = coupon._id;
        couponDetails = {
          code: coupon.code,
          title: coupon.title,
          description: coupon.description,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue
        };

        logger.info('Coupon applied successfully in eMandate creation', {
          userId: userId.toString(),
          couponCode: coupon.code,
          originalAmount,
          discountApplied,
          finalAmount,
          emandateType,
          productType,
          productId: productId.toString()
        });

      } catch (couponError) {
        logger.error('Error processing coupon in eMandate creation', {
          error: couponError.message,
          stack: couponError.stack,
          userId: userId.toString(),
          couponCode
        });
        
        return res.status(500).json({
          success: false,
          error: 'Failed to process coupon. Please try again.',
          code: "COUPON_PROCESSING_ERROR"
        });
      }
    }

    // Use the amount directly without GST calculation
    const emandateAmount = finalAmount;
    
    if (emandateAmount < 10) {
      logger.error("EMandate creation failed: Amount too low after discount", {
        userId: userId.toString(),
        originalAmount,
        finalAmount,
        emandateAmount,
        discountApplied,
        emandateType,
        productType,
        productId: productId.toString()
      });
      return res.status(400).json({
        success: false,
        error: `Amount (₹${emandateAmount}) is too low after discount. Minimum ₹10 required.`,
        code: "AMOUNT_TOO_LOW"
      });
    }

    let razorpay;
    try {
      razorpay = await getRazorpayInstance();
    } catch (error) {
      logger.error("EMandate creation failed: Razorpay configuration error", {
        userId: userId.toString(),
        error: error.message
      });
      return res.status(500).json({
        success: false,
        error: "Payment service configuration error. Please try again later.",
        code: "PAYMENT_CONFIG_ERROR"
      });
    }

    let customer;
    try {
      customer = await createOrFetchCustomer(razorpay, req.user);
      
      if (!customer || !customer.id) {
        throw new Error("Failed to create or fetch customer");
      }
      
      logger.info("Customer created/fetched successfully", {
        userId: userId.toString(),
        customerId: customer.id,
        customerEmail: customer.email
      });
      
    } catch (error) {
      logger.error("EMandate creation failed: Customer creation error", {
        userId: userId.toString(),
        userEmail: req.user.email,
        error: error.message,
        stack: error.stack
      });
      return res.status(500).json({
        success: false,
        error: "Failed to create customer profile. Please check your details and try again.",
        code: "CUSTOMER_CREATION_ERROR"
      });
    }

    let plan;
    try {
      plan = await createSubscriptionPlan(emandateAmount * 100, emandateType);
      
      if (!plan || !plan.id) {
        throw new Error("Failed to create subscription plan");
      }
      
      logger.info("Subscription plan created successfully", {
        userId: userId.toString(),
        planId: plan.id,
        emandateAmount,
        emandateType,
        planAmount: plan.item.amount
      });
      
    } catch (error) {
      logger.error("EMandate creation failed: Plan creation error", {
        userId: userId.toString(),
        emandateAmount,
        emandateType,
        error: error.message,
        stack: error.stack
      });
      return res.status(500).json({
        success: false,
        error: "Failed to create subscription plan. Please try again later.",
        code: "PLAN_CREATION_ERROR"
      });
    }

    const startDate = new Date();
    const commitmentEndDate = new Date();
    
          // Calculate interval based on emandate type
      const interval = calculateEmandateInterval(emandateType);
    
    // Set commitment end date to 1 year from now (for Razorpay requirement)
    // Note: This is just for Razorpay's expire_by field, actual subscription continues indefinitely
    commitmentEndDate.setFullYear(startDate.getFullYear() + 1);

    if (subscriptionStatus.canRenew) {
      const compensation = calculateCompensatedEndDate(emandateType, subscriptionStatus.existingSubscription.expiresAt);
      commitmentEndDate.setTime(compensation.endDate.getTime());
    }

    const now = Math.floor(Date.now() / 1000);
    const startAt = now + 300; 
    const expireBy = Math.floor(commitmentEndDate.getTime() / 1000);
    
    if (expireBy <= startAt) {
      logger.error("EMandate creation failed: Invalid date range", {
        userId: userId.toString(),
        startAt,
        expireBy,
        commitmentEndDate: commitmentEndDate.toISOString(),
        nowTimestamp: now,
        bufferMinutes: 5
      });
      return res.status(400).json({
        success: false,
        error: "Invalid subscription period. Please try again.",
        code: "INVALID_DATE_RANGE"
      });
    }

    // Calculate total_count based on emandate type for Razorpay requirement
    let totalCount;
    switch (emandateType) {
      case 'monthly':
        totalCount = 12; // 12 months
        break;
      case 'quarterly':
        totalCount = 4;  // 4 quarters
        break;
      case 'yearly':
        totalCount = 1;  // 1 year
        break;
      default:
        totalCount = 12; // Default to 12 months
    }

    const subscriptionParams = {
      plan_id: plan.id,
      customer_id: customer.id,
      quantity: 1,
      start_at: startAt,
      expire_by: expireBy,
      total_count: totalCount, // Add total_count for Razorpay requirement
      notes: {
        user_id: userId.toString(),
        product_type: productType,
        product_id: productId.toString(),
        category,
        emandate_type: emandateType,
        interval: interval.toString(),
        isRenewal: subscriptionStatus.canRenew.toString(),
        existingSubscriptionId: subscriptionStatus.existingSubscription?._id?.toString() || null,
        created_at: new Date().toISOString(),
        user_email: req.user.email,
        couponCode: couponCode || null,
        couponUsed: couponUsed?.toString() || null,
        originalAmount: originalAmount.toString(),
        discountApplied: discountApplied.toString(),
        finalAmount: finalAmount.toString()
      }
    };

    logger.info("Creating Razorpay subscription with params", {
      userId: userId.toString(),
      planId: plan.id,
      customerId: customer.id,
      interval,
      emandateType,
      startAt,
      expireBy,
      totalCount,
      emandateAmount,
      originalAmount,
      finalAmount,
      discountApplied
    });


    let razorpaySubscription;
    try {
      razorpaySubscription = await razorpay.subscriptions.create(subscriptionParams);
      
      if (!razorpaySubscription || !razorpaySubscription.id) {
        throw new Error("Invalid subscription response from Razorpay");
      }
      
      logger.info("Razorpay subscription created successfully", {
        userId: userId.toString(),
        subscriptionId: razorpaySubscription.id,
        status: razorpaySubscription.status,
        shortUrl: razorpaySubscription.short_url
      });
      
    } catch (error) {
      logger.error("EMandate creation failed: Razorpay subscription error", {
        userId: userId.toString(),
        subscriptionParams: JSON.stringify(subscriptionParams, null, 2),
        error: error.message,
        stack: error.stack,
        razorpayError: error.error || null
      });
      
      // Handle specific Razorpay errors
      let userMessage = "Failed to create emandate subscription. Please try again later.";
      let errorCode = "RAZORPAY_ERROR";
      
      if (error.message?.includes('BAD_REQUEST')) {
        userMessage = "Invalid request parameters. Please check your details and try again.";
        errorCode = "BAD_REQUEST";
      } else if (error.message?.includes('SERVER_ERROR')) {
        userMessage = "Payment service is temporarily unavailable. Please try again in a few minutes.";
        errorCode = "SERVER_ERROR";
      } else if (error.message?.includes('customer')) {
        userMessage = "Customer validation failed. Please update your profile and try again.";
        errorCode = "CUSTOMER_ERROR";
      } else if (error.message?.includes('plan')) {
        userMessage = "Subscription plan error. Please try a different payment method.";
        errorCode = "PLAN_ERROR";
      }
      
      return res.status(500).json({
        success: false,
        error: userMessage,
        code: errorCode,
        suggestion: "Try using one-time payment instead, or contact support if the issue persists."
      });
    }
    
    const session = await mongoose.startSession();
    let dbSubscriptions = [];
    
    try {
      await session.withTransaction(async () => {
        if (productType === "Bundle") {
          if (product.portfolios && product.portfolios.length > 0) {
            for (const portfolio of product.portfolios) {
              const amountPerPortfolio = Math.round(emandateAmount / product.portfolios.length);
              const dbSubscription = await Subscription.findOneAndUpdate(
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
                  amount: amountPerPortfolio,
                  originalAmount: Math.round(originalAmount / product.portfolios.length),
                  discountApplied: Math.round(discountApplied / product.portfolios.length),
                  category: portfolio.PortfolioCategory ? portfolio.PortfolioCategory.toLowerCase() : category,
                  planType: emandateType,
                  expiresAt: commitmentEndDate,
                  razorpaySubscriptionId: razorpaySubscription.id,
                  bundleId: productId,
                  isRenewal: subscriptionStatus.canRenew,
                  previousSubscriptionId: subscriptionStatus.existingSubscription?._id || null,
                  couponUsed: couponUsed,
                  createdAt: new Date(),
                  updatedAt: new Date()
                },
                { upsert: true, new: true, session }
              );
              dbSubscriptions.push(dbSubscription);
            }
            logger.info("Bundle subscriptions saved to database with coupon", {
              userId: userId.toString(),
              bundleId: productId.toString(),
              portfolioCount: product.portfolios.length,
              razorpaySubscriptionId: razorpaySubscription.id,
              emandateType,
              couponCode: couponCode || 'none',
              discountApplied,
              emandateAmount
            });
          } else {
            // No portfolios: just proceed, do not throw error
            logger.info("Bundle has no portfolios, proceeding with bundle subscription only", {
              userId: userId.toString(),
              bundleId: productId.toString(),
              razorpaySubscriptionId: razorpaySubscription.id,
              emandateType,
              couponCode: couponCode || 'none',
              discountApplied,
              emandateAmount
            });
          }
          
        } else {
          const dbSubscription = await Subscription.findOneAndUpdate(
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
              amount: emandateAmount,
              originalAmount: originalAmount,
              discountApplied: discountApplied,
              category,
              planType: emandateType,
              expiresAt: commitmentEndDate,
              razorpaySubscriptionId: razorpaySubscription.id,
              isRenewal: subscriptionStatus.canRenew,
              previousSubscriptionId: subscriptionStatus.existingSubscription?._id || null,
              couponUsed: couponUsed,
              createdAt: new Date(),
              updatedAt: new Date()
            },
            { upsert: true, new: true, session }
          );
          dbSubscriptions.push(dbSubscription);
          
          logger.info("Single subscription saved to database with coupon", {
            userId: userId.toString(),
            productType,
            productId: productId.toString(),
            subscriptionId: dbSubscription._id.toString(),
            razorpaySubscriptionId: razorpaySubscription.id,
            emandateType,
            couponCode: couponCode || 'none',
            discountApplied,
            emandateAmount
          });
        }
      });
    } catch (dbError) {
      logger.error("EMandate creation failed: Database transaction error", {
        userId: userId.toString(),
        razorpaySubscriptionId: razorpaySubscription.id,
        error: dbError.message,
        stack: dbError.stack
      });
      
      // Try to cancel the Razorpay subscription if DB save failed
      try {
        await razorpay.subscriptions.cancel(razorpaySubscription.id);
        logger.info("Cancelled Razorpay subscription due to DB error", {
          subscriptionId: razorpaySubscription.id
        });
      } catch (cancelError) {
        logger.error("Failed to cancel Razorpay subscription after DB error", {
          subscriptionId: razorpaySubscription.id,
          cancelError: cancelError.message
        });
      }
      
      return res.status(500).json({
        success: false,
        error: "Failed to save subscription details. Please contact support.",
        code: "DATABASE_ERROR"
      });
    } finally {
      await session.endSession();
    }

    const responseData = { 
      success: true, 
      subscriptionId: razorpaySubscription.id, 
      setupUrl: razorpaySubscription.short_url,
      amount: emandateAmount,
      originalAmount,
      finalAmount,
      discountApplied,
      savings: discountApplied,
      category,
      emandateType,
      interval,
      status: razorpaySubscription.status || "pending_authentication",
      createdAt: new Date().toISOString()
    };

    // Add coupon information to response
    if (couponDetails) {
      responseData.couponApplied = couponDetails;
      responseData.message = `Coupon "${couponDetails.code}" applied successfully! You saved ₹${discountApplied} on your ${emandateType} subscription.`;
    }

    // Add renewal information if applicable
    if (subscriptionStatus.canRenew) {
      responseData.isRenewal = true;
      responseData.compensationDays = Math.ceil((subscriptionStatus.existingSubscription.expiresAt - new Date()) / (24 * 60 * 60 * 1000));
      const renewalMessage = `eMandate renewal created successfully. You will get ${responseData.compensationDays} bonus days added to your new subscription.`;
      responseData.message = responseData.message ? `${responseData.message} ${renewalMessage}` : renewalMessage;
    } else {
      if (!responseData.message) {
        responseData.message = "eMandate subscription created successfully. Please complete the authentication process.";
      }
    }

    logger.info("EMandate creation completed successfully with coupon support", {
      userId: userId.toString(),
      subscriptionId: razorpaySubscription.id,
      productType,
      productId: productId.toString(),
      emandateAmount,
      originalAmount,
      finalAmount,
      discountApplied,
      emandateType,
      interval,
      couponCode: couponCode || 'none',
      isRenewal: subscriptionStatus.canRenew
    });

    res.status(201).json(responseData);
    
  } catch(err) {
    logger.error("EMandate creation failed: Unexpected error", {
      userId: userId.toString(),
      productType,
      productId: productId?.toString(),
      couponCode,
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    });
    
    // Provide specific error messages based on error type
    let userMessage = "eMandate creation failed. Please try again later.";
    let errorCode = "INTERNAL_ERROR";
    
    if (err.message?.includes('network') || err.message?.includes('timeout')) {
      userMessage = "Network error. Please check your connection and try again.";
      errorCode = "NETWORK_ERROR";
    } else if (err.message?.includes('validation') || err.message?.includes('required')) {
      userMessage = "Validation error. Please check your information and try again.";
      errorCode = "VALIDATION_ERROR";
    } else if (err.message?.includes('duplicate') || err.code === 11000) {
      userMessage = "Duplicate subscription detected. Please refresh and try again.";
      errorCode = "DUPLICATE_ERROR";
    }
    
    res.status(500).json({ 
      success: false, 
      error: userMessage,
      code: errorCode,
      suggestion: "Try using one-time payment instead, or contact support if the issue persists.",
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Verify one-time payment
 * ✨ ENHANCED: Handles renewal with compensation logic
 */
exports.verifyPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { paymentId, orderId, signature } = req.body;
    if (!paymentId || !orderId || !signature) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, error: "Missing payment details" });
    }

    // Prevent duplicate processing
    if (await PaymentHistory.findOne({ paymentId })) {
      await session.abortTransaction();
      return res.status(409).json({ success: false, error: "Payment already processed" });
    }

    // Verify signature
    const { key_secret } = await getPaymentConfig();
    const expected = crypto
      .createHmac("sha256", key_secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
      
    if (expected !== signature) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, error: "Invalid payment signature" });
    }

    // Fetch order
    const razorpay = await getRazorpayInstance();
    const order = await razorpay.orders.fetch(orderId);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    // Extract note fields
    const notes = order.notes || {};
    const userId = req.user._id;
    const paidAmount = order.amount / 100; // Convert from paisa

    let responseData = {};
    let newSubscriptions = [];

    // ✨ NEW: Handle Cart Checkout
    if (notes.cartCheckout === "true") {
      const { 
        planType = "monthly",
        couponCode,
        couponUsed,
        originalTotal: noteOriginalTotal,
        discountApplied: noteDiscountApplied,
        finalTotal: noteFinalTotal,
        itemCount,
        cartId
      } = notes;
      
      // Parse coupon-related amounts from notes
      const originalTotal = parseFloat(noteOriginalTotal) || paidAmount;
      const discountApplied = parseFloat(noteDiscountApplied) || 0;
      const finalTotal = parseFloat(noteFinalTotal) || paidAmount;

      // Validate payment amount matches expected final amount
      if (Math.abs(paidAmount - finalTotal) > 0.01) { // Allow 1 paisa difference due to rounding
        logger.error("Cart payment amount mismatch", {
          userId: userId.toString(),
          orderId,
          paymentId,
          paidAmount,
          expectedFinalAmount: finalTotal,
          originalTotal,
          discountApplied
        });
        
        await session.abortTransaction();
        return res.status(400).json({ 
          success: false, 
          error: "Payment amount verification failed" 
        });
      }

      // Process coupon usage if coupon was applied
      if (couponUsed) {
        try {
          const coupon = await Coupon.findById(couponUsed);
          if (coupon) {
            await coupon.useCoupon(
              userId,
              orderId,
              "Cart", // Product type for cart
              cartId, // Cart ID as product ID
              discountApplied
            );
            
            logger.info('Coupon usage recorded for cart payment', {
              couponCode: coupon.code,
              userId: userId.toString(),
              orderId,
              paymentId,
              cartId,
              discountApplied
            });
          }
        } catch (couponError) {
          logger.error('Failed to record coupon usage for cart payment', {
            error: couponError.message,
            couponId: couponUsed,
            orderId,
            paymentId
          });
          // Don't fail payment verification due to coupon tracking error
        }
      }

      // Get cart and create subscriptions for each item
      const cart = await Cart.findById(cartId);
      if (!cart) {
        await session.abortTransaction();
        return res.status(404).json({ success: false, error: "Cart not found" });
      }

      for (const item of cart.items) {
        const portfolio = await Portfolio.findById(item.portfolio);
        if (!portfolio) {
          logger.warn(`Portfolio ${item.portfolio} not found during cart payment verification`);
          continue;
        }

        const plan = portfolio.subscriptionFee.find(fee => fee.type === planType);
        if (!plan) {
          logger.warn(`Plan ${planType} not found for portfolio ${item.portfolio}`);
          continue;
        }

        // Calculate proportional amounts for this item
        const itemOriginalAmount = plan.price * item.quantity;
        const itemDiscountApplied = originalTotal > 0 ? (itemOriginalAmount / originalTotal) * discountApplied : 0;
        const itemFinalAmount = itemOriginalAmount - itemDiscountApplied;

        // Create subscription for this portfolio
        const newSub = await Subscription.findOneAndUpdate(
          { user: userId, productType: "Portfolio", productId: item.portfolio, type: "one_time" },
          {
            user: userId,
            productType: "Portfolio",
            productId: item.portfolio,
            portfolio: item.portfolio,
            type: "one_time",
            status: "active",
            amount: itemFinalAmount,
            originalAmount: itemOriginalAmount,
            discountApplied: itemDiscountApplied,
            category: portfolio.PortfolioCategory?.toLowerCase() || "basic",
            planType: planType,
            expiresAt: calculateEndDate(planType),
            paymentId,
            orderId,
            couponUsed: couponUsed || null,
            isCartItem: true,
            cartId: cartId
          },
          { upsert: true, new: true, session }
        );
        newSubscriptions.push(newSub);

        // Create payment history for this item
        await PaymentHistory.create([{
          user: userId,
          subscription: newSub._id,
          portfolio: item.portfolio,
          amount: itemFinalAmount,
          paymentId: `${paymentId}_cart_${item.portfolio}`,
          orderId,
          signature,
          status: "VERIFIED",
          description: `Cart item payment - ${portfolio.name || portfolio.portfolioName} (${couponCode ? `Coupon: ${couponCode}` : 'No coupon'})`
        }], { session });
      }

      // Clear the cart after successful payment
      await Cart.findByIdAndUpdate(cartId, { items: [] }, { session });

      responseData = {
        success: true,
        message: `Cart payment verified${couponCode ? ` with coupon ${couponCode}` : ""}`,
        subscriptionsCreated: newSubscriptions.length,
        originalTotal,
        discountApplied,
        finalTotal,
        savings: discountApplied,
        planType
      };

      // Add coupon details to response if coupon was used
      if (couponCode) {
        responseData.couponUsed = {
          code: couponCode,
          discountApplied,
          savings: discountApplied
        };
      }

    } else {
      // ✨ EXISTING: Handle Single Product/Bundle Payment
      const { 
        productType, 
        productId, 
        planType = "monthly", 
        isRenewal, 
        existingSubscriptionId,
        couponCode,
        couponUsed,
        originalAmount: noteOriginalAmount,
        discountApplied: noteDiscountApplied,
        finalAmount: noteFinalAmount
      } = notes;
      
      // Parse coupon-related amounts from notes
      const originalAmount = parseFloat(noteOriginalAmount) || paidAmount;
      const discountApplied = parseFloat(noteDiscountApplied) || 0;
      const finalAmount = parseFloat(noteFinalAmount) || paidAmount;

      // Validate payment amount matches expected final amount
      if (Math.abs(paidAmount - finalAmount) > 0.01) { // Allow 1 paisa difference due to rounding
        logger.error("Payment amount mismatch", {
          userId: userId.toString(),
          orderId,
          paymentId,
          paidAmount,
          expectedFinalAmount: finalAmount,
          originalAmount,
          discountApplied
        });
        
        await session.abortTransaction();
        return res.status(400).json({ 
          success: false, 
          error: "Payment amount verification failed" 
        });
      }

      // Process coupon usage if coupon was applied
      if (couponUsed) {
        try {
          const coupon = await Coupon.findById(couponUsed);
          if (coupon) {
            await coupon.useCoupon(
              userId, 
              orderId, 
              productType, 
              productId, 
              discountApplied
            );
            
            logger.info('Coupon usage recorded successfully', {
              couponCode: coupon.code,
              couponId: coupon._id,
              userId: userId.toString(),
              orderId,
              paymentId,
              discountApplied,
              productType,
              productId: productId.toString()
            });
          } else {
            logger.warn('Coupon not found during payment verification', {
              couponId: couponUsed,
              orderId,
              paymentId
            });
          }
        } catch (couponError) {
          logger.error('Failed to record coupon usage', {
            error: couponError.message,
            stack: couponError.stack,
            couponId: couponUsed,
            orderId,
            paymentId,
            userId: userId.toString()
          });
          // Don't fail payment verification due to coupon tracking error
        }
      }

      // Compute expiry and compensation
      let expiryDate;
      let compensationDays = 0;
      if (isRenewal === "true" && existingSubscriptionId) {
        const existing = await Subscription.findById(existingSubscriptionId);
        if (existing && existing.expiresAt > new Date()) {
          const comp = calculateCompensatedEndDate(planType, existing.expiresAt);
          expiryDate = comp.endDate;
          compensationDays = comp.compensationDays;
        } else {
          expiryDate = calculateEndDate(planType);
        }
      } else {
        expiryDate = calculateEndDate(planType);
      }

      if (productType === "Bundle") {
        // Bundle processing logic
        const bundle = await Bundle.findById(productId).populate("portfolios");
        if (!bundle) throw new Error("Bundle not found");

        const portfolios = bundle.portfolios || [];
        if (portfolios.length > 0) {
          const amountPer = finalAmount / portfolios.length; // Use final amount after discount
          const originalAmountPer = originalAmount / portfolios.length;
          const discountPer = discountApplied / portfolios.length;
          
          // Cancel old if renewal
          if (isRenewal === "true" && existingSubscriptionId) {
            await Subscription.updateMany(
              { user: userId, productType: "Portfolio", productId: { $in: portfolios.map(p => p._id) }, status: "active" },
              { status: "cancelled", cancelledAt: new Date(), cancelReason: "Renewed" },
              { session }
            );
          }
          
          // Create subscriptions for each portfolio
          for (let i = 0; i < portfolios.length; i++) {
            const port = portfolios[i];
            const newSub = await Subscription.findOneAndUpdate(
              { user: userId, productType: "Portfolio", productId: port._id, type: "one_time" },
              {
                user: userId,
                productType: "Portfolio",
                productId: port._id,
                portfolio: port._id,
                type: "one_time",
                status: "active",
                amount: amountPer,
                originalAmount: originalAmountPer,
                discountApplied: discountPer,
                category: bundle.category,
                planType,
                expiresAt: expiryDate,
                paymentId,
                orderId,
                isRenewal: isRenewal === "true",
                compensationDays,
                previousSubscriptionId: existingSubscriptionId || null,
                couponUsed: couponUsed || null
              },
              { upsert: true, new: true, session }
            );
            newSubscriptions.push(newSub);
            
            await PaymentHistory.create([{
              user: userId,
              subscription: null,
              portfolio: port._id,
              amount: amountPer,
              paymentId: `${paymentId}_port_${i}`,
              orderId,
              signature,
              status: "VERIFIED",
              description: `Bundle payment - ${bundle.name} (${couponCode ? `Coupon: ${couponCode}` : 'No coupon'})`
            }], { session });
          }
        } else {
          // Bundle without portfolios
          if (isRenewal === "true" && existingSubscriptionId) {
            await Subscription.findByIdAndUpdate(
              existingSubscriptionId,
              { status: "cancelled", cancelledAt: new Date(), cancelReason: "Renewed" },
              { session }
            );
          }
          
          const sub = await Subscription.findOneAndUpdate(
            { user: userId, productType: "Bundle", productId, type: "one_time" },
            {
              user: userId,
              productType: "Bundle",
              productId,
              bundleId: productId,
              type: "one_time",
              status: "active",
              amount: finalAmount,
              originalAmount: originalAmount,
              discountApplied: discountApplied,
              category: bundle.category,
              planType,
              expiresAt: expiryDate,
              paymentId,
              orderId,
              isRenewal: isRenewal === "true",
              compensationDays,
              previousSubscriptionId: existingSubscriptionId || null,
              couponUsed: couponUsed || null
            },
            { upsert: true, new: true, session }
          );
          newSubscriptions.push(sub);
          
          await PaymentHistory.create([{
            user: userId,
            subscription: sub._id,
            portfolio: null,
            amount: finalAmount,
            paymentId,
            orderId,
            signature,
            status: "VERIFIED",
            description: `Bundle (${bundle.name}) payment (${couponCode ? `Coupon: ${couponCode}` : 'No coupon'})`
          }], { session });
        }

        responseData = {
          success: true,
          message: `Bundle payment verified${isRenewal ? " (Renewal)" : ""}${couponCode ? ` with coupon ${couponCode}` : ""}`,
          category: bundle.category,
          isRenewal: isRenewal === "true",
          compensationDays,
          originalAmount,
          discountApplied,
          finalAmount,
          savings: discountApplied
        };
        
      } else {
        // Single portfolio
        if (isRenewal === "true" && existingSubscriptionId) {
          await Subscription.findByIdAndUpdate(
            existingSubscriptionId,
            { status: "cancelled", cancelledAt: new Date(), cancelReason: "Renewed" },
            { session }
          );
        }
        
        const newSub = await Subscription.findOneAndUpdate(
          { user: userId, productType, productId, type: "one_time" },
          {
            user: userId,
            productType,
            productId,
            portfolio: productType === "Portfolio" ? productId : null,
            type: "one_time",
            status: "active",
            amount: finalAmount,
            originalAmount: originalAmount,
            discountApplied: discountApplied,
            category: notes.category,
            planType,
            expiresAt: expiryDate,
            paymentId,
            orderId,
            isRenewal: isRenewal === "true",
            compensationDays,
            previousSubscriptionId: existingSubscriptionId || null,
            couponUsed: couponUsed || null
          },
          { upsert: true, new: true, session }
        );
        newSubscriptions.push(newSub);
        
        await PaymentHistory.create([{
          user: userId,
          subscription: newSub._id,
          portfolio: productType === "Portfolio" ? productId : null,
          amount: finalAmount,
          paymentId,
          orderId,
          signature,
          status: "VERIFIED",
          description: `${productType} payment${isRenewal ? " (Renewal)" : ""} (${couponCode ? `Coupon: ${couponCode}` : 'No coupon'})`
        }], { session });

        responseData = {
          success: true,
          message: `${productType} payment verified${isRenewal ? " (Renewal)" : ""}${couponCode ? ` with coupon ${couponCode}` : ""}`,
          subscriptionId: newSub._id,
          category: notes.category,
          isRenewal: isRenewal === "true",
          compensationDays,
          originalAmount,
          discountApplied,
          finalAmount,
          savings: discountApplied
        };
      }

      // Add coupon details to response if coupon was used
      if (couponCode) {
        responseData.couponUsed = {
          code: couponCode,
          discountApplied,
          savings: discountApplied
        };
      }
    }

    await session.commitTransaction();
    
    // Generate and send bill for the subscription
    try {
      if (newSubscriptions && newSubscriptions.length > 0) {
        logger.info('Starting bill generation process', {
          subscriptionId: newSubscriptions[0]._id,
          paymentId,
          orderId,
          subscriptionCount: newSubscriptions.length,
          couponCode: notes.couponCode || 'none',
          discountApplied: notes.discountApplied || 0,
          isCartCheckout: notes.cartCheckout === "true"
        });
        
        // Ensure we generate a bill number before sending the bill
        const billNumber = await require('../services/billService').generateBillNumber();
        
        const bill = await generateAndSendBill(newSubscriptions[0]._id, {
          paymentId,
          orderId,
          billNumber, // Explicitly provide bill number
          originalAmount: parseFloat(notes.originalAmount || notes.originalTotal) || 0,
          discountApplied: parseFloat(notes.discountApplied) || 0,
          finalAmount: parseFloat(notes.finalAmount || notes.finalTotal) || 0,
          couponCode: notes.couponCode,
          isCartCheckout: notes.cartCheckout === "true"
        });
        
        logger.info('Bill generated and sent successfully', {
          subscriptionId: newSubscriptions[0]._id,
          billId: bill._id,
          billNumber: bill.billNumber,
          paymentId,
          orderId,
          couponCode: notes.couponCode || 'none'
        });
        
        // Add bill info to response
        responseData.billGenerated = true;
        responseData.billNumber = bill.billNumber;
      } else {
        logger.warn('No subscriptions found for bill generation', {
          paymentId,
          orderId
        });
      }
    } catch (billError) {
      logger.error('Failed to generate bill', {
        subscriptionId: newSubscriptions[0]?._id,
        error: billError.message,
        stack: billError.stack,
        paymentId,
        orderId
      });
      // Don't fail the payment verification if bill generation fails
      responseData.billGenerated = false;
      responseData.billError = billError.message;
    }
    
    // Enhanced Telegram integration
    if (notes.cartCheckout === "true") {
      // For cart checkout, handle Telegram for each portfolio subscription
      const allTelegramInvites = [];
      for (const subscription of newSubscriptions) {
        try {
          const telegramInvites = await handleTelegramIntegration(
            req.user, 
            "Portfolio", 
            subscription.productId, 
            subscription
          );
          allTelegramInvites.push(...telegramInvites);
        } catch (error) {
          logger.error('Telegram integration error for cart item', {
            subscriptionId: subscription._id,
            portfolioId: subscription.productId,
            error: error.message
          });
        }
      }
      
      if (allTelegramInvites.length > 0) {
        responseData.telegramInviteLinks = allTelegramInvites;
        responseData.telegramMessage = `You have access to ${allTelegramInvites.length} Telegram group${allTelegramInvites.length > 1 ? 's' : ''}. Check your email for invite links.`;
      }
    } else if (notes.productType === "Bundle") {
      // For bundle one-time payments, generate invite for each portfolio subscription created
      const bundleInvites = [];
      for (const subscription of newSubscriptions) {
        if (subscription.productType === "Portfolio") {
          try {
            const invites = await handleTelegramIntegration(
              req.user,
              "Portfolio",
              subscription.productId,
              subscription
            );
            bundleInvites.push(...invites);
          } catch (error) {
            logger.error('Telegram integration error for bundle item', {
              subscriptionId: subscription._id,
              portfolioId: subscription.productId,
              error: error.message
            });
          }
        }
      }
      if (bundleInvites.length > 0) {
        responseData.telegramInviteLinks = bundleInvites;
        responseData.telegramMessage = `You have access to ${bundleInvites.length} Telegram group${bundleInvites.length > 1 ? 's' : ''}. Check your email for invite links.`;
      }
    } else {
      // Single portfolio purchase
      const telegramInvites = await handleTelegramIntegration(
        req.user,
        notes.productType,
        notes.productId,
        newSubscriptions[0]
      );
      if (telegramInvites && telegramInvites.length > 0) {
        responseData.telegramInviteLinks = telegramInvites;
        responseData.telegramMessage = `You have access to ${telegramInvites.length} Telegram group${telegramInvites.length > 1 ? 's' : ''}. Check your email for invite links.`;
      }
    }

    // Update user premium status
    await updateUserPremiumStatus(req.user._id);

    // Mark any existing DigioSign records for this user+product as expired so resubscribe requires a fresh eSign
    try {
      const subRef = newSubscriptions && newSubscriptions.length > 0 ? newSubscriptions[0] : null;
      if (subRef) {
        await DigioSign.updateMany({
          userId: req.user._id,
          productType: subRef.productType,
          productId: subRef.productId,
          status: { $in: ['signed', 'completed'] }
        }, { status: 'expired', lastWebhookAt: new Date() });
      }
    } catch (e) {
      logger.warn('Failed to update DigioSign records after payment verification', { error: e.message });
    }
    
    logger.info('Payment verification completed successfully with coupon support', {
      userId: userId.toString(),
      paymentId,
      orderId,
      originalAmount: notes.originalAmount || notes.originalTotal || 0,
      discountApplied: notes.discountApplied || 0,
      finalAmount: notes.finalAmount || notes.finalTotal || 0,
      couponCode: notes.couponCode || 'none',
      isCartCheckout: notes.cartCheckout === "true",
      subscriptionsCreated: newSubscriptions.length
    });
    
    return res.json(responseData);
    
  } catch (error) {
    await session.abortTransaction();
    
    logger.error("Error in verifyPayment:", {
      error: error.message,
      stack: error.stack,
      paymentId: req.body.paymentId,
      orderId: req.body.orderId,
      userId: req.user?._id?.toString()
    });
    
    if (error.code === 11000) {
      return res.status(409).json({ success: false, error: "Duplicate subscription" });
    }
    
    return res.status(500).json({ 
      success: false, 
      error: error.message || "Payment verification failed" 
    });
  } finally {
    session.endSession();
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
      return res.status(400).json({ success: false, error: "Subscription ID required" });
    }

    const razorpay = await getRazorpayInstance();
    const rSub = await razorpay.subscriptions.fetch(subscription_id);
    const userId = req.user._id;

    // Ownership & existence check
    if (!rSub || !rSub.notes || rSub.notes.user_id !== userId.toString()) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }
    
    const existingSubs = await Subscription.find({ razorpaySubscriptionId: subscription_id });
    if (!existingSubs.length) {
      return res.status(404).json({ success: false, error: "No matching subscriptions" });
    }

    const status = rSub.status;
    const isRenewal = rSub.notes.isRenewal === "true";
    const existingId = rSub.notes.existingSubscriptionId;
    
    // Extract coupon information from Razorpay notes
    const couponCode = rSub.notes.couponCode;
    const couponUsed = rSub.notes.couponUsed;
    const originalAmount = parseFloat(rSub.notes.originalAmount) || 0;
    const discountApplied = parseFloat(rSub.notes.discountApplied) || 0;
    const finalAmount = parseFloat(rSub.notes.finalAmount) || 0;
    const emandateType = rSub.notes.emandate_type || "monthly";
    
    let activatedCount = 0;
    let telegramInviteLinks = [];

    if (["authenticated", "active"].includes(status)) {
      const session = await mongoose.startSession();
      
      try {
        await session.withTransaction(async () => {
          // Cancel old if renewal
          if (isRenewal && existingId) {
            await Subscription.findByIdAndUpdate(
              existingId,
              { status: "cancelled", cancelledAt: new Date(), cancelReason: "Renewed via eMandate" },
              { session }
            );
          }

          const update = await Subscription.updateMany(
            { razorpaySubscriptionId: subscription_id, user: userId },
            { status: "active", lastPaymentAt: new Date() },
            { session }
          );
          activatedCount = update.modifiedCount;
          
          // Process coupon usage if coupon was applied to eMandate
          if (couponUsed) {
            try {
              const coupon = await Coupon.findById(couponUsed);
              if (coupon) {
                await coupon.useCoupon(
                  userId,
                  subscription_id, // Use subscription ID as order ID for eMandate
                  rSub.notes.product_type,
                  rSub.notes.product_id,
                  discountApplied
                );
                
                logger.info('Coupon usage recorded for eMandate activation', {
                  couponCode: coupon.code,
                  couponId: coupon._id,
                  userId: userId.toString(),
                  subscriptionId: subscription_id,
                  discountApplied,
                  productType: rSub.notes.product_type,
                  productId: rSub.notes.product_id
                });
              }
            } catch (couponError) {
              logger.error('Failed to record coupon usage for eMandate', {
                error: couponError.message,
                stack: couponError.stack,
                couponId: couponUsed,
                subscriptionId: subscription_id,
                userId: userId.toString()
              });
              // Don't fail eMandate verification due to coupon tracking error
            }
          }
        });
      } finally {
        await session.endSession();
      }

      // Generate Telegram invites for portfolio subscriptions
      for (const sub of existingSubs) {
        if (sub.productType === "Portfolio") {
          try {
            const product = await Portfolio.findById(sub.productId);
            if (product && product.externalId) {
              const inviteResult = await TelegramService.generateInviteLink(req.user, product, sub);
              if (inviteResult.success) {
                // Update subscription
                await Subscription.findByIdAndUpdate(sub._id, {
                  invite_link_url: inviteResult.invite_link,
                  invite_link_expires_at: inviteResult.expires_at
                });
                
                // Add to response
                telegramInviteLinks.push({
                  productId: sub.productId,
                  invite_link: inviteResult.invite_link,
                  expires_at: inviteResult.expires_at
                });
                
                // Send email
                await sendTelegramInviteEmail(
                  req.user, 
                  product, 
                  inviteResult.invite_link, 
                  inviteResult.expires_at
                );
                
                logger.info('Telegram invite sent for eMandate, bill email will be queued separately', {
                  subscriptionId: sub._id,
                  userEmail: req.user.email
                });
              }
            }
          } catch (error) {
            logger.error('Telegram integration error:', {
              subscriptionId: sub._id,
              error: error.message
            });
          }
        }
      }

      // Generate bills for activated subscriptions
      let billsGenerated = 0;
      for (const sub of existingSubs) {
        try {
          logger.info('Starting eMandate bill generation with coupon info', {
            subscriptionId: sub._id,
            razorpaySubscriptionId: subscription_id,
            couponCode: couponCode || 'none',
            discountApplied
          });
          
          const bill = await generateAndSendBill(sub._id, {
            paymentId: null, // eMandate doesn't have immediate payment ID
            orderId: null,
            subscriptionId: subscription_id,
            originalAmount: originalAmount,
            discountApplied,
            finalAmount: finalAmount,
            couponCode
          });
          
          logger.info('Bill generated for eMandate subscription with coupon info', {
            subscriptionId: sub._id,
            billId: bill._id,
            billNumber: bill.billNumber,
            razorpaySubscriptionId: subscription_id,
            couponCode: couponCode || 'none'
          });
          
          billsGenerated++;
        } catch (billError) {
          logger.error('Failed to generate bill for eMandate subscription', {
            subscriptionId: sub._id,
            error: billError.message,
            stack: billError.stack,
            razorpaySubscriptionId: subscription_id
          });
        }
      }
      
      logger.info(`Generated ${billsGenerated} bills for eMandate activation`, {
        razorpaySubscriptionId: subscription_id,
        totalSubscriptions: existingSubs.length,
        couponCode: couponCode || 'none'
      });

      // Renewal emails
      if (isRenewal) {
        const user = await User.findById(userId);
        for (const sub of existingSubs) {
          const portfolio = sub.productType === "Portfolio" ? 
            await Portfolio.findById(sub.portfolio) : null;
          await sendRenewalConfirmationEmail(user, sub, portfolio, sub.compensationDays || 0);
        }
      }

      await updateUserPremiumStatus(userId);
      
      const responseData = {
        success: true,
        message: `eMandate ${status}. Activated ${activatedCount} subscriptions${isRenewal ? " (Renewal)" : ""}${couponCode ? ` with coupon ${couponCode}` : ""}`,
        subscriptionStatus: status,
        activatedSubscriptions: activatedCount,
        isRenewal,
        telegramInviteLinks,
        requiresAction: ["pending", "created"].includes(status)
      };

      // Add coupon information to response
      if (couponCode) {
        responseData.couponUsed = {
          code: couponCode,
          originalAmount,
          discountApplied,
          finalAmount,
          savings: discountApplied
        };
      }

      return res.json(responseData);
    }

    // Cancelled/expired
    if (["halted", "cancelled", "expired"].includes(status)) {
      await Subscription.updateMany(
        { razorpaySubscriptionId: subscription_id, user: userId },
        { status: "cancelled" }
      );
      
      // Kick users from Telegram groups
      for (const sub of existingSubs) {
        if (sub.user) {
            const user = await User.findById(sub.user);
            const product = await Portfolio.findById(sub.productId) || await Bundle.findById(sub.productId);
            if (user && product && product.externalId) {
                try {
                    await TelegramService.kickUser(user._id, sub.productId);
                    logger.info(`Kicked user ${user.email} from product ${product.externalId}`);
                } catch (error) {
                    logger.error(`Failed to kick user ${user.email}:`, error);
                }
            }
        }
      }
      
      await updateUserPremiumStatus(userId);
      return res.json({ 
        success: false, 
        message: `Subscription ${status}.`, 
        subscriptionStatus: status 
      });
    }

    // Pending states
    if (["pending_authentication", "pending", "created"].includes(status)) {
      // Send pending authentication email
      const user = await User.findById(userId);
      if (user) {
        const subject = `Action Required: eMandate Subscription Pending`;
        const text = `Your eMandate subscription is pending authentication. Please complete the process to activate your subscription.`;
        const html = `
          <div style="max-width:600px; margin:0 auto; padding:20px; font-family:sans-serif;">
            <h2 style="color:#4a77e5;">Action Required: eMandate Subscription Pending</h2>
            <p>Dear ${user.fullName || user.username},</p>
            <p>Your eMandate subscription is currently pending authentication. Please complete the process to activate your subscription.</p>
            ${couponCode ? `<p><strong>Coupon Applied:</strong> ${couponCode} (₹${discountApplied} discount)</p>` : ''}
            <p>Subscription ID: <strong>${subscription_id}</strong></p>
            <p>To complete the authentication, please visit:</p>
            <p><a href="${rSub.short_url}" style="color:#4a77e5;">Complete Authentication</a></p>  
            <hr style="margin:30px 0; border:none; border-top:1px solid #eee;">
            <p style="color:#666; font-size:12px;">Automated notification</p>
          </div>
        `;
        await emailQueue.addEmail({
          to: user.email,
          subject,
          text,
          html,
          type: 'emandate_pending',
          userId: user._id,
          metadata: {
            subscriptionId: subscription_id,
            authenticationUrl: rSub.short_url,
            status,
            couponCode: couponCode || null,
            discountApplied
          }
        });
        
        logger.info(`eMandate pending email queued for ${user.email}`, {
          userId: user._id,
          subscriptionId: subscription_id,
          status,
          couponCode: couponCode || 'none'
        });
      }

      const responseData = {
        success: false,
        message: `Subscription in ${status} state.`,
        subscriptionStatus: status,
        requiresAction: true,
        authenticationUrl: rSub.short_url
      };

      // Add coupon information to response if available
      if (couponCode) {
        responseData.couponWillBeApplied = {
          code: couponCode,
          originalAmount,
          discountApplied,
          finalAmount,
          savings: discountApplied
        };
      }

      return res.json(responseData);
    }

    // Unknown state
    return res.status(400).json({
      success: false,
      error: `Unknown subscription status: ${status}`
    });
    
  } catch (error) {
    logger.error("Error in verifyEmandate:", {
      error: error.message,
      stack: error.stack,
      subscription_id: req.body.subscription_id,
      userId: req.user?._id?.toString()
    });
    
    return res.status(500).json({ 
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
    }).populate('portfolio');
    
    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: 'Subscription not found'
      });
    }
    
    // Cancel recurring in Razorpay
    if (subscription.type === 'recurring' && subscription.razorpaySubscriptionId) {
      try {
        const razorpay = await getRazorpayInstance();
        await razorpay.subscriptions.cancel(subscription.razorpaySubscriptionId, {
          cancel_at_cycle_end: false
        });
      } catch (error) {
        logger.error('Razorpay cancellation error', {
          subscriptionId: subscription._id,
          error: error.message
        });
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
      { status: 'cancelled', cancelledAt: new Date() }
    );
    
    // Kick user from Telegram if applicable
    if (subscription.user) {
        const user = await User.findById(subscription.user);
        const product = await Portfolio.findById(subscription.productId) || await Bundle.findById(subscription.productId);
        if (user && product && product.externalId) {
            try {
                const kickResult = await TelegramService.kickUser(user._id, subscription.productId);
                
                if (kickResult.success) {
                    logger.info(`Kicked Telegram user ${user.email} from product ${product.externalId}`);
                } else {
                    logger.warn(`Failed to kick Telegram user ${user.email}: ${kickResult.error}`);
                }
            } catch (error) {
                logger.error('Telegram kick error on cancellation', {
                subscriptionId: subscription._id,
                error: error.message
                });
            }
        }
    }
    
    // Send cancellation confirmation
    if (subscription.portfolio) {
      await sendCancellationEmail(req.user, subscription, subscription.portfolio);
    }
    
    // Update user premium status
    await updateUserPremiumStatus(req.user._id);
    
    res.json({
      success: true,
      message: 'Subscription cancelled successfully',
      cancelledSubscriptions: updateResult.nModified
    });
    
  } catch (error) {
    logger.error('Error in cancelSubscription', {
      error: error.message,
      stack: error.stack,
      subscriptionId: req.params.subscriptionId
    });
    
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to cancel subscription'
    });
  }
};

async function sendCancellationEmail(user, subscription, portfolio) {
  try {
    const subject = `Subscription Cancelled - ${portfolio.name}`;
    const text = `Your subscription to ${portfolio.name} has been cancelled.`;
    const html = `
      <div style="max-width:600px; margin:0 auto; padding:20px; font-family:sans-serif;">
        <h2 style="color:#e74c3c;">Subscription Cancelled</h2>
        <p>Dear ${user.fullName || user.username},</p>
        <p>Your subscription to <strong>${portfolio.name}</strong> has been successfully cancelled.</p>
        
        <div style="background-color:#f8f9fa; padding:15px; border-radius:5px; margin:20px 0;">
          <h3 style="color:#e74c3c; margin-top:0;">Details:</h3>
          <p><strong>Portfolio:</strong> ${portfolio.name}</p>
          <p><strong>Cancellation Date:</strong> ${new Date().toLocaleDateString()}</p>
          <p><strong>Access Ends:</strong> ${subscription.expiresAt.toLocaleDateString()}</p>
        </div>
        
        <p>You will retain access until your subscription expiration date. 
        If you wish to resubscribe, you can do so at any time.</p>
        
        <hr style="margin:30px 0; border:none; border-top:1px solid #eee;">
        <p style="color:#666; font-size:12px;">This is an automated notification.</p>
      </div>
    `;
    
    await emailQueue.addEmail({
      to: user.email,
      subject,
      text,
      html,
      type: 'subscription_cancellation',
      userId: user._id,
      metadata: {
        portfolioId: portfolio._id,
        portfolioName: portfolio.name,
        subscriptionId: subscription._id
      }
    });
    
    logger.info(`Cancellation email queued for ${user.email}`, {
      userId: user._id,
      portfolioName: portfolio.name
    });
  } catch (error) {
    logger.error('Failed to send cancellation email', {
      userId: user._id,
      error: error.message
    });
  }
}
/**
 * Razorpay webhook handler with robust error handling and timeout protection
 */
exports.razorpayWebhook = async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Set a timeout for webhook processing (30 seconds)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Webhook processing timeout')), 30000);
    });
    
    const processingPromise = processWebhook(req);
    
    // Race between processing and timeout
    await Promise.race([processingPromise, timeoutPromise]);
    
    const processingTime = Date.now() - startTime;
    logger.info(`Webhook processed successfully in ${processingTime}ms`);
    
    res.json({ success: true });
  } catch(error) {
    const processingTime = Date.now() - startTime;
    logger.error("Webhook processing error", {
      error: error.message,
      stack: error.stack,
      event: req.body?.event,
      processingTime: `${processingTime}ms`
    });
    
    if (error.message === 'Webhook processing timeout') {
      res.status(408).json({ error: "Request timeout" });
    } else {
      res.status(500).json({ error: "Webhook processing failed" });
    }
  }
};

/**
 * Internal webhook processing function
 */
async function processWebhook(req) {
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
      throw new Error("Invalid webhook signature");
    }
  }

  const { event, payload } = req.body;

  // Log webhook received
  logger.info(`Webhook received: ${event}`, {
    event,
    payloadKeys: Object.keys(payload || {}),
    timestamp: new Date().toISOString()
  });

  // Add delay for processing to avoid race conditions
  await new Promise(resolve => setTimeout(resolve, 2000));

  switch(event) {
    case "subscription.activated":
    case "subscription.authenticated":
      await handleSubscriptionActivatedWithRetry(payload);
      break;
    case "subscription.charged":
      await handleSubscriptionChargedWithRetry(payload);
      break;
    case "subscription.cancelled":
    case "subscription.halted":
      await handleSubscriptionCancelledWithRetry(payload);
      break;
    case "payment.failed":
      await handlePaymentFailedWithRetry(payload);
      break;
    default:
      logger.info(`Unhandled webhook event: ${event}`);
  }
}

// ===== WEBHOOK HANDLERS WITH RETRY =====

/**
 * Wrapper for subscription activated with retry logic
 */
async function handleSubscriptionActivatedWithRetry(payload, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await handleSubscriptionActivated(payload);
      logger.info(`Subscription activation handled successfully on attempt ${attempt}`);
      return;
    } catch (error) {
      logger.error(`Subscription activation attempt ${attempt} failed`, {
        error: error.message,
        payload: JSON.stringify(payload, null, 2)
      });
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Wrapper for subscription charged with retry logic
 */
async function handleSubscriptionChargedWithRetry(payload, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await handleSubscriptionCharged(payload);
      logger.info(`Subscription charged handled successfully on attempt ${attempt}`);
      return;
    } catch (error) {
      logger.error(`Subscription charged attempt ${attempt} failed`, {
        error: error.message,
        payload: JSON.stringify(payload, null, 2)
      });
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Wrapper for subscription cancelled with retry logic
 */
async function handleSubscriptionCancelledWithRetry(payload, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await handleSubscriptionCancelled(payload);
      logger.info(`Subscription cancelled handled successfully on attempt ${attempt}`);
      return;
    } catch (error) {
      logger.error(`Subscription cancelled attempt ${attempt} failed`, {
        error: error.message,
        payload: JSON.stringify(payload, null, 2)
      });
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Wrapper for payment failed with retry logic
 */
async function handlePaymentFailedWithRetry(payload, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await handlePaymentFailed(payload);
      logger.info(`Payment failed handled successfully on attempt ${attempt}`);
      return;
    } catch (error) {
      logger.error(`Payment failed attempt ${attempt} failed`, {
        error: error.message,
        payload: JSON.stringify(payload, null, 2)
      });
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

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
  
  // Generate and send bill for the first subscription (all subscriptions in a charge event are for same user)
  try {
    const firstSubscription = subscriptions[0];
    await generateAndSendBill(firstSubscription._id, {
      amount: totalAmount / 100,
      paymentId,
      transactionType: 'webhook_recurring',
      description: 'Recurring payment via webhook'
    });
    logger.info(`Bill generated and queued for webhook payment`, {
      userId,
      subscriptionId: firstSubscription._id,
      paymentId
    });
  } catch (billError) {
    logger.error(`Failed to generate bill for webhook payment`, {
      userId,
      paymentId,
      error: billError.message,
      stack: billError.stack
    });
    // Don't throw error here as payment processing was successful
  }
  
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
  logger.error("Payment failed webhook received", {
    payload: JSON.stringify(payload, null, 2),
    timestamp: new Date().toISOString()
  });
  
  try {
    const paymentId = payload.payment?.entity?.id;
    const subscriptionId = payload.subscription?.id;
    const userId = payload.subscription?.notes?.user_id;
    const errorCode = payload.payment?.entity?.error_code;
    const errorDescription = payload.payment?.entity?.error_description;
    
    if (userId && subscriptionId) {
      // Update subscription status to failed
      await Subscription.updateMany(
        { razorpaySubscriptionId: subscriptionId, user: userId },
        { 
          status: "payment_failed",
          lastPaymentError: {
            code: errorCode,
            description: errorDescription,
            failedAt: new Date(),
            paymentId
          }
        }
      );
      
      // Send failure notification email
      const user = await User.findById(userId);
      if (user) {
        await sendPaymentFailureEmail(user, subscriptionId, errorCode, errorDescription);
      }
      
      logger.info("Updated subscription status for payment failure", {
        userId,
        subscriptionId,
        errorCode,
        errorDescription
      });
    }
  } catch (error) {
    logger.error("Error handling payment failure webhook", {
      error: error.message,
      stack: error.stack
    });
  }
}

async function sendPaymentFailureEmail(user, subscriptionId, errorCode, errorDescription) {
  try {
    const subject = "Payment Failed - Action Required";
    const text = `Your subscription payment failed. Please update your payment method or contact support.`;
    const html = `
      <div style="max-width:600px; margin:0 auto; padding:20px; font-family:sans-serif;">
        <h2 style="color:#e74c3c;">Payment Failed</h2>
        <p>Dear ${user.fullName || user.username},</p>
        <p>We were unable to process your subscription payment.</p>
        
        <div style="background-color:#f8f9fa; padding:15px; border-radius:5px; margin:20px 0;">
          <h3 style="color:#e74c3c; margin-top:0;">Details:</h3>
          <p><strong>Subscription ID:</strong> ${subscriptionId}</p>
          <p><strong>Error:</strong> ${errorDescription || 'Payment processing failed'}</p>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
        </div>
        
        <div style="margin:30px 0;">
          <a href="${process.env.FRONTEND_URL}/subscription/retry" style="background-color:#4a77e5; color:white; padding:12px 24px; text-decoration:none; border-radius:5px; display:inline-block;">Retry Payment</a>
        </div>
        
        <p>Please contact support if you continue to experience issues.</p>
        
        <hr style="margin:30px 0; border:none; border-top:1px solid #eee;">
        <p style="color:#666; font-size:12px;">This is an automated notification.</p>
      </div>
    `;
    
    await emailQueue.addEmail({
      to: user.email,
      subject,
      text,
      html,
      type: 'payment_failure',
      userId: user._id,
      metadata: {
        subscriptionId,
        errorCode,
        errorDescription
      }
    });
    
    logger.info(`Payment failure email queued for ${user.email}`, {
      userId: user._id,
      subscriptionId,
      errorCode
    });
  } catch (error) {
    logger.error('Failed to send payment failure email', {
      userId: user._id,
      error: error.message
    });
  }
}

// ===== ADDITIONAL FUNCTIONS =====

/**
 * Cart checkout
 */
exports.checkoutCart = async (req, res) => {
  try {
    const { planType = "monthly", couponCode } = req.body;
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

    // Calculate original total amount
    let originalTotal = 0;
    const cartItems = [];
    
    for (const item of cart.items) {
      const portfolio = await Portfolio.findById(item.portfolio);
      if (!portfolio) {
        throw new Error(`Portfolio ${item.portfolio} not found`);
      }
      
      const plan = portfolio.subscriptionFee.find(fee => fee.type === planType);
      if (!plan) {
        throw new Error(`${planType} plan not found for portfolio`);
      }
      
      const itemTotal = plan.price * item.quantity;
      originalTotal += itemTotal;
      
      cartItems.push({
        portfolioId: item.portfolio,
        portfolioName: portfolio.name || portfolio.portfolioName,
        quantity: item.quantity,
        unitPrice: plan.price,
        totalPrice: itemTotal
      });
    }

    if (originalTotal <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid cart amount" 
      });
    }

    // ✨ NEW: Apply coupon if provided
    let finalTotal = originalTotal;
    let discountApplied = 0;
    let couponUsed = null;
    let couponDetails = null;

    if (couponCode) {
      try {
        const coupon = await Coupon.findOne({ code: couponCode.toUpperCase() });
        
        if (!coupon) {
          return res.status(404).json({
            success: false,
            error: 'Invalid coupon code'
          });
        }

        // Check if coupon is valid (active and not expired)
        if (!coupon.isValid) {
          let reason = 'Coupon is not valid';
          if (coupon.status !== 'active') {
            reason = 'Coupon is inactive';
          } else if (coupon.isExpired) {
            reason = 'Coupon has expired';
          } else {
            reason = 'Coupon is not yet active';
          }
          
          return res.status(400).json({
            success: false,
            error: reason
          });
        }

        // Check usage limit
        if (coupon.usageLimit !== -1 && coupon.usedCount >= coupon.usageLimit) {
          return res.status(400).json({
            success: false,
            error: 'Coupon usage limit exceeded'
          });
        }

        // Check if user can use this coupon
        const userCheck = coupon.canUserUseCoupon(req.user._id);
        if (!userCheck.canUse) {
          return res.status(400).json({
            success: false,
            error: userCheck.reason
          });
        }

        // Check if coupon applies to cart items
        // For cart, we need to check if coupon applies to all items or has applyToAll set
        let canApplyToCart = false;
        
        if (coupon.applicableProducts.applyToAll || 
            (coupon.applicableProducts.portfolios.length === 0 && 
             coupon.applicableProducts.bundles.length === 0)) {
          canApplyToCart = true;
        } else {
          // Check if all portfolio items in cart are covered by the coupon
          const cartPortfolioIds = cart.items.map(item => item.portfolio.toString());
          const applicablePortfolioIds = coupon.applicableProducts.portfolios.map(id => id.toString());
          
          canApplyToCart = cartPortfolioIds.every(portfolioId => 
            applicablePortfolioIds.includes(portfolioId)
          );
        }

        if (!canApplyToCart) {
          return res.status(400).json({
            success: false,
            error: 'Coupon is not applicable to one or more items in your cart'
          });
        }

        // Check for new users only restriction
        if (coupon.userRestrictions.newUsersOnly) {
          const hasAnySubscription = await Subscription.findOne({ user: req.user._id });
          if (hasAnySubscription) {
            return res.status(400).json({
              success: false,
              error: 'This coupon is only for new users'
            });
          }
        }

        // Calculate discount
        const discountResult = coupon.calculateDiscount(originalTotal);
        
        if (discountResult.reason) {
          return res.status(400).json({
            success: false,
            error: discountResult.reason
          });
        }

        // Apply discount
        finalTotal = discountResult.finalAmount;
        discountApplied = discountResult.discount;
        couponUsed = coupon._id;
        couponDetails = {
          code: coupon.code,
          title: coupon.title,
          description: coupon.description,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue
        };

        logger.info('Coupon applied successfully in cart checkout', {
          userId: req.user._id.toString(),
          couponCode: coupon.code,
          originalTotal,
          discountApplied,
          finalTotal,
          cartItemsCount: cart.items.length
        });

      } catch (couponError) {
        logger.error('Error processing coupon in cart checkout', {
          error: couponError.message,
          stack: couponError.stack,
          userId: req.user._id.toString(),
          couponCode
        });
        
        return res.status(500).json({
          success: false,
          error: 'Failed to process coupon. Please try again.'
        });
      }
    }

    // Validate final total
    if (finalTotal <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid final amount after discount'
      });
    }
    
    const razorpay = await getRazorpayInstance();
    const receipt = generateShortReceipt("cart", req.user._id);
    
    const order = await razorpay.orders.create({
      amount: Math.round(finalTotal * 100), // Use final total after discount
      currency: "INR",
      receipt,
      notes: { 
        userId: req.user._id.toString(), 
        cartCheckout: true, 
        planType,
        // Coupon related notes
        couponCode: couponCode || null,
        couponUsed: couponUsed?.toString() || null,
        originalTotal: originalTotal.toString(),
        discountApplied: discountApplied.toString(),
        finalTotal: finalTotal.toString(),
        // Cart items info for verification
        itemCount: cart.items.length.toString(),
        cartId: cart._id.toString()
      }
    });

    const responseData = {
      success: true,
      orderId: order.id,
      amount: order.amount, // This is in paisa (finalTotal * 100)
      currency: order.currency,
      planType,
      // Pricing breakdown
      originalTotal,
      discountApplied,
      finalTotal,
      savings: discountApplied,
      // Cart details
      itemCount: cart.items.length,
      items: cartItems
    };

    // Add coupon information to response
    if (couponDetails) {
      responseData.couponApplied = couponDetails;
      responseData.message = `Coupon "${couponDetails.code}" applied successfully! You saved ₹${discountApplied} on your cart total.`;
    }

    logger.info('Cart checkout order created successfully with coupon support', {
      userId: req.user._id.toString(),
      orderId: order.id,
      originalTotal,
      finalTotal,
      discountApplied,
      couponCode: couponCode || 'none',
      itemCount: cart.items.length
    });

    res.status(201).json(responseData);
    
  } catch (error) {
    logger.error("Cart checkout error", {
      error: error.message,
      stack: error.stack,
      userId: req.user._id?.toString(),
      couponCode: req.body.couponCode
    });
    
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
  logger.info("- Bill generation: Automatic on payment verification");
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
