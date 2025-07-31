const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * @swagger
 * components:
 *   schemas:
 *     Subscription:
 *       type: object
 *       required:
 *         - user
 *         - productType
 *         - productId
 *       properties:
 *         user:
 *           type: string
 *           format: objectid
 *           description: Reference to subscribing user
 *         productType:
 *           type: string
 *           enum: [Portfolio, Bundle]
 *           example: "Bundle"
 *           description: Type of subscribed financial product
 *         productId:
 *           type: string
 *           format: objectid
 *           example: "615a2d4b87d9c34f7d4f8a12"
 *           description: Reference to Portfolio/Bundle document
 *         lastPaidAt:
 *           type: string
 *           format: date-time
 *           description: Timestamp of last successful payment
 *         missedCycles:
 *           type: integer
 *           minimum: 0
 *           maximum: 3
 *           default: 0
 *           description: Consecutive missed payment cycles
 *         isActive:
 *           type: boolean
 *           default: false
 *           description: Subscription active status
 *         subscriptionType:
 *           type: string
 *           enum: [regular, yearlyEmandate]
 *           default: regular
 *           description: Type of subscription - regular or yearly with eMandate
 *         commitmentEndDate:
 *           type: string
 *           format: date-time
 *           description: End date of yearly commitment for eMandate subscriptions
 *         eMandateId:
 *           type: string
 *           description: Razorpay eMandate ID for recurring payments
 *         monthlyAmount:
 *           type: number
 *           description: Monthly payment amount for eMandate subscriptions
 *         createdAt:
 *           type: string
 *           format: date-time
 *           readOnly: true
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           readOnly: true
 */
const SubscriptionSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User reference is required"],
    },
    productType: {
      type: String,
      required: [true, "Product type is required"],
      enum: {
        values: ["Portfolio", "Bundle"],
        message: "Invalid product type. Allowed values: Portfolio, Bundle",
      },
    },
    productId: {
      type: Schema.Types.ObjectId,
      required: [true, "Product reference is required"],
      refPath: "productType",
    },
    portfolio: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Portfolio",
      required: true,
    },
     bundleCategory: {
      type: String,
      enum: ["basic", "premium"],
      default: null
    }
  ,
    lastPaidAt: {
      type: Date,
      default: null,
    },
    missedCycles: {
      type: Number,
      default: 0,
      min: [0, "Missed cycles cannot be negative"],
      max: [3, "Maximum 3 missed cycles allowed"],
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    subscriptionType: {
      type: String,
      enum: ["regular", "yearlyEmandate"],
      default: "regular",
    },
    commitmentEndDate: {
      type: Date,
      default: null,
    },
    eMandateId: {
      type: String,
      default: null,
    },
    monthlyAmount: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Prevent duplicate subscriptions
SubscriptionSchema.index(
  { user: 1, productType: 1, productId: 1 },
  { unique: true, name: "unique_subscription" }
);

/**
 * Handles payment recording and cycle management
 */
SubscriptionSchema.methods.recordPayment = function (paymentDate = new Date()) {
  if (this.lastPaidAt) {
    const nextDue = new Date(this.lastPaidAt);
    nextDue.setMonth(nextDue.getMonth() + 1);

    if (paymentDate <= nextDue) {
      this.missedCycles = 0;
    } else {
      const monthsDiff =
        (paymentDate.getFullYear() - nextDue.getFullYear()) * 12 +
        (paymentDate.getMonth() - nextDue.getMonth());
      this.missedCycles = Math.min(monthsDiff, 3);
    }
  }

  this.lastPaidAt = paymentDate;
  this.isActive = true;
  return this.save();
};

/**
 * Check if subscription can be cancelled
 */
SubscriptionSchema.methods.canBeCancelled = function () {
  if (this.subscriptionType !== "yearlyEmandate") {
    return true;
  }

  const now = new Date();
  return !this.commitmentEndDate || now >= this.commitmentEndDate;
};

module.exports = mongoose.model("Subscription", SubscriptionSchema);
