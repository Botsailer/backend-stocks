const mongoose = require('mongoose');
const { Schema } = mongoose;

// Sub-schemas definitions
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
    default: 0,
    //to fix: 2 decimal places
    set: v => Math.round(v * 100) / 100
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

const historicalValueSchema = new Schema({
  date: {
    type: Date,
    required: true
  },
  value: {
    type: Number,
    required: true
  }
}, { _id: false });

// Main Portfolio Schema
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
    required: false,
    default: "0%"
  },
  CAGRSinceInception: {
    type: String,
    required: false,
    default: "0%"
  },
  oneYearGains: {
    type: String,
    required: false,
    default: "0%"
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
    default: "",
    validate: {
      validator: async function(value) {
        if (!value) return true; // Allow empty value
        
        // Check if the referenced symbol exists
        const StockSymbol = mongoose.model('StockSymbol');
        const symbolExists = await StockSymbol.exists({ symbol: value });
        return symbolExists;
      },
      message: props => `Benchmark symbol "${props.value}" does not exist in stock symbols`
    }
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
  },
  lastRebalanceDate: {
    type: Date,
    required: false
  },
  nextRebalanceDate: {
    type: Date,
    required: false
  },
  monthlyContribution: {
    type: Number,
    required: false,
    min: 0,
    default: 0
  },
  historicalValues: {
    type: [historicalValueSchema],
    default: []
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtuals
PortfolioSchema.virtual('holdingsValue').get(function() {
  return this.holdings?.reduce((sum, holding) => 
    sum + (holding.buyPrice * holding.quantity), 0);
});

PortfolioSchema.virtual('daysSinceCreation').get(function() {
  if (!this.createdAt) return 0;
  return Math.floor((Date.now() - this.createdAt) / 86400000);
});

// Pre-save hook for data consistency
PortfolioSchema.pre('save', function(next) {
  // Ensure currentValue matches actual assets
  this.currentValue = this.cashBalance + this.holdingsValue;

  // Update holding weights
  this.holdings.forEach(holding => {
    const holdingValue = holding.buyPrice * holding.quantity;
    holding.weight = this.currentValue > 0 ? 
      (holdingValue / this.currentValue) * 100 : 0;
  });

  // Set expiry date if not provided
  if (!this.expiryDate && this.durationMonths) {
    const start = this.createdAt || new Date();
    const expire = new Date(start);
    expire.setMonth(expire.getMonth() + this.durationMonths);
    this.expiryDate = expire;
  }

  // Update historical values (store daily snapshot)
  this.updateHistoricalValues();

  // Calculate all gains metrics based on minimum data requirements
  this.CAGRSinceInception = this.calculateCAGR();
  this.monthlyGains = this.calculatePeriodGain(30);
  this.oneYearGains = this.calculatePeriodGain(365);

  next();
});

// Historical value management
PortfolioSchema.methods.updateHistoricalValues = function() {
  const today = new Date().toISOString().split('T')[0];
  const existingEntry = this.historicalValues.find(entry => 
    entry.date.toISOString().split('T')[0] === today
  );

  if (existingEntry) {
    existingEntry.value = this.currentValue;
  } else {
    this.historicalValues.push({
      date: new Date(),
      value: this.currentValue
    });
  }

  // Keep only last 2 years of data
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  this.historicalValues = this.historicalValues.filter(
    entry => entry.date >= twoYearsAgo
  );
};

// Minimum data requirements for return calculations
const MINIMUM_DATA_REQUIREMENTS = {
  7: 3,       // 1 week requires 3 days
  30: 14,     // 1 month requires 14 days
  90: 30,     // 3 months requires 30 days
  180: 60,    // 6 months requires 60 days
  365: 90,    // 1 year requires 90 days
  1095: 548,  // 3 years requires 1.5 years (548 days)
  'cagr': 730 // CAGR requires 2 years (730 days)
};

// CAGR calculation
PortfolioSchema.methods.calculateCAGR = function() {
  const minDays = MINIMUM_DATA_REQUIREMENTS.cagr;
  if (this.daysSinceCreation < minDays) return "0%";
  if (!this.minInvestment || this.minInvestment <= 0) return "0%";

  const years = this.daysSinceCreation / 365.25;
  const ratio = this.currentValue / this.minInvestment;

  if (ratio <= 0) return "0%";

  const cagr = (Math.pow(ratio, 1/years) - 1);
  return `${(cagr * 100).toFixed(2)}%`;
};

// Period gain calculation with minimum data requirements
PortfolioSchema.methods.calculatePeriodGain = function(periodDays) {
  const minDays = MINIMUM_DATA_REQUIREMENTS[periodDays] || 1;
  
  // Return 0% if minimum data not met
  if (this.daysSinceCreation < minDays) return "0%";
  if (this.historicalValues.length < 2) return "0%";

  // Use portfolio's actual age if less than requested period
  const effectiveDays = Math.min(periodDays, this.daysSinceCreation);
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - effectiveDays);

  // Find closest historical record to target date
  let closestRecord = null;
  let minDiff = Infinity;

  this.historicalValues.forEach(entry => {
    const diff = Math.abs(entry.date - targetDate);
    if (diff < minDiff) {
      minDiff = diff;
      closestRecord = entry;
    }
  });

  if (!closestRecord || closestRecord.value <= 0) return "0%";

  const gainPercent = ((this.currentValue - closestRecord.value) / closestRecord.value) * 100;
  return `${gainPercent.toFixed(2)}%`;
};

// Initialize gains for existing portfolios
PortfolioSchema.statics.initializeGains = async function() {
  const portfolios = await this.find();
  const results = [];

  for (const portfolio of portfolios) {
    try {
      portfolio.CAGRSinceInception = portfolio.calculateCAGR();
      portfolio.monthlyGains = portfolio.calculatePeriodGain(30);
      portfolio.oneYearGains = portfolio.calculatePeriodGain(365);
      await portfolio.save();
      results.push({ id: portfolio._id, status: 'success' });
    } catch (error) {
      results.push({ id: portfolio._id, status: 'error', error: error.message });
    }
  }

  return results;
};

// Recalculate all gains
PortfolioSchema.methods.recalculateGains = function() {
  this.CAGRSinceInception = this.calculateCAGR();
  this.monthlyGains = this.calculatePeriodGain(30);
  this.oneYearGains = this.calculatePeriodGain(365);
  return this;
};

PortfolioSchema.index({ name: 1 }, { unique: true });
module.exports = mongoose.model('Portfolio', PortfolioSchema);