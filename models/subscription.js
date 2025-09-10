const mongoose = require('mongoose');
const { Schema } = mongoose;

const SubscriptionSchema = new Schema({
  // Core fields
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  productType: {
    type: String,
    required: true,
    enum: ["Portfolio", "Bundle"]
  },
  productId: {
    type: Schema.Types.ObjectId,
    required: true,
    refPath: "productType"
  },
  portfolio: {
    type: Schema.Types.ObjectId,
    ref: "Portfolio",
  },
  // Telegram integration
  telegram_kicked: {
    type: Boolean,
    default: false
  },
  telegram_user_id: {
    type: String
  },
  invite_link_url: {
    type: String
  },
  invite_link_expires_at: {
    type: Date
  },
  kickAttemptCount: {
    type: Number,
    default: 0
  },
  lastKickAttempt: {
    type: Date
  },
  
  // Subscription details
  type: {
    type: String,
    required: true,
    enum: ["one_time", "recurring"],
    default: "one_time"
  },
  status: {
    type: String,
    required: true,
    enum: ["pending", "active", "expired", "cancelled"],
    default: "pending"
  },
  category: {
    type: String,
    enum: ["basic", "premium"],
    required: true
  },
  
  // Payment details
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  planType: {
    type: String,
    enum: ["monthly", "quarterly", "yearly"],
    default: "monthly"
  },
  
  // Expiry and dates
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },


  couponUsed: {
  type: Schema.Types.ObjectId,
  ref: 'Coupon',
  default: null
},
discountApplied: {
  type: Number,
  default: 0,
  min: 0
},
  originalAmount: {
    type: Number,
    default: 0,
    min: 0
  },

  lastPaymentAt: {
    type: Date,
    default: Date.now
  }, 
  paymentId: String,
  orderId: String,
  razorpaySubscriptionId: String,
  
  // Bundle reference
  bundleId: {
    type: Schema.Types.ObjectId,
    ref: "Bundle"
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true }
});

SubscriptionSchema.index({ 
  user: 1, 
  productType: 1, 
  productId: 1, 
  type: 1
}, { unique: true, background: true });

SubscriptionSchema.index({ razorpaySubscriptionId: 1 }, { sparse: true, background: true });

module.exports = mongoose.model("Subscription", SubscriptionSchema);