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
    type: String, // Changed to String
    required: true,
    default: ""   // Default empty string
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

// Add safety checks to virtuals
BundleSchema.virtual('monthlyPrice').get(function() {
  if (!this.portfolios || !Array.isArray(this.portfolios)) return 0;
  
  const total = this.portfolios.reduce((sum, portfolio) => {
    if (!portfolio || !portfolio.subscriptionFee || !Array.isArray(portfolio.subscriptionFee)) return sum;
    
    const monthlyFee = portfolio.subscriptionFee.find(f => f.type === 'monthly');
    return sum + (monthlyFee ? monthlyFee.price : 0);
  }, 0);
  
  return total * (1 - this.discountPercentage / 100);
});

// Apply same safety checks to other virtuals
BundleSchema.virtual('quarterlyPrice').get(function() {
  if (!this.portfolios || !Array.isArray(this.portfolios)) return 0;
  
  const total = this.portfolios.reduce((sum, portfolio) => {
    if (!portfolio || !portfolio.subscriptionFee || !Array.isArray(portfolio.subscriptionFee)) return sum;
    
    const quarterlyFee = portfolio.subscriptionFee.find(f => f.type === 'quarterly');
    return sum + (quarterlyFee ? quarterlyFee.price : 0);
  }, 0);
  
  return Math.round((total * (1 - this.discountPercentage / 100)) * 100) / 100;
});

BundleSchema.virtual('yearlyPrice').get(function() {
  if (!this.portfolios || !Array.isArray(this.portfolios)) return 0;
  
  const total = this.portfolios.reduce((sum, portfolio) => {
    if (!portfolio || !portfolio.subscriptionFee || !Array.isArray(portfolio.subscriptionFee)) return sum;
    
    const yearlyFee = portfolio.subscriptionFee.find(f => f.type === 'yearly');
    return sum + (yearlyFee ? yearlyFee.price : 0);
  }, 0);
  
  return Math.round((total * (1 - this.discountPercentage / 100)) * 100) / 100;
});

module.exports = mongoose.model('Bundle', BundleSchema);