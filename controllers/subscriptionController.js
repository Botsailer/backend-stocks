// controllers/subscriptionController.js

const Razorpay = require("razorpay");
const crypto = require("crypto");
const Subscription = require("../models/subscription");
const Portfolio = require("../models/modelPortFolio");
const Cart = require("../models/carts");
const PaymentHistory = require("../models/paymenthistory");
const Bundle = require("../models/bundle");
const { getPaymentConfig } = require("../utils/configSettings");

// Utility function to generate short receipts for Razorpay (max 40 chars)
function generateShortReceipt(prefix, userId) {
  const timestamp = Date.now().toString().slice(-8); // Last 8 digits
  const userIdShort = userId.toString().slice(-8); // Last 8 chars
  return `${prefix}_${timestamp}_${userIdShort}`;
}

async function getRazorpayInstance() {
  try {
    const paymentConfig = await getPaymentConfig();
    console.log("Payment config retrieved:", {
      hasKeyId: !!paymentConfig.key_id,
      hasKeySecret: !!paymentConfig.key_secret,
    });

    if (!paymentConfig.key_id || !paymentConfig.key_secret) {
      throw new Error("Razorpay key_id or key_secret not configured");
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

    // Find the selected plan price using the provided planType
    const plan = portfolio.subscriptionFee.find((fee) => fee.type === planType);

    if (!plan) {
      console.error(`No ${planType} plan found for portfolio:`, portfolio.name);
      throw new Error(
        `${planType} subscription plan not found for portfolio: ${portfolio.name}`
      );
    }

    total += plan.price * item.quantity;
  }
  return total;
}

// Create payment order for a single product
exports.createOrder = async (req, res) => {
  try {
    console.log("Creating order for:", req.body);

    const { productType, productId, planType = "monthly" } = req.body;

    if (!productType || !productId) {
      return res
        .status(400)
        .json({ error: "productType and productId are required" });
    }

    let product;
    let amount;

    if (productType === "Portfolio") {
      product = await Portfolio.findById(productId);
      if (!product) {
        return res.status(404).json({ error: "Portfolio not found" });
      }

      // Find the subscription fee for the specified plan type
      const subscriptionPlan = product.subscriptionFee.find(
        (fee) => fee.type === planType
      );
      if (!subscriptionPlan) {
        return res
          .status(400)
          .json({ error: `No ${planType} plan available for this portfolio` });
      }
      amount = subscriptionPlan.price;
    } else if (productType === "Bundle") {
      // Populate the bundle with portfolio details to calculate pricing
      product = await Bundle.findById(productId).populate({
        path: "portfolios",
        select: "subscriptionFee",
      });

      if (!product) {
        return res.status(404).json({ error: "Bundle not found" });
      }

      // Calculate bundle price based on plan type
      switch (planType) {
        case "monthly":
          amount = product.monthlyPrice;
          break;
        case "quarterly":
          amount = product.quarterlyPrice;
          break;
        case "yearly":
          amount = product.yearlyPrice;
          break;
        default:
          return res.status(400).json({ error: "Invalid plan type" });
      }
    } else {
      return res.status(400).json({ error: "Invalid product type" });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid subscription fee" });
    }

    console.log("Calculated amount:", amount);

    // Create Razorpay instance with timeout
    const razorpay = await Promise.race([
      getRazorpayInstance(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Razorpay initialization timeout")),
          10000
        )
      ),
    ]);

    // Create order with timeout
    // Generate short receipt (max 40 chars for Razorpay)
    const receipt = generateShortReceipt("ord", req.user._id);

    const order = await Promise.race([
      razorpay.orders.create({
        amount: Math.round(amount * 100), // Convert to paise and ensure integer
        currency: "INR",
        receipt: receipt, // Max 40 characters
        notes: {
          userId: req.user._id.toString(),
          productType,
          productId,
          planType,
        },
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Razorpay order creation timeout")),
          15000
        )
      ),
    ]);

    console.log("Order created successfully:", order.id);

    res.status(201).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      planType,
    });
  } catch (err) {
    console.error("Create order error:", err);

    // Handle Razorpay-specific errors
    if (err.error && err.error.description) {
      return res.status(400).json({ error: err.error.description });
    }

    // Handle timeout errors
    const errorMessage = err.message || "";
    if (errorMessage.includes("timeout")) {
      return res
        .status(504)
        .json({ error: "Request timeout. Please try again." });
    }

    if (errorMessage.includes("not configured")) {
      return res.status(503).json({
        error: "Payment service not configured. Please contact support.",
      });
    }

    res.status(500).json({ error: errorMessage || "Failed to create order" });
  }
};

