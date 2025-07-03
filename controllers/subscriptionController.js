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

    // Handle payment captured event
    if (body.event === "payment.captured") {
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

// Create eMandate for yearly subscription with monthly payments
exports.createEmandate = async (req, res) => {
  try {
    const { productType, productId } = req.body;

    if (!productType || !productId) {
      return res
        .status(400)
        .json({ error: "productType and productId are required" });
    }

    let product;
    let yearlyAmount;

    if (productType === "Portfolio") {
      product = await Portfolio.findById(productId);
      if (!product) {
        return res.status(404).json({ error: "Portfolio not found" });
      }

      const yearlyPlan = product.subscriptionFee.find(
        (fee) => fee.type === "yearly"
      );
      if (!yearlyPlan) {
        return res
          .status(400)
          .json({ error: "No yearly plan available for this portfolio" });
      }
      yearlyAmount = yearlyPlan.price;
    } else if (productType == "bundle") {
      product = await Bundle.findById(productId).populate({
        path: "portfolios",
        select: "subscriptionFee",
      });

      if (!product) {
        return res.status(404).json({ error: "Bundle not found" });
      }

      yearlyAmount = product.yearlyPrice;
    } else {
      return res.status(400).json({ error: "Invalid product type" });
    }

    if (!yearlyAmount || yearlyAmount <= 0) {
      return res.status(400).json({ error: "Invalid subscription fee" });
    }

    // Calculate monthly amount (yearly amount divided by 12)
    const monthlyAmount = Math.ceil(yearlyAmount / 12);

    const razorpay = await getRazorpayInstance();

    // Create eMandate request
    const emandate = await razorpay.emandate.create({
      amount: monthlyAmount * 100, // Amount in paise
      currency: "INR",
      customer: {
        name: req.user.name,
        email: req.user.email,
        contact: req.user.phone || "",
      },
      type: "emandate",
      usage: "RECURRING",
      frequency: "monthly",
      status: "created",
      notify: {
        email: true,
        sms: true,
      },
      description: `Monthly payment for yearly subscription - ${productType} ${productId}`,
      notes: {
        userId: req.user._id.toString(),
        productType,
        productId,
        subscriptionType: "yearlyEmandate",
      },
    });

    // Create subscription record
    const commitmentEndDate = new Date();
    commitmentEndDate.setFullYear(commitmentEndDate.getFullYear() + 1);

    const subscription = new Subscription({
      user: req.user._id,
      productType,
      productId,
      subscriptionType: "yearlyEmandate",
      commitmentEndDate,
      monthlyAmount,
      eMandateId: emandate.id,
    });

    await subscription.save();

    res.status(201).json({
      emandateId: emandate.id,
      monthlyAmount,
      commitmentEndDate,
      setupUrl: emandate.short_url,
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
    const { emandateId } = req.body;

    if (!emandateId) {
      return res.status(400).json({ error: "emandateId is required" });
    }

    const razorpay = await getRazorpayInstance();

    // Verify eMandate status
    const emandate = await razorpay.emandate.fetch(emandateId);

    if (emandate.status !== "active") {
      return res.status(400).json({ error: "eMandate setup is not complete" });
    }

    // Update subscription status
    const subscription = await Subscription.findOne({ eMandateId: emandateId });
    if (!subscription) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    subscription.isActive = true;
    subscription.lastPaidAt = new Date();
    await subscription.save();

    res.json({
      status: "success",
      message: "eMandate setup verified and subscription activated",
    });
  } catch (err) {
    console.error("Verify eMandate error:", err);
    res.status(500).json({ error: err.message || "Failed to verify eMandate" });
  }
};

// Handle subscription cancellation request
exports.cancelSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findOne({
      user: req.user._id,
      _id: req.params.subscriptionId,
    });

    if (!subscription) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    if (!subscription.canBeCancelled()) {
      return res.status(400).json({
        error: "Cannot cancel subscription during yearly commitment period",
        commitmentEndDate: subscription.commitmentEndDate,
      });
    }

    if (
      subscription.subscriptionType === "yearlyEmandate" &&
      subscription.eMandateId
    ) {
      const razorpay = await getRazorpayInstance();
      await razorpay.emandate.cancel(subscription.eMandateId);
    }

    subscription.isActive = false;
    await subscription.save();

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
