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
const TelegramService = require("../services/tgservice");
const { generateAndSendBill, generateBillHTML } = require("../services/billService");
const { COMPANY_INFO } = require("../config/billConfig");
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

async function handleTelegramIntegration(user, productType, productId, subscription) {
  try {
    const telegramInvites = [];
    
    if (productType === 'Portfolio') {
      // Single portfolio telegram integration
      const telegramGroup = await TelegramService.getGroupMapping(productId);
      if (!telegramGroup) return [];
      
      const inviteResult = await TelegramService.generateInviteLink(productId);
      if (!inviteResult.success) {
        throw new Error('Telegram invite generation failed');
      }
      
      // Update subscription with Telegram info
      subscription.invite_link_url = inviteResult.invite_link;
      subscription.invite_link_expires_at = inviteResult.expires_at;
      await subscription.save();
      
      telegramInvites.push({
        portfolioId: productId,
        portfolioName: subscription.productId?.portfolioName || 'Portfolio',
        inviteLink: inviteResult.invite_link,
        expiresAt: inviteResult.expires_at
      });
      
    } else if (productType === 'Bundle') {
      // Bundle telegram integration - generate links for each portfolio
      const bundle = await Bundle.findById(productId).populate('portfolios');
      if (!bundle || !bundle.portfolios || bundle.portfolios.length === 0) {
        logger.warn('Bundle has no portfolios for telegram integration', { bundleId: productId });
        return [];
      }
      
      // Generate telegram invite for each portfolio in the bundle
      for (const portfolio of bundle.portfolios) {
        try {
          const telegramGroup = await TelegramService.getGroupMapping(portfolio._id);
          if (!telegramGroup) {
            logger.warn('No telegram group mapping for portfolio', { 
              portfolioId: portfolio._id,
              portfolioName: portfolio.portfolioName 
            });
            // Still add to the list but without invite link
            telegramInvites.push({
              portfolioId: portfolio._id,
              portfolioName: portfolio.portfolioName || 'Portfolio',
              inviteLink: null,
              expiresAt: null,
              error: 'No telegram group configured'
            });
            continue;
          }
          
          const inviteResult = await TelegramService.generateInviteLink(portfolio._id);
          if (inviteResult.success) {
            telegramInvites.push({
              portfolioId: portfolio._id,
              portfolioName: portfolio.portfolioName || 'Portfolio',
              inviteLink: inviteResult.invite_link,
              expiresAt: inviteResult.expires_at
            });
            
            logger.info('Generated telegram invite for portfolio in bundle', {
              bundleId: productId,
              portfolioId: portfolio._id,
              portfolioName: portfolio.portfolioName
            });
          } else {
            // Add failed portfolio to list with error info
            telegramInvites.push({
              portfolioId: portfolio._id,
              portfolioName: portfolio.portfolioName || 'Portfolio',
              inviteLink: null,
              expiresAt: null,
              error: inviteResult.message || 'Failed to generate invite link'
            });
            
            logger.warn('Failed to generate telegram invite for portfolio', {
              bundleId: productId,
              portfolioId: portfolio._id,
              portfolioName: portfolio.portfolioName,
              error: inviteResult.message
            });
          }
        } catch (portfolioError) {
          // Add failed portfolio to list with error info
          telegramInvites.push({
            portfolioId: portfolio._id,
            portfolioName: portfolio.portfolioName || 'Portfolio',
            inviteLink: null,
            expiresAt: null,
            error: portfolioError.message || 'Unknown error'
          });
          
          logger.error('Failed to generate telegram invite for portfolio', {
            bundleId: productId,
            portfolioId: portfolio._id,
            portfolioName: portfolio.portfolioName,
            error: portfolioError.message,
            stack: portfolioError.stack
          });
        }
      }
    }
    
    // Send invitation email with all telegram links
    if (telegramInvites.length > 0 && user.email) {
      try {
        const subject = `Telegram Access - ${productType === 'Bundle' ? 'Bundle' : 'Portfolio'} Subscription`;
        const htmlContent = generateTelegramInviteEmail(user, telegramInvites, productType);
        
        logger.info('Sending telegram invite email', {
          userId: user._id,
          email: user.email,
          inviteCount: telegramInvites.length
        });
        
        await sendEmail(user.email, subject, '', htmlContent);
        
        logger.info('Telegram invite email sent successfully', {
          userId: user._id,
          email: user.email
        });
        
        // Send bill email immediately after telegram email
        logger.info('Attempting to send bill email after telegram', {
          userId: user._id,
          email: user.email
        });
        
        try {
          await sendBillEmailAfterTelegram(user, subscription);
          logger.info('Bill email sent successfully after telegram', {
            userId: user._id,
            email: user.email
          });
        } catch (billError) {
          logger.error('Failed to send bill email after telegram', {
            userId: user._id,
            email: user.email,
            error: billError.message,
            stack: billError.stack
          });
        }
        
      } catch (emailError) {
        logger.error('Failed to send telegram invite email', {
          userId: user._id,
          email: user.email,
          error: emailError.message,
          stack: emailError.stack
        });
      }
    } else if (!user.email) {
      logger.warn('Cannot send telegram invite email - no user email', {
        userId: user._id
      });
    }
    
    return telegramInvites;
    
  } catch (error) {
    logger.error('Telegram integration error:', {
      userId: user._id,
      productType,
      productId,
      error: error.message,
      stack: error.stack
    });
    return [];
  }
}