exports.checkoutCart = async (req, res) => {
  try {
    const { planType = "monthly" } = req.body; // Accept planType from request body

    console.log("Cart checkout request:", {
      userId: req.user._id,
      planType,
    });

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    console.log("Found cart with items:", cart.items.length);

    // Calculate amount using the specified plan type
    const amount = await calculateCartAmount(cart, planType);
    if (amount <= 0) {
      return res.status(400).json({ error: "Invalid cart amount" });
    }

    console.log("Calculated cart amount:", amount, "for plan type:", planType);

    const razorpay = await getRazorpayInstance();

    // Generate short receipt (max 40 chars for Razorpay)
    const receipt = generateShortReceipt("cart", req.user._id);

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // Convert to paise
      currency: "INR",
      receipt: receipt,
      notes: {
        userId: req.user._id.toString(),
        cartCheckout: true,
        planType: planType, // Store planType in order notes
      },
    });

    console.log("Razorpay order created:", order.id);

    res.status(201).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      planType: planType,
    });
  } catch (err) {
    console.error("Checkout cart error:", err);

    // Handle Razorpay-specific errors
    if (err.error && err.error.description) {
      return res.status(400).json({ error: err.error.description });
    }

    res.status(500).json({ error: err.message || "Failed to checkout cart" });
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const razorpay = await getRazorpayInstance();
    const { orderId, paymentId, signature } = req.body;

    console.log("Verifying payment:", {
      orderId,
      paymentId,
      hasSignature: !!signature,
    });

    // Verify signature
    const generatedSignature = crypto
      .createHmac("sha256", (await getPaymentConfig()).key_secret)
      .update(orderId + "|" + paymentId)
      .digest("hex");

    if (generatedSignature !== signature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // Find order details from Razorpay
    const order = await razorpay.orders.fetch(orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    console.log("Order fetched:", {
      id: order.id,
      amount: order.amount,
      notes: order.notes,
    });

    let subscription;
    let portfolioId;

    // Handle cart checkout vs single product
    if (order.notes && order.notes.cartCheckout) {
      // Cart checkout - subscribe to all items in cart
      const cart = await Cart.findOne({ user: req.user._id });
      if (!cart) {
        return res.status(404).json({ error: "Cart not found" });
      }

      console.log("Processing cart checkout with", cart.items.length, "items");

      // Create subscriptions for each cart item
      for (const item of cart.items) {
        console.log("Creating subscription for portfolio:", item.portfolio);

        subscription = await Subscription.findOneAndUpdate(
          {
            user: req.user._id,
            productType: "Portfolio",
            productId: item.portfolio,
            portfolio: item.portfolio,
          },
          {
            $set: {
              isActive: true,
              lastPaidAt: new Date(),
              missedCycles: 0,
              productType: "Portfolio",
              productId: item.portfolio,
              portfolio: item.portfolio,
            },
          },
          { upsert: true, new: true }
        );
      }

      // Use the first portfolio for payment history
      portfolioId = cart.items[0]?.portfolio;

      // Clear cart after successful payment
      cart.items = [];
      await cart.save();

      console.log("Cart cleared after successful payment");
    } else {
      // Single product subscription
      const productType = order.notes?.productType || "Portfolio";
      const productId = order.notes?.productId;

      if (!productId) {
        return res.status(400).json({ error: "Product ID not found in order" });
      }

      console.log("Creating subscription for:", { productType, productId });

      // For Bundle, we need to create subscriptions for all portfolios in the bundle
      if (productType === "Bundle") {
        const bundle = await Bundle.findById(productId).populate("portfolios");
        if (!bundle) {
          return res.status(404).json({ error: "Bundle not found" });
        }

        // Create subscriptions for each portfolio in the bundle
        for (const portfolio of bundle.portfolios) {
          await Subscription.findOneAndUpdate(
            {
              user: req.user._id,
              productType: "Portfolio",
              productId: portfolio._id,
              portfolio: portfolio._id,
            },
            {
              $set: {
                isActive: true,
                lastPaidAt: new Date(),
                missedCycles: 0,
                productType: "Portfolio",
                productId: portfolio._id,
                portfolio: portfolio._id,
              },
            },
            { upsert: true, new: true }
          );
        }

        // Use the first portfolio for payment history
        portfolioId = bundle.portfolios[0]?._id;
        subscription = await Subscription.findOne({
          user: req.user._id,
          portfolio: portfolioId,
        });
      } else {
        // Single Portfolio subscription
        portfolioId = productId;
        subscription = await Subscription.findOneAndUpdate(
          {
            user: req.user._id,
            productType: productType,
            productId: productId,
            portfolio: productId,
          },
          {
            $set: {
              isActive: true,
              lastPaidAt: new Date(),
              missedCycles: 0,
              productType: productType,
              productId: productId,
              portfolio: productId,
            },
          },
          { upsert: true, new: true }
        );
      }
    }

    console.log("Subscription created/updated:", {
      subscriptionId: subscription?._id,
      portfolioId,
    });

    // Verify we have required data for PaymentHistory
    if (!subscription) {
      return res.status(500).json({ error: "Failed to create subscription" });
    }

    if (!portfolioId) {
      return res.status(500).json({ error: "Portfolio ID not found" });
    }

    // Record payment history with all required fields
    const paymentHistory = await PaymentHistory.create({
      user: req.user._id,
      portfolio: portfolioId,
      subscription: subscription._id,
      orderId,
      paymentId,
      signature,
      amount: order.amount,
      status: "VERIFIED",
    });

    console.log("Payment history created:", {
      paymentHistoryId: paymentHistory._id,
    });

    res.json({
      success: true,
      message: "Payment verified and subscription activated",
      subscription: subscription,
      paymentHistory: paymentHistory,
    });
  } catch (err) {
    console.error("Verify payment error:", err);
    res
      .status(400)
      .json({ error: err.message || "Payment verification failed" });
  }
};

// Razorpay webhook for reliable payment verification
exports.razorpayWebhook = async (req, res) => {
  try {
    const razorpay = await getRazorpayInstance();
    const paymentConfig = await getPaymentConfig();

    // Validate webhook signature
    const signature = req.headers["x-razorpay-signature"];
    const body = req.body;

    const expectedSignature = crypto
      .createHmac("sha256", paymentConfig.key_secret)
      .update(req.rawBody)
      .digest("hex");

    if (signature !== expectedSignature) {
      return res.status(400).json({ error: "Invalid webhook signature" });
    }

    const payment = body.payload?.payment?.entity;
    const subscription = req.body.payload?.subscription?.entity;

    // Handle payment captured event
    switch (body.event) {
      case "payment.captured":
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
                  productType: "Portfolio",
                  productId: item.portfolio,
                },
                {
                  $set: {
                    isActive: true,
                    lastPaidAt: new Date(),
                    missedCycles: 0,
                  },
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
              productId: order.notes.productId,
            },
            {
              $set: { isActive: true, lastPaidAt: new Date(), missedCycles: 0 },
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
          status: payment.status,
        });
        break;

      case "subscription.activated":
        console.log("Subscription activated:", subscription.id);

        break;

      case "subscription.charged":
        console.log("Subscription charged:", subscription.id);
        // Log payment and extend service
        break;

      case "subscription.cancelled":
        console.log("Subscription cancelled:", subscription.id);
        // Handle cancellation - but remember it's a yearly commitment
        // You might want to continue service until the commitment period ends
        break;

      case "subscription.completed":
        console.log("Subscription completed:", subscription.id);
        // Handle end of subscription
        break;

      case "subscription.paused":
        console.log("Subscription paused:", subscription.id);
        // Handle pause
        break;

      case "subscription.resumed":
        console.log("Subscription resumed:", subscription.id);
        // Handle resume
        break;

      default:
        console.log("Unhandled Razorypay event:", event);
    }

    res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(400).json({ error: err.message || "Webhook processing failed" });
  }
};

