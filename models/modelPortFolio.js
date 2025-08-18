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
  // Reference to StockSymbol collection for real-time price data
  stockRef: {
    type: Schema.Types.ObjectId,
    ref: 'StockSymbol',
    required: false // Will be populated automatically based on symbol
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
  originalBuyPrice: {
    type: Number,
    required: false,
    min: 0.01,
    // Preserve the first purchase price for comparison
  },
  minimumInvestmentValueStock: {
    type: Number,
    min: 1
  },
  quantity: {
    type: Number,
    required: true,
    min: 0 ,
    set: v => Math.round(v * 100) / 100
  },
  // Investment value at buy price (buyPrice * quantity)
  investmentValueAtBuy: {
    type: Number,
    default: 0,
    // This will be buyPrice * quantity
  },
  // Investment value at current market price (currentPrice * quantity)
  investmentValueAtMarket: {
    type: Number,
    default: 0,
    // This will be currentPrice * quantity
  },
  // Current market price of the stock
  currentPrice: {
    type: Number,
    default: 0,
    min: 0
  },
  // Unrealized PnL (difference between market value and buy value)
  unrealizedPnL: {
    type: Number,
    default: 0,
    // investmentValueAtMarket - investmentValueAtBuy
  },
  // Unrealized PnL percentage
  unrealizedPnLPercent: {
    type: Number,
    default: 0,
    // ((investmentValueAtMarket - investmentValueAtBuy) / investmentValueAtBuy) * 100
  },
  realizedPnL: {
    type: Number,
    default: 0,
    // Track cumulative realized profit/loss from sales
  },
  priceHistory: [{
    date: {
      type: Date,
      default: Date.now
    },
    price: {
      type: Number,
      required: true,
      min: 0.01
    },
    quantity: {
      type: Number,
      required: true
      // Positive for purchases, negative for sales
    },
    investment: {
      type: Number,
      required: false
    },
    saleValue: {
      type: Number,
      required: false
    },
    profitLoss: {
      type: Number,
      required: false
    },
    action: {
      type: String,
      enum: ['buy', 'sell', 'partial_sell', 'complete_sell'],
      required: true
    }
  }],
  soldDate: {
    type: Date,
    required: false
    // Date when position was completely sold
  },
  finalSalePrice: {
    type: Number,
    required: false,
    min: 0.01
  },
  totalSaleValue: {
    type: Number,
    required: false
  },
  totalProfitLoss: {
    type: Number,
    required: false
  },
  lastSaleDate: {
    type: Date,
    required: false
    // Date of last partial sale
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// Virtual to get current price from populated stockRef
StockHoldingSchema.virtual('marketPrice').get(function() {
  if (this.stockRef && this.stockRef.currentPrice) {
    // Use todayClosingPrice if available and recent, otherwise use currentPrice
    const useClosingPrice = this.stockRef.todayClosingPrice && 
      this.stockRef.closingPriceUpdatedAt && 
      (Date.now() - this.stockRef.closingPriceUpdatedAt.getTime()) < 24 * 60 * 60 * 1000;
    
    return useClosingPrice ? this.stockRef.todayClosingPrice : this.stockRef.currentPrice;
  }
  return this.currentPrice || this.buyPrice || 0;
});

// Virtual for investment value at current market price using populated data
StockHoldingSchema.virtual('marketInvestmentValue').get(function() {
  return parseFloat((this.marketPrice * this.quantity).toFixed(2));
});

// Virtual for unrealized PnL using populated data
StockHoldingSchema.virtual('marketUnrealizedPnL').get(function() {
  const investmentAtBuy = this.investmentValueAtBuy || (this.buyPrice * this.quantity);
  const investmentAtMarket = this.marketInvestmentValue;
  return parseFloat((investmentAtMarket - investmentAtBuy).toFixed(2));
});

// Virtual for unrealized PnL percentage using populated data
StockHoldingSchema.virtual('marketUnrealizedPnLPercent').get(function() {
  const investmentAtBuy = this.investmentValueAtBuy || (this.buyPrice * this.quantity);
  if (investmentAtBuy > 0) {
    return parseFloat(((this.marketUnrealizedPnL / investmentAtBuy) * 100).toFixed(2));
  }
  return 0;
});

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
        
        // Check if the referenced symbol exists by either symbol name or ID
        const StockSymbol = mongoose.model('StockSymbol');
        
        // If it looks like a MongoDB ObjectId, check by ID
        if (/^[0-9a-fA-F]{24}$/.test(value)) {
          const symbolExistsById = await StockSymbol.exists({ _id: value });
          return symbolExistsById;
        }
        
        // Otherwise check by symbol name
        const symbolExistsByName = await StockSymbol.exists({ symbol: value });
        return symbolExistsByName;
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
  saleHistory: [{
    symbol: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },
    soldDate: {
      type: Date,
      required: true
    },
    originalQuantity: {
      type: Number,
      required: true,
      min: 0
    },
    salePrice: {
      type: Number,
      required: true,
      min: 0
    },
    saleValue: {
      type: Number,
      required: true,
      min: 0
    },
    profitLoss: {
      type: Number,
      required: true
    },
    originalBuyPrice: {
      type: Number,
      required: true,
      min: 0
    }
  }],
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
  return this.holdings?.reduce((sum, holding) => {
    const buyPrice = parseFloat(holding.currentPrice) || 0;
    const quantity = parseFloat(holding.quantity) || 0;
    return sum + (buyPrice * quantity);
  }, 0) || 0;
});