// Helper function to send bill email using same email service
async function sendBillEmailAfterTelegram(user, subscription) {
  try {
    // Create a simple bill data structure
    const billData = {
      billNumber: `INV-${Date.now()}`,
      billDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      customerDetails: {
        name: user.fullName || user.username,
        email: user.email,
        phone: user.phone || '',
        address: user.address || ''
      },
      items: [{
        description: `Subscription - ${subscription.productType}`,
        planType: subscription.planType || 'monthly',
        quantity: 1,
        unitPrice: subscription.amount,
        totalPrice: subscription.amount
      }],
      subtotal: subscription.amount,
      taxRate: 18,
      taxAmount: Math.round(subscription.amount * 0.18),
      totalAmount: subscription.amount + Math.round(subscription.amount * 0.18),
      paymentStatus: 'paid',
      status: 'paid'
    };

    const subject = `Invoice ${billData.billNumber} - ${COMPANY_INFO.name}`;
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Invoice ${billData.billNumber}</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
          .invoice-container { max-width: 800px; margin: 0 auto; background: white; border-radius: 10px; box-shadow: 0 0 20px rgba(0,0,0,0.1); overflow: hidden; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; }
          .header-content { display: flex; justify-content: space-between; align-items: flex-start; }
          .company-info h1 { margin: 0 0 10px 0; font-size: 28px; font-weight: 700; }
          .company-info p { margin: 2px 0; opacity: 0.9; }
          .invoice-info { text-align: right; }
          .invoice-info h2 { margin: 0 0 15px 0; font-size: 32px; font-weight: 300; }
          .invoice-details { background: #f8f9ff; padding: 15px; border-radius: 8px; }
          .invoice-details p { margin: 3px 0; font-size: 14px; }
          .content { padding: 40px; }
          .bill-to { background: #f8f9fa; padding: 25px; border-radius: 8px; margin-bottom: 30px; border-left: 4px solid #667eea; }
          .bill-to h3 { margin: 0 0 15px 0; color: #667eea; font-size: 18px; }
          .items-table { width: 100%; border-collapse: collapse; margin: 30px 0; }
          .items-table th { background: #667eea; color: white; padding: 15px; text-align: left; font-weight: 600; }
          .items-table td { padding: 15px; border-bottom: 1px solid #eee; }
          .items-table tr:hover { background: #f8f9ff; }
          .totals { float: right; width: 300px; margin-top: 20px; }
          .totals table { width: 100%; }
          .totals td { padding: 10px 15px; border-bottom: 1px solid #eee; }
          .totals .subtotal { font-weight: 500; }
          .totals .tax { color: #666; }
          .totals .total { background: #667eea; color: white; font-weight: 700; font-size: 18px; }
          .payment-status { text-align: center; margin: 30px 0; }
          .status-paid { background: #d4edda; color: #155724; padding: 15px 30px; border-radius: 25px; display: inline-block; font-weight: 600; }
          .footer { background: #f8f9fa; padding: 30px; text-align: center; color: #666; border-top: 1px solid #eee; }
          .footer h4 { margin: 0 0 15px 0; color: #333; }
          @media print { body { background: white; } .invoice-container { box-shadow: none; } }
        </style>
      </head>
      <body>
        <div class="invoice-container">
          <div class="header">
            <div class="header-content">
              <div class="company-info">
                <h1>${COMPANY_INFO.name}</h1>
                <p>${COMPANY_INFO.address}</p>
                <p>${COMPANY_INFO.city}, ${COMPANY_INFO.state} ${COMPANY_INFO.pincode}</p>
                <p>Phone: ${COMPANY_INFO.phone}</p>
                <p>Email: ${COMPANY_INFO.email}</p>
                <p>GSTIN: ${COMPANY_INFO.gstin}</p>
              </div>
              <div class="invoice-info">
                <h2>INVOICE</h2>
                <div class="invoice-details">
                  <p><strong>Invoice #:</strong> ${billData.billNumber}</p>
                  <p><strong>Date:</strong> ${billData.billDate.toLocaleDateString('en-IN')}</p>
                  <p><strong>Due Date:</strong> ${billData.dueDate.toLocaleDateString('en-IN')}</p>
                </div>
              </div>
            </div>
          </div>
          
          <div class="content">
            <div class="bill-to">
              <h3>BILL TO:</h3>
              <p><strong>${billData.customerDetails.name}</strong></p>
              <p>${billData.customerDetails.email}</p>
              ${billData.customerDetails.phone ? `<p>Phone: ${billData.customerDetails.phone}</p>` : ''}
              ${billData.customerDetails.address ? `<p>${billData.customerDetails.address}</p>` : ''}
            </div>
            
            <table class="items-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Plan Type</th>
                  <th>Payment Method</th>
                  <th style="text-align: right;">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>${billData.items[0].description}</td>
                  <td>${subscription.productType === 'Bundle' ? 'Monthly/Yearly' : 'Quarterly/Yearly'}</td>
                  <td>eMandate (Recurring)</td>
                  <td style="text-align: right;">₹${billData.subtotal.toLocaleString('en-IN')}</td>
                </tr>
              </tbody>
            </table>
            
            <div class="totals">
              <table>
                <tr class="subtotal">
                  <td>Subtotal:</td>
                  <td style="text-align: right;">₹${billData.subtotal.toLocaleString('en-IN')}</td>
                </tr>
                <tr class="tax">
                  <td>GST (${billData.taxRate}%):</td>
                  <td style="text-align: right;">₹${billData.taxAmount.toLocaleString('en-IN')}</td>
                </tr>
                <tr class="total">
                  <td>Total Amount:</td>
                  <td style="text-align: right;">₹${billData.totalAmount.toLocaleString('en-IN')}</td>
                </tr>
              </table>
            </div>
            
            <div style="clear: both;"></div>
            
            <div class="payment-status">
              <span class="status-paid">✓ PAYMENT CONFIRMED - SUBSCRIPTION ACTIVE</span>
            </div>
          </div>
          
          <div class="footer">
            <h4>Thank you for your business!</h4>
            <p>This is a computer-generated invoice. For any queries, please contact us at ${COMPANY_INFO.email}</p>
            <p><strong>${COMPANY_INFO.name}</strong> | ${COMPANY_INFO.website}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const textContent = `
INVOICE ${billData.billNumber}

From: ${COMPANY_INFO.name}
To: ${billData.customerDetails.name}
Email: ${billData.customerDetails.email}

Description: ${billData.items[0].description}
Plan: ${subscription.productType === 'Bundle' ? 'Monthly/Yearly' : 'Quarterly/Yearly'} eMandate
Amount: ₹${billData.subtotal.toLocaleString('en-IN')}
GST (18%): ₹${billData.taxAmount.toLocaleString('en-IN')}
Total: ₹${billData.totalAmount.toLocaleString('en-IN')}

Status: PAID - Subscription Active

Thank you for your business!
${COMPANY_INFO.name}
    `;

    // Use the same email service as telegram emails
    await sendEmail(user.email, subject, textContent, htmlContent);
    
    logger.info('Bill email sent successfully after telegram', {
      userId: user._id,
      email: user.email,
      billNumber: billData.billNumber
    });
    
  } catch (error) {
    logger.error('Error sending bill email after telegram', {
      userId: user._id,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Helper function to generate telegram invite email
function generateTelegramInviteEmail(user, telegramInvites, productType) {
  const inviteLinks = telegramInvites.map(invite => {
    if (invite.inviteLink) {
      return `
        <div style="margin: 10px 0; padding: 10px; border: 1px solid #ddd; border-radius: 5px;">
          <h4>${invite.portfolioName}</h4>
          <p><a href="${invite.inviteLink}" style="background: #0088cc; color: white; padding: 8px 16px; text-decoration: none; border-radius: 4px;">Join Telegram Group</a></p>
          <p><small>Link expires: ${new Date(invite.expiresAt).toLocaleString()}</small></p>
        </div>
      `;
    } else {
      return `
        <div style="margin: 10px 0; padding: 10px; border: 1px solid #ffebcc; border-radius: 5px; background-color: #fff3cd;">
          <h4>${invite.portfolioName}</h4>
          <p style="color: #856404;"><strong>Note:</strong> ${invite.error || 'Telegram group not available for this portfolio'}</p>
          <p><small>Please contact support if you need access to this group</small></p>
        </div>
      `;
    }
  }).join('');
  
  const successCount = telegramInvites.filter(invite => invite.inviteLink).length;
  const totalCount = telegramInvites.length;
  
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Welcome to Your ${productType} Subscription!</h2>
      <p>Hi ${user.fullName || user.username || 'Valued Customer'},</p>
      <p>Your subscription has been activated successfully. Below is your Telegram access information:</p>
      ${successCount > 0 ? `<p><strong>✅ Available Telegram Groups (${successCount}/${totalCount}):</strong></p>` : ''}
      ${inviteLinks}
      ${successCount > 0 ? `
        <p><strong>Important:</strong> Please join the available groups using the links above. These links are time-limited and will expire as indicated.</p>
      ` : ''}
      ${successCount < totalCount ? `
        <p><strong>Note:</strong> Some portfolios in your bundle don't have telegram groups configured yet. Our team is working to set these up.</p>
      ` : ''}
      <p>If you have any questions, please contact our support team.</p>
      <p>Happy investing!</p>
    </div>
  `;
}

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
      case "quarterly": amount = product.monthlyemandateprice; break;
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

const createSubscriptionPlan = async (amountInPaisa) => {
  const razorpay = await getRazorpayInstance();
  
  // Validate amount
  if (!amountInPaisa || amountInPaisa < 100) {
    throw new Error(`Invalid plan amount: ₹${amountInPaisa/100}. Minimum ₹1 required.`);
  }
  
  if (amountInPaisa > 100000000) { // ₹10,00,000
    throw new Error(`Plan amount too high: ₹${amountInPaisa/100}. Maximum ₹10,00,000 allowed.`);
  }
  
  try {
    // Check for existing plans first
    logger.info("Checking for existing subscription plans", { amountInPaisa });
    
    const existingPlans = await razorpay.plans.all({ count: 100 });
    const found = existingPlans.items.find(p => 
      p.item.amount === amountInPaisa && 
      p.period === "monthly" && 
      p.interval === 1 &&
      p.item.currency === "INR"
    );
    
    if (found) {
      logger.info("Using existing subscription plan", {
        planId: found.id,
        amount: found.item.amount,
        period: found.period
      });
      return found;
    }
    
    logger.info("Creating new subscription plan", { amountInPaisa });
    
  } catch(planFetchError) {
    logger.warn("Error fetching existing plans, proceeding with creation", {
      error: planFetchError.message
    });
  }
  
  try {
    // Create new plan with enhanced metadata
    const planData = {
      period: "monthly",
      interval: 1,
      item: {
        name: `Monthly Subscription Plan - ₹${amountInPaisa/100}`,
        amount: amountInPaisa,
        currency: "INR",
        description: "Monthly billing for yearly commitment - Stock Portfolio Subscription",
      },
      notes: { 
        commitment: "yearly", 
        total_months: "12",
        created_at: new Date().toISOString(),
        plan_type: "emandate_monthly"
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
      interval: newPlan.interval
    });
    
    return newPlan;
    
  } catch (planCreateError) {
    logger.error("Failed to create subscription plan", {
      error: planCreateError.message,
      stack: planCreateError.stack,
      amountInPaisa,
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
 * ✨ ENHANCED: Supports renewal with compensation logic + Enhanced Error Handling
 */
exports.createEmandate = async (req, res) => {
  const { productType, productId } = req.body;
  const userId = req.user._id;
  
  try {
    // Validate required fields
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

    // Log emandate creation attempt
    logger.info("EMandate creation started", {
      userId: userId.toString(),
      productType,
      productId: productId.toString(),
      userEmail: req.user.email,
      timestamp: new Date().toISOString()
    });

    // ✨ ENHANCED: Check subscription status with renewal logic
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

    // Get product info with enhanced validation
    let product, yearlyAmount, category;
    try {
      const productInfo = await getProductInfo(productType, productId, "yearly");
      product = productInfo.product;
      yearlyAmount = productInfo.amount;
      category = productInfo.category;
      
      // Validate amount for emandate
      if (!yearlyAmount || yearlyAmount < 100) {
        throw new Error(`Invalid yearly amount: ${yearlyAmount}. Minimum ₹100 required for emandate.`);
      }
      
      if (yearlyAmount > 1000000) {
        throw new Error(`Amount too high: ₹${yearlyAmount}. Maximum ₹10,00,000 allowed for emandate.`);
      }
      
    } catch (error) {
      logger.error("EMandate creation failed: Product validation error", {
        userId: userId.toString(),
        productType,
        productId: productId.toString(),
        error: error.message
      });
      return res.status(400).json({
        success: false,
        error: error.message,
        code: "PRODUCT_VALIDATION_ERROR"
      });
    }

    const monthlyAmount = Math.round(yearlyAmount / 12);
    
    // Validate monthly amount
    if (monthlyAmount < 10) {
      logger.error("EMandate creation failed: Monthly amount too low", {
        userId: userId.toString(),
        yearlyAmount,
        monthlyAmount,
        productType,
        productId: productId.toString()
      });
      return res.status(400).json({
        success: false,
        error: `Monthly amount (₹${monthlyAmount}) is too low. Minimum ₹10 required.`,
        code: "AMOUNT_TOO_LOW"
      });
    }

    // Get Razorpay instance with error handling
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

    // Create or fetch customer with enhanced error handling
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

    // Create subscription plan with enhanced error handling
    let plan;
    try {
      plan = await createSubscriptionPlan(monthlyAmount * 100);
      
      if (!plan || !plan.id) {
        throw new Error("Failed to create subscription plan");
      }
      
      logger.info("Subscription plan created successfully", {
        userId: userId.toString(),
        planId: plan.id,
        monthlyAmount,
        planAmount: plan.item.amount
      });
      
    } catch (error) {
      logger.error("EMandate creation failed: Plan creation error", {
        userId: userId.toString(),
        monthlyAmount,
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
    commitmentEndDate.setFullYear(startDate.getFullYear() + 1);

    // ✨ ENHANCED: Apply compensation if renewing
    if (subscriptionStatus.canRenew) {
      const compensation = calculateCompensatedEndDate("yearly", subscriptionStatus.existingSubscription.expiresAt);
      commitmentEndDate.setTime(compensation.endDate.getTime());
    }

    // Validate dates with proper buffer time
    const now = Math.floor(Date.now() / 1000);
    const startAt = now + 300; // Start 5 minutes from now to avoid timing issues
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

    const subscriptionParams = {
      plan_id: plan.id,
      customer_id: customer.id,
      total_count: 12,
      quantity: 1,
      start_at: startAt,
      expire_by: expireBy,
      notes: {
        user_id: userId.toString(),
        product_type: productType,
        product_id: productId.toString(),
        category,
        isRenewal: subscriptionStatus.canRenew.toString(),
        existingSubscriptionId: subscriptionStatus.existingSubscription?._id?.toString() || null,
        created_at: new Date().toISOString(),
        user_email: req.user.email
      }
    };

    logger.info("Creating Razorpay subscription with params", {
      userId: userId.toString(),
      planId: plan.id,
      customerId: customer.id,
      totalCount: 12,
      startAt,
      expireBy,
      monthlyAmount,
      yearlyAmount
    });

    // Create Razorpay subscription with enhanced error handling
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
    
    // ✨ ENHANCED: Save to DB with compensation logic and enhanced error handling
    const session = await mongoose.startSession();
    let dbSubscriptions = [];
    
    try {
      await session.withTransaction(async () => {
        if (productType === "Bundle") {
          if (!product.portfolios || product.portfolios.length === 0) {
            throw new Error("Bundle has no portfolios associated");
          }
          
          for (const portfolio of product.portfolios) {
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
                amount: Math.round(monthlyAmount / product.portfolios.length),
                category: portfolio.PortfolioCategory ? portfolio.PortfolioCategory.toLowerCase() : category,
                planType: "yearly",
                expiresAt: commitmentEndDate,
                razorpaySubscriptionId: razorpaySubscription.id,
                bundleId: productId,
                isRenewal: subscriptionStatus.canRenew,
                previousSubscriptionId: subscriptionStatus.existingSubscription?._id || null,
                createdAt: new Date(),
                updatedAt: new Date()
              },
              { upsert: true, new: true, session }
            );
            dbSubscriptions.push(dbSubscription);
          }
          
          logger.info("Bundle subscriptions saved to database", {
            userId: userId.toString(),
            bundleId: productId.toString(),
            portfolioCount: product.portfolios.length,
            razorpaySubscriptionId: razorpaySubscription.id
          });
          
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
              amount: monthlyAmount,
              category,
              planType: "yearly",
              expiresAt: commitmentEndDate,
              razorpaySubscriptionId: razorpaySubscription.id,
              isRenewal: subscriptionStatus.canRenew,
              previousSubscriptionId: subscriptionStatus.existingSubscription?._id || null,
              createdAt: new Date(),
              updatedAt: new Date()
            },
            { upsert: true, new: true, session }
          );
          dbSubscriptions.push(dbSubscription);
          
          logger.info("Single subscription saved to database", {
            userId: userId.toString(),
            productType,
            productId: productId.toString(),
            subscriptionId: dbSubscription._id.toString(),
            razorpaySubscriptionId: razorpaySubscription.id
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
      amount: monthlyAmount,
      yearlyAmount,
      category,
      status: razorpaySubscription.status || "pending_authentication",
      totalCount: 12,
      createdAt: new Date().toISOString()
    };

    // Add renewal information if applicable
    if (subscriptionStatus.canRenew) {
      responseData.isRenewal = true;
      responseData.compensationDays = Math.ceil((subscriptionStatus.existingSubscription.expiresAt - new Date()) / (24 * 60 * 60 * 1000));
      responseData.message = `eMandate renewal created successfully. You will get ${responseData.compensationDays} bonus days added to your new subscription.`;
    } else {
      responseData.message = "eMandate subscription created successfully. Please complete the authentication process.";
    }

    logger.info("EMandate creation completed successfully", {
      userId: userId.toString(),
      subscriptionId: razorpaySubscription.id,
      productType,
      productId: productId.toString(),
      monthlyAmount,
      yearlyAmount,
      isRenewal: subscriptionStatus.canRenew
    });

    res.status(201).json(responseData);
    
  } catch(err) {
    logger.error("EMandate creation failed: Unexpected error", {
      userId: userId.toString(),
      productType,
      productId: productId?.toString(),
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
    const { productType, productId, planType = "monthly", isRenewal, existingSubscriptionId } = notes;
    const userId = req.user._id;
    const paidAmount = order.amount / 100;

    // Compute expiry and compensation
    let expiryDate = calculateEndDate(planType);
    let compensationDays = 0;
    if (isRenewal === "true" && existingSubscriptionId) {
      const existing = await Subscription.findById(existingSubscriptionId);
      if (existing && existing.expiresAt > new Date()) {
        const comp = calculateCompensatedEndDate(planType, existing.expiresAt);
        expiryDate = comp.endDate;
        compensationDays = comp.compensationDays;
      }
    }

    let responseData = {};
    let newSubscriptions = [];
    let telegramInviteLinks = [];

    if (productType === "Bundle") {
      // Bundle processing logic
      const bundle = await Bundle.findById(productId).populate("portfolios");
      if (!bundle) throw new Error("Bundle not found");

      const portfolios = bundle.portfolios || [];
      if (portfolios.length > 0) {
        const amountPer = paidAmount / portfolios.length;
        
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
              category: bundle.category,
              planType,
              expiresAt: expiryDate,
              paymentId,
              orderId,
              isRenewal: isRenewal === "true",
              compensationDays,
              previousSubscriptionId: existingSubscriptionId || null
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
            description: `Bundle payment - ${bundle.name}`
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
            amount: paidAmount,
            category: bundle.category,
            planType,
            expiresAt: expiryDate,
            paymentId,
            orderId,
            isRenewal: isRenewal === "true",
            compensationDays,
            previousSubscriptionId: existingSubscriptionId || null
          },
          { upsert: true, new: true, session }
        );
        newSubscriptions.push(sub);
        
        await PaymentHistory.create([{
          user: userId,
          subscription: sub._id,
          portfolio: null,
          amount: paidAmount,
          paymentId,
          orderId,
          signature,
          status: "VERIFIED",
          description: `Bundle (${bundle.name}) payment`
        }], { session });
      }

      responseData = {
        success: true,
        message: `Bundle payment verified${isRenewal ? " (Renewal)" : ""}`,
        category: bundle.category,
        isRenewal: isRenewal === "true",
        compensationDays,
        newExpiryDate: expiryDate
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
          amount: paidAmount,
          category: notes.category,
          planType,
          expiresAt: expiryDate,
          paymentId,
          orderId,
          isRenewal: isRenewal === "true",
          compensationDays,
          previousSubscriptionId: existingSubscriptionId || null
        },
        { upsert: true, new: true, session }
      );
      newSubscriptions.push(newSub);
      
      await PaymentHistory.create([{
        user: userId,
        subscription: newSub._id,
        portfolio: productType === "Portfolio" ? productId : null,
        amount: paidAmount,
        paymentId,
        orderId,
        signature,
        status: "VERIFIED",
        description: `${productType} payment${isRenewal ? " (Renewal)" : ""}`
      }], { session });

      responseData = {
        success: true,
        message: `${productType} payment verified${isRenewal ? " (Renewal)" : ""}`,
        subscriptionId: newSub._id,
        category: notes.category,
        isRenewal: isRenewal === "true",
        compensationDays,
        newExpiryDate: expiryDate
      };
    }

    await session.commitTransaction();
    
    // Generate and send bill for the subscription
    try {
      if (newSubscriptions && newSubscriptions.length > 0) {
        logger.info('Starting bill generation process', {
          subscriptionId: newSubscriptions[0]._id,
          paymentId,
          orderId,
          subscriptionCount: newSubscriptions.length
        });
        
        const bill = await generateAndSendBill(newSubscriptions[0]._id, {
          paymentId,
          orderId
        });
        
        logger.info('Bill generated and sent successfully', {
          subscriptionId: newSubscriptions[0]._id,
          billId: bill._id,
          billNumber: bill.billNumber,
          paymentId,
          orderId
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
    
    // Enhanced Telegram integration for both portfolios and bundles
    const telegramInvites = await handleTelegramIntegration(
      req.user, 
      productType, 
      productId, 
      newSubscriptions[0]
    );
    
    // Add Telegram links to response
    if (telegramInvites && telegramInvites.length > 0) {
      responseData.telegramInviteLinks = telegramInvites;
      responseData.telegramMessage = `You have access to ${telegramInvites.length} Telegram group${telegramInvites.length > 1 ? 's' : ''}. Check your email for invite links.`;
    }

    // Update user premium status
    await updateUserPremiumStatus(req.user._id);
    
    return res.json(responseData);
    
  } catch (error) {
    await session.abortTransaction();
    
    logger.error("Error in verifyPayment:", {
      error: error.message,
      stack: error.stack,
      paymentId: req.body.paymentId,
      orderId: req.body.orderId
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

async function sendTelegramInviteEmail(user, product, inviteLink, expiresAt) {
  try {
    const subject = `Your ${product.name} Telegram Group Access`;
    const text = `You've been granted access to the ${product.name} Telegram group.\n\nJoin here: ${inviteLink}\n\nLink expires on ${expiresAt.toDateString()}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2E86C1;">Welcome to ${product.name}!</h2>
        <p>You've been granted access to the exclusive Telegram group for ${product.name} subscribers.</p>
        <p style="margin: 25px 0;">
          <a href="${inviteLink}" 
             style="background-color: #2E86C1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
            Join Telegram Group
          </a>
        </p>
        <p><strong>Important:</strong> This invite link will expire on ${expiresAt.toDateString()}</p>
        <p>If you have any issues joining, please contact our support team.</p>
      </div>
    `;
    
    await sendEmail(user.email, subject, text, html);
    logger.info(`Telegram invite sent to ${user.email}`);
  } catch (error) {
    logger.error(`Failed to send Telegram invite to ${user.email}:`, error);
  }
}


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
    let activatedCount = 0;
    let telegramInviteLinks = [];

    if (["authenticated", "active"].includes(status)) {
      const session = await mongoose.startSession();
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
      });
      await session.endSession();

      // Generate Telegram invites for portfolio subscriptions
      for (const sub of existingSubs) {
        if (sub.productType === "Portfolio") {
          try {
            const telegramGroup = await TelegramService.getGroupMapping(sub.productId);
            if (telegramGroup) {
              const inviteResult = await TelegramService.generateInviteLink(sub.productId);
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
                const product = await Portfolio.findById(sub.productId);
                if (product) {
                  await sendTelegramInviteEmail(
                    req.user, 
                    product, 
                    inviteResult.invite_link, 
                    inviteResult.expires_at
                  );
                  
                  // Send bill email after telegram email
                  try {
                    await sendBillEmailAfterTelegram(req.user, sub);
                  } catch (billError) {
                    logger.error('Failed to send bill email for eMandate', {
                      subscriptionId: sub._id,
                      error: billError.message
                    });
                  }
                }
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
          logger.info('Starting eMandate bill generation', {
            subscriptionId: sub._id,
            razorpaySubscriptionId: subscription_id
          });
          
          const bill = await generateAndSendBill(sub._id, {
            paymentId: null, // eMandate doesn't have immediate payment ID
            orderId: null
          });
          
          logger.info('Bill generated for eMandate subscription', {
            subscriptionId: sub._id,
            billId: bill._id,
            billNumber: bill.billNumber,
            razorpaySubscriptionId: subscription_id
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
        totalSubscriptions: existingSubs.length
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
      
      return res.json({
        success: true,
        message: `eMandate ${status}. Activated ${activatedCount} subscriptions${isRenewal ? " (Renewal)" : ""}`,
        subscriptionStatus: status,
        activatedSubscriptions: activatedCount,
        isRenewal,
        telegramInviteLinks,
        requiresAction: ["pending", "created"].includes(status)
      });
    }

    // Cancelled/expired
    if (["halted", "cancelled", "expired"].includes(status)) {
      await Subscription.updateMany(
        { razorpaySubscriptionId: subscription_id, user: userId },
        { status: "cancelled" }
      );
      
      // Kick users from Telegram groups
      for (const sub of existingSubs) {
        if (sub.telegram_user_id) {
          try {
            await TelegramService.kickUser(sub.productId, sub.telegram_user_id);
            logger.info(`Kicked user ${sub.telegram_user_id} from product ${sub.productId}`);
          } catch (error) {
            logger.error(`Failed to kick user ${sub.telegram_user_id}:`, error);
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
            <p>Subscription ID: <strong>${subscription_id}</strong></p>
            <p>To complete the authentication, please visit:</p>
            <p><a href="${rSub.short_url}" style="color:#4a77e5;">Complete Authentication</a></p>  
            <hr style="margin:30px 0; border:none; border-top:1px solid #eee;">
            <p style="color:#666; font-size:12px;">Automated notification</p>
          </div>
        `;
        await sendEmail(user.email, subject, text, html);
      }

      return res.json({
        success: false,
        message: `Subscription in ${status} state.`,
        subscriptionStatus: status,
        requiresAction: true,
        authenticationUrl: rSub.short_url
      });
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
      subscription_id: req.body.subscription_id
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
    if (subscription.telegram_user_id) {
      try {
        const kickResult = await TelegramService.kickUser(
          subscription.productId,
          subscription.telegram_user_id
        );
        
        if (kickResult.success) {
          logger.info(`Kicked Telegram user ${subscription.telegram_user_id} from product ${subscription.productId}`);
          
          // Update subscription status
          await Subscription.updateOne(
            { _id: subscription._id },
            { telegram_kicked: true }
          );
        } else {
          logger.warn(`Failed to kick Telegram user ${subscription.telegram_user_id}: ${kickResult.error}`);
        }
      } catch (error) {
        logger.error('Telegram kick error on cancellation', {
          subscriptionId: subscription._id,
          error: error.message
        });
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
    
    await sendEmail(user.email, subject, text, html);
    logger.info(`Cancellation email sent to ${user.email}`);
  } catch (error) {
    logger.error('Failed to send cancellation email', {
      userId: user._id,
      error: error.message
    });
  }
}
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
    
    await sendEmail(user.email, subject, text, html);
    logger.info(`Payment failure email sent to ${user.email}`);
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
