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

// Validate and sanitize name for Razorpay eMandate
function validateAndSanitizeName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error("Name is required");
  }

  // Remove extra spaces and trim
  let sanitizedName = name.trim().replace(/\s+/g, ' ');
  
  // Remove special characters except spaces, hyphens, and apostrophes
  sanitizedName = sanitizedName.replace(/[^a-zA-Z\s\-'\.]/g, '');
  
  // Ensure name is between 4 and 120 characters
  if (sanitizedName.length < 4) {
    // If name is too short, pad with last name or use a default
    sanitizedName = sanitizedName + " User";
  }
  
  if (sanitizedName.length > 120) {
    sanitizedName = sanitizedName.substring(0, 120).trim();
  }

  // Ensure no leading/trailing special characters
  sanitizedName = sanitizedName.replace(/^[\-'\.\s]+|[\-'\.\s]+$/g, '');
  
  // Final validation
  if (sanitizedName.length < 4 || sanitizedName.length > 120) {
    throw new Error("Invalid name format after sanitization");
  }

  return sanitizedName;
}

// Validate phone number for Razorpay
function validatePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return "";
  }

  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  
  // Check if it's a valid Indian mobile number
  if (digits.length === 10 && digits.match(/^[6-9]/)) {
    return digits;
  } else if (digits.length === 12 && digits.startsWith('91') && digits.substring(2).match(/^[6-9]/)) {
    return digits.substring(2);
  } else if (digits.length === 13 && digits.startsWith('091')) {
    return digits.substring(3);
  }
  
  return ""; // Return empty string if invalid
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
      amount, paymentId,
      orderId,
      signature,
      status: "VERIFIED",
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
  switch (subscriptionType) {
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

async function createSubscriptionPlan(amountInPaisa, planId = null) {
  const razorpay = await getRazorpayInstance();

  // If planId is provided, try to fetch existing plan
  if (planId) {
    try {
      const existingPlan = await razorpay.plans.fetch(planId);
      if (existingPlan && existingPlan.item.amount === amountInPaisa) {
        return existingPlan;
      }
    } catch (error) {
      console.log("Plan not found, creating new one");
    }
  }

  // Check if plan already exists with same amount
  try {
    const existingPlans = await razorpay.plans.all({ count: 100 });
    const existingPlan = existingPlans.items.find(
      plan => plan.item.amount === amountInPaisa &&
        plan.period === "monthly" &&
        plan.interval === 1
    );

    if (existingPlan) return existingPlan;
  } catch (error) {
    console.log("Error fetching existing plans:", error);
  }

  // Create new plan
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

// Enhanced customer creation with better error handling
async function createOrFetchCustomer(razorpay, user) {
  try {
    const sanitizedName = validateAndSanitizeName(user.name || user.username || 'User');
    const validatedPhone = validatePhoneNumber(user.phone || user.mobile || '');
    
    // First try to find existing customer by email
    try {
      const existingCustomers = await razorpay.customers.all({ 
        email: user.email,
        count: 1 
      });
      
      if (existingCustomers.items && existingCustomers.items.length > 0) {
        const existingCustomer = existingCustomers.items[0];
        console.log("Found existing customer:", existingCustomer.id);
        return existingCustomer;
      }
    } catch (error) {
      console.log("No existing customer found, creating new one");
    }

    // Create new customer with validated data
    const customerData = {
      name: sanitizedName,
      email: user.email,
    };

    // Only add contact if we have a valid phone number
    if (validatedPhone) {
      customerData.contact = validatedPhone;
    }

    console.log("Creating customer with data:", customerData);
    
    const customer = await razorpay.customers.create(customerData);
    console.log("Customer created successfully:", customer.id);
    
    return customer;
  } catch (error) {
    console.error("Customer creation error:", error);
    
    // If error is related to name format, try with a simpler name
    if (error.error?.description?.includes('name') || error.error?.field === 'name') {
      try {
        console.log("Retrying customer creation with simplified name");
        const simpleName = (user.name || user.username || 'User').replace(/[^a-zA-Z\s]/g, '').trim();
        const finalName = simpleName.length >= 4 ? simpleName : 'User Account';
        
        const customerData = {
          name: finalName,
          email: user.email,
        };

        const validatedPhone = validatePhoneNumber(user.phone || user.mobile || '');
        if (validatedPhone) {
          customerData.contact = validatedPhone;
        }

        return await razorpay.customers.create(customerData);
      } catch (retryError) {
        console.error("Retry customer creation failed:", retryError);
        throw retryError;
      }
    }
    
    throw error;
  }
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
      if (!yearlyPlan) return res.status(400).json({ error: "No quarterly plan available for eMandate" });
      yearlyAmount = yearlyPlan.price;
    } else if (productType === "Bundle") {
      product = await Bundle.findById(productId);
      if (!product) return res.status(404).json({ error: "Bundle not found" });
      
      if (!product.quarterlyPrice || product.quarterlyPrice <= 0) {
        return res.status(400).json({ error: "No quarterly pricing available for this bundle" });
      }
      yearlyAmount = product.quarterlyPrice * 4; // Quarterly * 4 = yearly
    } else {
      return res.status(400).json({ error: "Invalid product type" });
    }

    if (!yearlyAmount || yearlyAmount <= 0) {
      return res.status(400).json({ error: "Invalid subscription fee" });
    }

    const monthlyAmount = Math.round(yearlyAmount / 12);
    console.log(`Creating eMandate: Yearly amount: ${yearlyAmount}, Monthly amount: ${monthlyAmount}`);

    const razorpay = await getRazorpayInstance();

    // Create or fetch customer with enhanced error handling
    const customer = await createOrFetchCustomer(razorpay, req.user);

    // Create subscription plan
    const plan = await createSubscriptionPlan(monthlyAmount * 100);
    console.log("Plan created/fetched:", plan.id);

    const commitmentEndDate = new Date();
    commitmentEndDate.setFullYear(commitmentEndDate.getFullYear() + 1);

    // Create Razorpay subscription
    const subscriptionData = {
      plan_id: plan.id,
      customer_id: customer.id,
      quantity: 1,
      total_count: 12,
      start_at: Math.floor(Date.now() / 1000) + 300, // Start 5 minutes from now
      expire_by: Math.floor(commitmentEndDate.getTime() / 1000),
      notes: {
        subscription_type: "yearly_monthly_billing",
        commitment_period: "12_months",
        user_id: req.user._id.toString(),
        product_type: productType,
        product_id: productId,
      },
    };

    console.log("Creating Razorpay subscription with data:", subscriptionData);

    const razorPaySubscription = await razorpay.subscriptions.create(subscriptionData);
    console.log("Razorpay subscription created:", razorPaySubscription.id);

    // Create subscription record(s) in database
    if (productType === "Bundle") {
      const bundle = await Bundle.findById(productId).populate("portfolios");
      if (!bundle || !bundle.portfolios || bundle.portfolios.length === 0) {
        return res.status(400).json({ error: "Bundle has no portfolios" });
      }

      const amountPerPortfolio = monthlyAmount / bundle.portfolios.length;

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
            monthlyAmount: Math.round(amountPerPortfolio),
            eMandateId: razorPaySubscription.id,
            isActive: false, // Will be activated when eMandate is authenticated
            planType: "quarterly",
          },
          { upsert: true, new: true }
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
          isActive: false, // Will be activated when eMandate is authenticated
          planType: "quarterly",
        },
        { upsert: true, new: true }
      );
    }

    res.status(201).json({
      success: true,
      commitmentEndDate,
      setupUrl: razorPaySubscription.short_url,
      subscriptionId: razorPaySubscription.id,
      amount: monthlyAmount,
      yearlyAmount,
      customer_id: customer.id,
      currency: razorPaySubscription.currency || "INR",
      planType: "quarterly",
      message: "eMandate created successfully. Please complete the authentication.",
    });
  } catch (err) {
    console.error("Create eMandate error:", err);

    // Enhanced error handling
    if (err.error?.description) {
      if (err.error.description.includes('name')) {
        return res.status(400).json({ 
          error: "Invalid name format. Please ensure your name contains only letters and is at least 4 characters long.",
          details: err.error.description 
        });
      }
      return res.status(400).json({ error: err.error.description });
    }

    if (err.message?.includes('name')) {
      return res.status(400).json({ 
        error: "Invalid name format. Please update your profile with a valid name (4-120 characters, letters only)." 
      });
    }

    res.status(500).json({ error: err.message || "Failed to create eMandate" });
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