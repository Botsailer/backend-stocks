const mongoose = require('mongoose');

const bundleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  portfolios: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Portfolio',
    required: true
  }],
  discountPercentage: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
    default: 0
  },
  subscription: {
    minInvestment: {
      type: Number,
      required: true
    },
    feeAmount: {
      type: Number,
      required: true
    },
    feeCurrency: {
      type: String,
      default: 'INR'
    },
    feeInterval: {
      type: String,
      enum: ['one-time', 'monthly', 'yearly'],
      default: 'one-time'
    }
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true } 
});

// Virtual for discounted price
bundleSchema.virtual('discountedPrice').get(function() {
  const originalPrice = this.subscription.feeAmount;
  return originalPrice - (originalPrice * this.discountPercentage / 100);
});

module.exports = mongoose.model('Bundle', bundleSchema);