// Virtual for holdings value at current market prices using populated data
PortfolioSchema.virtual('holdingsValueAtMarket').get(function() {
  return this.holdings?.reduce((sum, holding) => {
    // Use marketInvestmentValue virtual if stockRef is populated, otherwise use stored value
    const marketValue = holding.marketInvestmentValue || holding.investmentValueAtMarket || 0;
    return sum + marketValue;
  }, 0) || 0;
});

// Virtual for total unrealized PnL across all holdings using populated data
PortfolioSchema.virtual('totalUnrealizedPnL').get(function() {
  return this.holdings?.reduce((sum, holding) => {
    // Use marketUnrealizedPnL virtual if stockRef is populated, otherwise use stored value
    const pnl = holding.marketUnrealizedPnL || holding.unrealizedPnL || 0;
    return sum + pnl;
  }, 0) || 0;
});

// Virtual for total unrealized PnL percentage using populated data
PortfolioSchema.virtual('totalUnrealizedPnLPercent').get(function() {
  const totalInvestmentAtBuy = this.holdingsValue;
  if (totalInvestmentAtBuy > 0) {
    return parseFloat(((this.totalUnrealizedPnL / totalInvestmentAtBuy) * 100).toFixed(2));
  }
  return 0;
});

PortfolioSchema.virtual('daysSinceCreation').get(function() {
  if (!this.createdAt) return 0;
  return Math.floor((Date.now() - this.createdAt) / 86400000);
});

