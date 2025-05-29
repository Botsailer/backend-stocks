const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Subdocument: individual stock holding
 * - symbol: ticker symbol, uppercase, indexed
 * - weight: percent allocation of current portfolio value (calculated field)
 * - sector: sector name
 * - status: lifecycle state of the holding
 * - buyPrice: the price per share at time of purchase
 * - quantity: number of shares held
 */

const subscriptionFeeSchema = new Schema({
  type: {
    type: String,
    enum: ['monthly', 'quarterly', 'yearly'],
    required: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  }
}, { _id: false });

const StockHoldingSchema = new Schema({
  symbol: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    index: true
  },
  weight: {
    type: Number,
    required: false,
    min: 0,
    default: 0
  },
  sector: {
    type: String,
    required: true,
    trim: true
  },
  stockCapType: {
    type: String,
    enum: ['small cap', 'mid cap', 'large cap', 'micro cap', 'mega cap'],
    required: false
  },
  status: {
    type: String,
    enum: ['Hold', 'Fresh-Buy', 'partial-sell', 'addon-buy', 'Sell'],
    default: 'Hold'
  },
  buyPrice: {
    type: Number,
    required: true,
    min: 0.01
  },
  minimumInvestmentValueStock: {
    type: Number,
    required: true,
    min: 1
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  }
}, { _id: false });

// Updated to support nested objects
const portfolioDownLoadLinkSchema = new Schema({
  linkType: {
    type: String,
    required: true,
    trim: true
  },
  linkUrl: {
    type: String,
    required: true
  },
  linkDiscription: {
    type: String,
    required: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

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

const youTubeLinkSchema = new Schema({
  link: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const PortfolioSchema = new Schema({
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
  cashBalance: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  currentValue: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  timeHorizon: {
    type: String,
    required: false
  },
  rebalancing: {
    type: String,
    required: false
  },
  index: {
    type: String,
    required: false
  },
  details: {
    type: String,
    required: false
  },
  monthlyGains: {
    type: String,
    required: false
  },
  CAGRSinceInception: {
    type: String,
    required: false
  },
  oneYearGains: {
    type: String,
    required: false
  },
  subscriptionFee: {
    type: [subscriptionFeeSchema],
    required: true,
    validate: v => Array.isArray(v) && v.length > 0
  },
  minInvestment: {
    type: Number,
    required: true,
    min: 100
  },
  durationMonths: {
    type: Number,
    required: true,
    min: 1
  },
  PortfolioCategory: {
    type: String,
    required: true,
    default: 'Basic'
  },
  compareWith: {
    type: String,
    required: false,
    default: ""
  },
  expiryDate: {
    type: Date,
    required: false
  },
  holdings: {
    type: [StockHoldingSchema],
    default: []
  },
  downloadLinks: {
    type: [portfolioDownLoadLinkSchema],
    default: []
  },
  youTubeLinks: {
    type: [youTubeLinkSchema],
    default: []
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for total holdings value (cost basis)
PortfolioSchema.virtual('holdingsValue').get(function() {
  return this.holdings.reduce((sum, holding) => 
    sum + (holding.buyPrice * holding.quantity), 0);
});

// Validate total allocation doesn't exceed minInvestment AT CREATION
PortfolioSchema.pre('validate', function(next) {
  if (this.isNew) {
    const totalCost = this.holdings.reduce((sum, holding) => 
      sum + (holding.buyPrice * holding.quantity), 0);
    
    if (totalCost > this.minInvestment) {
      return next(new Error('Total holdings cost exceeds minimum investment'));
    }
    
    // Set initial cash balance
    this.cashBalance = this.minInvestment - totalCost;
    this.currentValue = this.minInvestment;
  }
  next();
});

// Calculate weight percentages before saving
PortfolioSchema.pre('save', function(next) {
  const totalValue = this.currentValue;
  
  this.holdings.forEach(holding => {
    if (totalValue > 0) {
      holding.weight = ((holding.buyPrice * holding.quantity) / totalValue) * 100;
    }
  });
  
  // Set expiry date if not provided
  if (!this.expiryDate && this.durationMonths) {
    const start = this.createdAt || new Date();
    const expire = new Date(start);
    expire.setMonth(expire.getMonth() + this.durationMonths);
    this.expiryDate = expire;
  }
  
  next();
});

// Unique index on portfolio name
PortfolioSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('Portfolio', PortfolioSchema);