// Get payment history
exports.getHistory = async (req, res) => {
  try {
    const payments = await PaymentHistory.find({ user: req.user._id }).sort(
      "-createdAt"
    );
    res.json(payments);
  } catch (err) {
    console.error("Get history error:", err);
    res
      .status(500)
      .json({ error: err.message || "Failed to get payment history" });
  }
};

async function createSubscriptionPlan(amounInPaisa) {
  try {
    const razorpay = await getRazorpayInstance();

    // Check if plan already exists
    const existingPlans = await razorpay.plans.all();
    const existingPlan = existingPlans.items.find(
      (plan) =>
        plan.item.amount === amounInPaisa &&
        plan.period === "monthly" &&
        plan.interval === 1
    );

    if (existingPlan) {
      console.log("Using existing plan:", existingPlan.id);
      return existingPlan;
    }

    const plan = await razorpay.plans.create({
      period: "monthly",
      interval: 1,
      item: {
        name: "Yearly Subscription Plan",
        amount: amounInPaisa, // Amount in paise
        currency: "INR",
        description: "Monthly billing for yearly subscription",
      },
      notes: {
        commitment: "yearly",
        total_months: "12",
      },
    });

    console.log("Plan created:", plan);
    return plan;
  } catch (error) {
    console.error("Error creating plan:", error);
    throw error;
  }
}

