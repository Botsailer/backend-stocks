const mongoose = require('mongoose');
const { Schema } = mongoose;

const BundleSchema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    default: ""
  },
  portfolios: [{
    type: Schema.Types.ObjectId,
    ref: 'Portfolio',
    required: true,
  }],
  discountPercentage: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Pre-hook to populate portfolios before virtual calculations
BundleSchema.pre('find', function() {
  this.populate({
    path: 'portfolios',
    select: 'name subscriptionFee'
  });
});

BundleSchema.pre('findOne', function() {
  this.populate({
    path: 'portfolios',
    select: 'name subscriptionFee'
  });
});

// Enhanced virtual price calculations with error handling
const calculateBundlePrice = (portfolios, feeType, discountPercentage) => {
  if (!Array.isArray(portfolios)) return 0;
  
  const total = portfolios.reduce((sum, portfolio) => {
    if (!portfolio?.subscriptionFee || !Array.isArray(portfolio.subscriptionFee)) return sum;
    
    const fee = portfolio.subscriptionFee.find(f => f.type === feeType);
    return sum + (fee ? fee.price : 0);
  }, 0);
  
  return total * (1 - discountPercentage / 100);
};

BundleSchema.virtual('monthlyPrice').get(function() {
  return calculateBundlePrice(this.portfolios, 'monthly', this.discountPercentage);
});

BundleSchema.virtual('quarterlyPrice').get(function() {
  return calculateBundlePrice(this.portfolios, 'quarterly', this.discountPercentage);
});

BundleSchema.virtual('yearlyPrice').get(function() {
  return calculateBundlePrice(this.portfolios, 'yearly', this.discountPercentage);
});

module.exports = mongoose.model('Bundle', BundleSchema);