const mongoose = require('mongoose');
const { Schema } = mongoose;

const descriptionItemSchema = new Schema({
  key: {
    type: String,
    required: true,
    trim: true
  },
  value: {
    type: String,
    required: true,
    trim: true
  }
}, { _id: false });

const BundleSchema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  description: {
    type: [descriptionItemSchema],
    default: []
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
  // Prices will be calculated virtually
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtuals for auto-calculated prices
BundleSchema.virtual('monthlyPrice').get(function() {
  if (!this.populated('portfolios')) return 0;
  const total = this.portfolios.reduce((sum, portfolio) => {
    const monthlyFee = portfolio.subscriptionFee.find(f => f.type === 'monthly');
    return sum + (monthlyFee ? monthlyFee.price : 0);
  }, 0);
  return total * (1 - this.discountPercentage / 100);
});

BundleSchema.virtual('quarterlyPrice').get(function() {
  if (!this.populated('portfolios')) return 0;
  const total = this.portfolios.reduce((sum, portfolio) => {
    const quarterlyFee = portfolio.subscriptionFee.find(f => f.type === 'quarterly');
    return sum + (quarterlyFee ? quarterlyFee.price : 0);
  }, 0);
  return total * (1 - this.discountPercentage / 100);
});

BundleSchema.virtual('yearlyPrice').get(function() {
  if (!this.populated('portfolios')) return 0;
  const total = this.portfolios.reduce((sum, portfolio) => {
    const yearlyFee = portfolio.subscriptionFee.find(f => f.type === 'yearly');
    return sum + (yearlyFee ? yearlyFee.price : 0);
  }, 0);
  return total * (1 - this.discountPercentage / 100);
});

module.exports = mongoose.model('Bundle', BundleSchema);