// Create eMandate for yearly subscription with monthly payments
exports.createEmandate = async (req, res) => {
  try {
    const { productType, productId } = req.body;

    if (!productType || !productId) {
      return res
        .status(400)
        .json({ error: "productType and productId are required" });
    }

    // Check for existing pending subscription
    const existingSubscription = await Subscription.findOne({
      user: req.user._id,
      productType,
      productId,
      subscriptionType: "yearlyEmandate",
      isActive: false,
    });

    if (existingSubscription) {
      const razorpay = await getRazorpayInstance();
      const razorpaySubscription = await razorpay.subscriptions.fetch(existingSubscription.eMandateId);
      
      return res.status(200).json({
        commitmentEndDate: existingSubscription.commitmentEndDate,
        setupUrl: razorpaySubscription.short_url,
        subscriptionId: existingSubscription.eMandateId,
        amount: existingSubscription.monthlyAmount,
        customer_id: razorpaySubscription.customer_id,
        currency: razorpaySubscription.currency,
        planType: "quarterly",
        message: "Using existing subscription setup",
      });
    }

    let product;
    let yearlyAmount;

    if (productType === "Portfolio") {
      product = await Portfolio.findById(productId);
      if (!product) {
        return res.status(404).json({ error: "Portfolio not found" });
      }

      const yearlyPlan = product.subscriptionFee.find(
        (fee) => fee.type === "quarterly"
      );
      if (!yearlyPlan) {
        return res
          .status(400)
          .json({ error: "No yearly plan available for this portfolio" });
      }
      yearlyAmount = yearlyPlan.price;
    } else if (productType == "Bundle") {
      product = await Bundle.findById(productId).populate({
        path: "portfolios",
        select: "subscriptionFee",
      });

      if (!product) {
        return res.status(404).json({ error: "Bundle not found" });
      }

      yearlyAmount = product.quarterlyPrice * 12;
    } else {
      return res.status(400).json({ error: "Invalid product type" });
    }

    if (!yearlyAmount || yearlyAmount <= 0) {
      return res.status(400).json({ error: "Invalid subscription fee" });
    }

    // Calculate monthly amount (yearly amount divided by 12)
    const monthlyAmount = yearlyAmount / 12;

    const razorpay = await getRazorpayInstance();

    console.log("creating customer...");

    // Check if customer already exists
    let customer;
    try {
      const existingCustomers = await razorpay.customers.all({
        email: req.user.email,
      });
      if (existingCustomers.items && existingCustomers.items.length > 0) {
        customer = existingCustomers.items[0];
        console.log("Using existing customer:", customer.id);
      } else {
        customer = await razorpay.customers.create({
          name: req.user.name,
          email: req.user.email,
          contact: req.user.phone || "",
          fail_existing: 0,
        });
        console.log("Created new customer:", customer.id);
      }
    } catch (error) {
      customer = await razorpay.customers.create({
        name: req.user.name,
        email: req.user.email,
        contact: req.user.phone || "",
        fail_existing: 0,
      });
    }

    console.log("customer created:", customer);

    const plan = await createSubscriptionPlan(monthlyAmount * 100);

    // Create subscription
    const razorPaySubscription = await razorpay.subscriptions.create({
      plan_id: plan.id,
      customer_id: customer.id,
      quantity: 1,
      total_count: 12, // Total billing cycles (12 months)
      start_at: Math.floor(Date.now() / 1000) + 300, // Start 5 minutes from now
      expire_by: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // Expire after 1 year
      addons: [],
      notes: {
        subscription_type: "yearly_monthly_billing",
        commitment_period: "12_months",
      },
      // notify: {
      //   email: true,
      //   sms: !!req.user?.phone,
      // },
    });

    // Create subscription record
    const commitmentEndDate = new Date();
    commitmentEndDate.setFullYear(commitmentEndDate.getFullYear() + 1);

    if (productType === "Bundle") {
      // Create subscriptions for each portfolio in the bundle
      for (const portfolio of product.portfolios) {
        await Subscription.findOneAndUpdate(
          {
            user: req.user._id,
            productType: "Portfolio",
            productId: portfolio._id,
            portfolio: portfolio._id,
          },
          {
            $set: {
              subscriptionType: "yearlyEmandate",
              commitmentEndDate,
              monthlyAmount: monthlyAmount / product.portfolios.length,
              eMandateId: razorPaySubscription.id,
            },
          },
          { upsert: true, new: true }
        );
      }
    } else {
      // Single Portfolio subscription
      await Subscription.findOneAndUpdate(
        {
          user: req.user._id,
          productType,
          productId,
          portfolio: productId,
        },
        {
          $set: {
            subscriptionType: "yearlyEmandate",
            commitmentEndDate,
            monthlyAmount,
            eMandateId: razorPaySubscription.id,
          },
        },
        { upsert: true, new: true }
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

    if (err.error && err.error.description) {
      return res.status(400).json({ error: err.error.description });
    }

    res.status(500).json({ error: err.message || "Failed to create eMandate" });
  }
};

// Verify eMandate setup
exports.verifyEmandate = async (req, res) => {
  try {
    const { subscription_id, customer_id } = req.body;

    const razorpay = await getRazorpayInstance();

    // Authenticate the subscription
    const authenticatedSubscription = await razorpay.subscriptions.fetch(
      subscription_id
    );

    if (authenticatedSubscription.status === "authenticated") {
      // Update all subscriptions with this eMandateId
      await Subscription.updateMany(
        { eMandateId: authenticatedSubscription.id },
        {
          $set: {
            isActive: true,
            lastPaidAt: new Date(),
          },
        }
      );

      res.json({
        success: true,
        message: "Subscription authenticated successfully",
        subscription: authenticatedSubscription,
      });
    } else {
      res.json({
        success: false,
        message: "Subscription not authenticated yet",
      });
    }
  } catch (error) {
    console.error("Error authenticating subscription:", error);
    res.status(500).json({ error: error.message });
  }
};

// Handle subscription cancellation request
exports.cancelSubscription = async (req, res) => {
  try {
    const dbSubscription = await Subscription.findOne({
      user: req.user._id,
      _id: req.params.subscriptionId,
    });

    if (!dbSubscription) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    if (!dbSubscription.canBeCancelled()) {
      return res.status(400).json({
        error: "Cannot cancel subscription during yearly commitment period",
        commitmentEndDate: dbSubscription.commitmentEndDate,
      });
    }

    if (
      dbSubscription.subscriptionType === "yearlyEmandate" &&
      dbSubscription.eMandateId
    ) {
      try {
        const razorpay = await getRazorpayInstance();

        const subscription_id = dbSubscription.eMandateId;

        const subscription = await razorpay.subscriptions.fetch(
          subscription_id
        );

        // Check if yearly commitment is fulfilled
        const currentTime = Math.floor(Date.now() / 1000);
        const subscriptionStartTime = subscription.start_at;
        const commitmentEndTime = subscriptionStartTime + 365 * 24 * 60 * 60; // 1 year from start

        if (currentTime < commitmentEndTime) {
          // Cancel subscription but calculate remaining commitment amount
          const remainingMonths = Math.ceil(
            (commitmentEndTime - currentTime) / (30 * 24 * 60 * 60)
          );
          const penaltyAmount = remainingMonths * subscription.plan_id.amount; // Calculate penalty if needed

          return res.json({
            success: false,
            message: "Yearly commitment not fulfilled",
            remaining_months: remainingMonths,
            penalty_amount: penaltyAmount,
            commitment_end_date: new Date(commitmentEndTime * 1000),
          });
        } else {
          // Cancel subscription
          const cancelledSubscription = await razorpay.subscriptions.cancel(
            subscription_id,
            {
              cancel_at_cycle_end: false,
            }
          );
        }
      } catch (error) {
        console.error("Error cancelling subscription:", error);
        res.status(500).json({ error: error.message });
      }
    }

    // Cancel all subscriptions with the same eMandateId
    await Subscription.updateMany(
      { 
        user: req.user._id,
        eMandateId: dbSubscription.eMandateId 
      },
      { $set: { isActive: false } }
    );

    res.json({
      status: "success",
      message: "Subscription cancelled successfully",
    });
  } catch (err) {
    console.error("Cancel subscription error:", err);
    res
      .status(500)
      .json({ error: err.message || "Failed to cancel subscription" });
  }
};
