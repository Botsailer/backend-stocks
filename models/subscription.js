const mongoose = require('mongoose');
const { Schema } = mongoose;

const SubscriptionSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User reference is required']
  },
  productType: {
    type: String,
    required: [true, 'Product type is required'],
    enum: {
      values: ['Portfolio', 'Bundle'],
      message: 'Invalid product type. Allowed values: Portfolio, Bundle'
    }
  },
  productId: {
    type: Schema.Types.ObjectId,
    required: [true, 'Product reference is required'],
    refPath: 'productType'
  },
  bundle: {
    type: Schema.Types.ObjectId,
    ref: 'Bundle',
    default: null
  },
  portfolio: {
    type: Schema.Types.ObjectId,
    ref: 'Portfolio',
    default: null
  },
  planType: {
    type: String,
    enum: ['monthly', 'quarterly', 'yearly'],
    required: true,
    default: 'monthly'
  },
  lastPaidAt: {
    type: Date,
    default: null
  },
  missedCycles: {
    type: Number,
    default: 0,
    min: [0, 'Missed cycles cannot be negative'],
    max: [3, 'Maximum 3 missed cycles allowed']
  },
  isActive: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true }
});

// Prevent duplicate subscriptions
SubscriptionSchema.index(
  { user: 1, productType: 1, productId: 1, planType: 1 },
  { unique: true, name: 'unique_subscription' }
);

module.exports = mongoose.model('Subscription', SubscriptionSchema);