// Pre-save hook for data consistency and stockRef linking
PortfolioSchema.pre('save', async function(next) {
  // Sanitize holdings data to prevent NaN values
  this.holdings.forEach(holding => {
    holding.buyPrice = parseFloat(holding.buyPrice) || 0;
    holding.quantity = parseFloat(holding.quantity) || 0;
    holding.weight = parseFloat(holding.weight) || 0;
    holding.minimumInvestmentValueStock = parseFloat(holding.minimumInvestmentValueStock) || 0;
    holding.realizedPnL = parseFloat(holding.realizedPnL) || 0;
  });

  // Auto-link stockRef for holdings and calculate PnL
  if (this.holdings && this.holdings.length > 0) {
    const StockSymbol = mongoose.model('StockSymbol');
    const symbols = this.holdings.map(h => h.symbol);
    
    try {
      // Fetch stock symbols with their IDs and prices
      const stocks = await StockSymbol.find({ 
        symbol: { $in: symbols },
        $or: [
          { isActive: true },
          { isActive: { $exists: false } } // Include symbols without isActive field
        ]
      }).select('_id symbol currentPrice todayClosingPrice closingPriceUpdatedAt');
      
      const stockMap = new Map();
      stocks.forEach(stock => {
        stockMap.set(stock.symbol, {
          _id: stock._id,
          currentPrice: stock.currentPrice,
          todayClosingPrice: stock.todayClosingPrice,
          closingPriceUpdatedAt: stock.closingPriceUpdatedAt
        });
      });

      // Update holdings with stockRef and calculate PnL
      this.holdings.forEach(holding => {
        const stockData = stockMap.get(holding.symbol);
        
        // Auto-link stockRef if not already set
        if (stockData && !holding.stockRef) {
          holding.stockRef = stockData._id;
        }
        
        // Calculate investment value at buy price (preserve original buy price tracking)
        holding.investmentValueAtBuy = parseFloat((holding.buyPrice * holding.quantity).toFixed(2));
        
        // Get current market price from StockSymbol collection
        if (stockData) {
          // Use todayClosingPrice if available and recent, otherwise use currentPrice
          const useClosingPrice = stockData.todayClosingPrice && 
            stockData.closingPriceUpdatedAt && 
            (Date.now() - stockData.closingPriceUpdatedAt.getTime()) < 24 * 60 * 60 * 1000;
          
          holding.currentPrice = useClosingPrice ? stockData.todayClosingPrice : stockData.currentPrice;
        } else {
          // Fallback to buy price if stock not found in database
          holding.currentPrice = holding.buyPrice || 0;
        }
        
        // Calculate investment value at current market price
        holding.investmentValueAtMarket = parseFloat((holding.currentPrice * holding.quantity).toFixed(2));
        
        // Calculate unrealized PnL
        holding.unrealizedPnL = parseFloat((holding.investmentValueAtMarket - holding.investmentValueAtBuy).toFixed(2));
        
        // Calculate unrealized PnL percentage
        if (holding.investmentValueAtBuy > 0) {
          holding.unrealizedPnLPercent = parseFloat(((holding.unrealizedPnL / holding.investmentValueAtBuy) * 100).toFixed(2));
        } else {
          holding.unrealizedPnLPercent = 0;
        }
        
        // Update minimumInvestmentValueStock to current market value
        holding.minimumInvestmentValueStock = holding.investmentValueAtMarket;
      });
    } catch (error) {
      // Continue with fallback calculations if database fetch fails
      // Continue with fallback calculations if database fetch fails
      this.holdings.forEach(holding => {
        holding.investmentValueAtBuy = parseFloat((holding.buyPrice * holding.quantity).toFixed(2));
        holding.currentPrice = parseFloat(holding.currentPrice) || holding.buyPrice || 0;
        holding.investmentValueAtMarket = parseFloat((holding.currentPrice * holding.quantity).toFixed(2));
        holding.unrealizedPnL = parseFloat((holding.investmentValueAtMarket - holding.investmentValueAtBuy).toFixed(2));
        
        if (holding.investmentValueAtBuy > 0) {
          holding.unrealizedPnLPercent = parseFloat(((holding.unrealizedPnL / holding.investmentValueAtBuy) * 100).toFixed(2));
        } else {
          holding.unrealizedPnLPercent = 0;
        }
        
        // Update minimumInvestmentValueStock to current market value only for active holdings
        // Do not update for sold stocks to preserve original investment tracking
        if (holding.status !== 'Sell' && holding.quantity > 0) {
          holding.minimumInvestmentValueStock = holding.investmentValueAtMarket;
        }
      });
    }
  }

  // Ensure cashBalance is valid
  this.cashBalance = parseFloat(this.cashBalance) || 0;
  if (isNaN(this.cashBalance)) {
    this.cashBalance = 0;
  }

  // Calculate total portfolio value using current market prices
  const holdingsValueAtMarket = this.holdings.reduce((sum, holding) => {
    return sum + (holding.investmentValueAtMarket || 0);
  }, 0);

  // Only auto-calculate currentValue if it's not explicitly being set
  // (allows manual updates from real-time calculations)
  if (!this.isModified('currentValue')) {
    this.currentValue = this.cashBalance + holdingsValueAtMarket;
  }

  // Ensure currentValue is valid
  this.currentValue = parseFloat(this.currentValue) || 0;
  if (isNaN(this.currentValue)) {
    this.currentValue = 0;
  }

  // Update holding weights based on current market value
  this.holdings.forEach(holding => {
    const holdingMarketValue = holding.investmentValueAtMarket || 0;
    holding.weight = this.currentValue > 0 ? 
      parseFloat(((holdingMarketValue / this.currentValue) * 100).toFixed(2)) : 0;
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

PortfolioSchema.methods.addHistoricalValue = function(value) {
  const today = new Date();
  const existingIndex = this.historicalValues.findIndex(entry => 
    entry.date.toDateString() === today.toDateString()
  );

  if (existingIndex >= 0) {
    this.historicalValues[existingIndex].value = value;
  } else {
    this.historicalValues.push({
      date: today,
      value: value
    });
    
    // Keep only last 2 years of data
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    this.historicalValues = this.historicalValues.filter(
      entry => entry.date >= twoYearsAgo
    );
  }
};

// Update pre-save hook - REMOVED duplicate
// This is now handled in the main pre-save hook above

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

// Static method to find portfolio with populated stock references
PortfolioSchema.statics.findWithMarketPrices = function(query = {}) {
  return this.find(query).populate({
    path: 'holdings.stockRef',
    select: 'symbol currentPrice todayClosingPrice closingPriceUpdatedAt lastUpdated isActive',
    match: { isActive: true }
  });
};

// Static method to find one portfolio with populated stock references
PortfolioSchema.statics.findOneWithMarketPrices = function(query = {}) {
  return this.findOne(query).populate({
    path: 'holdings.stockRef',
    select: 'symbol currentPrice todayClosingPrice closingPriceUpdatedAt lastUpdated isActive',
    match: { isActive: true }
  });
};

// Static method to find portfolio by ID with populated stock references
PortfolioSchema.statics.findByIdWithMarketPrices = function(id) {
  return this.findById(id).populate({
    path: 'holdings.stockRef',
    select: 'symbol currentPrice todayClosingPrice closingPriceUpdatedAt lastUpdated isActive',
    match: { isActive: true }
  });
};

// Static method to update all portfolios with current market prices
PortfolioSchema.statics.updateAllWithMarketPrices = async function() {
  const StockSymbol = mongoose.model('StockSymbol');
  const portfolios = await this.find({});
  const results = [];
  
  for (const portfolio of portfolios) {
    try {
      if (portfolio.holdings && portfolio.holdings.length > 0) {
        const symbols = portfolio.holdings.map(h => h.symbol);
        
        // Fetch current prices from StockSymbol collection
        const stocks = await StockSymbol.find({ 
          symbol: { $in: symbols },
          $or: [
            { isActive: true },
            { isActive: { $exists: false } } // Include symbols without isActive field
          ]
        }).select('_id symbol currentPrice todayClosingPrice closingPriceUpdatedAt');
        
      const stockMap = new Map();
      stocks.forEach(stock => {
        stockMap.set(stock.symbol, {
          _id: stock._id,
          currentPrice: stock.currentPrice,
          todayClosingPrice: stock.todayClosingPrice,
          closingPriceUpdatedAt: stock.closingPriceUpdatedAt
        });
      });

      let hasUpdates = false;
        
        // Update holdings with current prices
        portfolio.holdings.forEach(holding => {
          const stockData = stockMap.get(holding.symbol);
          
          if (stockData) {
            // Auto-link stockRef if not already set
            if (!holding.stockRef) {
              holding.stockRef = stockData._id;
            }
            
            // Use todayClosingPrice if available and recent, otherwise use currentPrice
            const useClosingPrice = stockData.todayClosingPrice && 
              stockData.closingPriceUpdatedAt && 
              (Date.now() - stockData.closingPriceUpdatedAt.getTime()) < 24 * 60 * 60 * 1000;
            
            const newCurrentPrice = useClosingPrice ? stockData.todayClosingPrice : stockData.currentPrice;
            
            // Only update if price has changed
            if (holding.currentPrice !== newCurrentPrice) {
              holding.currentPrice = newCurrentPrice;
              hasUpdates = true;
            }
            
            // Recalculate investment values and PnL
            holding.investmentValueAtBuy = parseFloat((holding.buyPrice * holding.quantity).toFixed(2));
            holding.investmentValueAtMarket = parseFloat((holding.currentPrice * holding.quantity).toFixed(2));
            holding.unrealizedPnL = parseFloat((holding.investmentValueAtMarket - holding.investmentValueAtBuy).toFixed(2));
            
            if (holding.investmentValueAtBuy > 0) {
              holding.unrealizedPnLPercent = parseFloat(((holding.unrealizedPnL / holding.investmentValueAtBuy) * 100).toFixed(2));
            } else {
              holding.unrealizedPnLPercent = 0;
            }
            
            holding.minimumInvestmentValueStock = holding.investmentValueAtMarket;
          } else {
            // Stock data not found - will use fallback price
          }
        });
        
        if (hasUpdates) {
          // Recalculate total portfolio value
          const holdingsValueAtMarket = portfolio.holdings.reduce((sum, holding) => {
            return sum + (holding.investmentValueAtMarket || 0);
          }, 0);
          
          portfolio.currentValue = parseFloat((portfolio.cashBalance + holdingsValueAtMarket).toFixed(2));
          
          // Update weights
          portfolio.holdings.forEach(holding => {
            const holdingMarketValue = holding.investmentValueAtMarket || 0;
            holding.weight = portfolio.currentValue > 0 ? 
              parseFloat(((holdingMarketValue / portfolio.currentValue) * 100).toFixed(2)) : 0;
          });
          
          await portfolio.save();
          results.push({ 
            portfolioId: portfolio._id, 
            name: portfolio.name,
            status: 'updated',
            newValue: portfolio.currentValue 
          });
        } else {
          results.push({ 
            portfolioId: portfolio._id, 
            name: portfolio.name,
            status: 'no_changes' 
          });
        }
      } else {
        results.push({ 
          portfolioId: portfolio._id, 
          name: portfolio.name,
          status: 'no_holdings' 
        });
      }
    } catch (error) {
      results.push({ 
        portfolioId: portfolio._id, 
        name: portfolio.name,
        status: 'error', 
        error: error.message 
      });
    }
  }
  
  return results;
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

// Method to add or update a stock holding with buy price averaging
PortfolioSchema.methods.addOrUpdateHolding = function(symbol, newBuyPrice, newQuantity, sector, stockCapType = null, status = 'Hold') {
  const existingHoldingIndex = this.holdings.findIndex(h => h.symbol === symbol);
  
  if (existingHoldingIndex >= 0) {
    // Update existing holding with weighted average buy price
    const existingHolding = this.holdings[existingHoldingIndex];
    const existingValue = existingHolding.buyPrice * existingHolding.quantity;
    const newValue = newBuyPrice * newQuantity;
    const totalQuantity = existingHolding.quantity + newQuantity;
    const totalValue = existingValue + newValue;
    
    // Store original buy price if not already set
    if (!existingHolding.originalBuyPrice) {
      existingHolding.originalBuyPrice = existingHolding.buyPrice;
    }
    
    // Calculate weighted average buy price
    existingHolding.buyPrice = parseFloat((totalValue / totalQuantity).toFixed(2));
    existingHolding.quantity = totalQuantity;
    existingHolding.status = status;
    existingHolding.lastUpdated = new Date();
    
    // Add to price history
    existingHolding.priceHistory.push({
      date: new Date(),
      price: newBuyPrice,
      quantity: newQuantity,
      investment: newValue,
      action: 'buy'
    });
    
    return existingHolding;
  } else {
    // Create new holding
    const newHolding = {
      symbol: symbol.toUpperCase(),
      sector: sector,
      stockCapType: stockCapType,
      status: status,
      buyPrice: newBuyPrice,
      originalBuyPrice: newBuyPrice,
      quantity: newQuantity,
      minimumInvestmentValueStock: newBuyPrice * newQuantity,
      currentPrice: newBuyPrice, // Will be updated by pre-save hook
      investmentValueAtBuy: newBuyPrice * newQuantity,
      investmentValueAtMarket: newBuyPrice * newQuantity, // Will be updated by pre-save hook
      unrealizedPnL: 0,
      unrealizedPnLPercent: 0,
      realizedPnL: 0,
      priceHistory: [{
        date: new Date(),
        price: newBuyPrice,
        quantity: newQuantity,
        investment: newBuyPrice * newQuantity,
        action: 'buy'
      }],
      lastUpdated: new Date(),
      createdAt: new Date()
    };
    
    this.holdings.push(newHolding);
    return newHolding;
  }
};

// Method to sell or partially sell a holding
PortfolioSchema.methods.sellHolding = function(symbol, sellPrice, sellQuantity) {
  const holdingIndex = this.holdings.findIndex(h => h.symbol === symbol);
  
  if (holdingIndex < 0) {
    throw new Error(`Holding ${symbol} not found`);
  }
  
  const holding = this.holdings[holdingIndex];
  
  if (sellQuantity > holding.quantity) {
    throw new Error(`Cannot sell ${sellQuantity} shares. Only ${holding.quantity} available.`);
  }
  
  const saleValue = sellPrice * sellQuantity;
  const buyValueForSoldShares = holding.buyPrice * sellQuantity;
  const profitLoss = saleValue - buyValueForSoldShares;
  
  // Update realized PnL
  holding.realizedPnL += profitLoss;
  
  // Add to price history
  holding.priceHistory.push({
    date: new Date(),
    price: sellPrice,
    quantity: -sellQuantity, // Negative for sales
    saleValue: saleValue,
    profitLoss: profitLoss,
    action: sellQuantity === holding.quantity ? 'complete_sell' : 'partial_sell'
  });
  
  // Update quantity
  holding.quantity -= sellQuantity;
  holding.lastUpdated = new Date();
  
  if (holding.quantity === 0) {
    // Complete sale - move to sale history
    holding.soldDate = new Date();
    holding.finalSalePrice = sellPrice;
    holding.totalSaleValue = saleValue;
    holding.totalProfitLoss = holding.realizedPnL;
    
    this.saleHistory.push({
      symbol: holding.symbol,
      soldDate: new Date(),
      originalQuantity: holding.quantity + sellQuantity,
      salePrice: sellPrice,
      saleValue: saleValue,
      profitLoss: profitLoss,
      originalBuyPrice: holding.originalBuyPrice || holding.buyPrice
    });
    
    // Remove from holdings
    this.holdings.splice(holdingIndex, 1);
  } else {
    // Partial sale
    holding.lastSaleDate = new Date();
    holding.status = 'partial-sell';
  }
  
  return {
    soldQuantity: sellQuantity,
    saleValue: saleValue,
    profitLoss: profitLoss,
    remainingQuantity: holding.quantity || 0
  };
};

// Method to update portfolio value with current market prices from StockSymbol collection
PortfolioSchema.methods.updateWithMarketPrices = async function() {
  const StockSymbol = mongoose.model('StockSymbol');
  let totalValueAtMarket = parseFloat(this.cashBalance) || 0;
  const symbols = this.holdings.map(h => h.symbol);
  
  if (symbols.length > 0) {
    // Fetch current prices from StockSymbol collection
    const stocks = await StockSymbol.find({ 
      symbol: { $in: symbols },
      isActive: true 
    }).select('symbol currentPrice todayClosingPrice lastUpdated');
    
    const priceMap = new Map();
    stocks.forEach(stock => {
      // Use todayClosingPrice if available and recent, otherwise use currentPrice
      const useClosingPrice = stock.todayClosingPrice && 
        stock.closingPriceUpdatedAt && 
        (Date.now() - stock.closingPriceUpdatedAt.getTime()) < 24 * 60 * 60 * 1000; // Within 24 hours
      
      const marketPrice = useClosingPrice ? stock.todayClosingPrice : stock.currentPrice;
      priceMap.set(stock.symbol, marketPrice || 0);
    });

    this.holdings.forEach(holding => {
      const currentPrice = priceMap.get(holding.symbol) || holding.buyPrice || 0;
      
      // Update current price from market data
      holding.currentPrice = currentPrice;
      
      // Calculate investment values
      holding.investmentValueAtBuy = parseFloat((holding.buyPrice * holding.quantity).toFixed(2));
      holding.investmentValueAtMarket = parseFloat((currentPrice * holding.quantity).toFixed(2));
      
      // Calculate unrealized PnL
      holding.unrealizedPnL = parseFloat((holding.investmentValueAtMarket - holding.investmentValueAtBuy).toFixed(2));
      
      // Calculate unrealized PnL percentage
      if (holding.investmentValueAtBuy > 0) {
        holding.unrealizedPnLPercent = parseFloat(((holding.unrealizedPnL / holding.investmentValueAtBuy) * 100).toFixed(2));
      } else {
        holding.unrealizedPnLPercent = 0;
      }
      
      // Update minimumInvestmentValueStock to current market value
      holding.minimumInvestmentValueStock = holding.investmentValueAtMarket;
      
      totalValueAtMarket += holding.investmentValueAtMarket;
    });
    
    // Recalculate weights based on total portfolio value at market
    this.holdings.forEach(holding => {
      if (totalValueAtMarket > 0) {
        holding.weight = parseFloat(((holding.investmentValueAtMarket / totalValueAtMarket) * 100).toFixed(2));
      } else {
        holding.weight = 0;
      }
    });
  }
  
  this.currentValue = parseFloat(totalValueAtMarket.toFixed(2));
  return this;
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