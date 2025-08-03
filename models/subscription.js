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
    required: true
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
  lastPaymentAt: {
    type: Date,
    default: Date.now
  },
  
  // Payment references
  paymentId: String,
  orderId: String,
  razorpaySubscriptionId: String, // For eMandate
  
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
  type: 1  // Add type to prevent one_time and recurring duplicates
}, { unique: true, background: true });

// Optional: Add a sparse index for razorpay subscriptions
SubscriptionSchema.index({ 
  user: 1, 
  razorpaySubscriptionId: 1 
}, { 
  unique: true, 
  sparse: true,  // Allow null values
  background: true 
});
module.exports = mongoose.model("Subscription", SubscriptionSchema);
