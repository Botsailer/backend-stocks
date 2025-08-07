const mongoose = require('mongoose');
const { Schema } = mongoose;

const stockSymbolSchema = new Schema({
  symbol: {
    type: String,
    required: true,
    uppercase: true,
    index: true
  },
  exchange: {
    type: String,
    required: true,
    enum: [
      // Major Stock Exchanges
      'NYSE', 'NASDAQ', 'LSE', 'TSE', 'HKEX', 'SSE', 'SZSE', 'NSE', 'BSE', 
      'ASX', 'TSX', 'EURONEXT', 'XETRA', 'SIX', 'BIT', 'JSE', 'MOEX', 
      'KOSPI', 'SET', 'PSX', 'IDX', 'KLSE', 'SGX', 'TASE', 'EGX', 'BMV', 
      'BVC', 'BOVESPA',
      
      // Commodity Exchanges
      'MCX', 'NCDEX', 'ICEX', 'CBOT', 'CME', 'NYMEX', 'COMEX', 'LME', 
      'ICE', 'SHFE', 'DCE', 'ZCE', 'TOCOM', 'SAFEX', 'EEX', 'EUREX',
      
      // Forex/Currency
      'FOREX', 'FX',
      
      // Cryptocurrency Exchanges
      'CRYPTO', 'BINANCE', 'COINBASE', 'KRAKEN', 'BITSTAMP',
      
      // Mutual Funds & ETFs
      'MUTUAL', 'ETF', 'MF',
      
      // Bonds
      'BOND', 'CORPORATE_BOND', 'GOVT_BOND',
      
      // Derivatives
      'DERIVATIVES', 'FUTURES', 'OPTIONS',
      
      // Energy Markets
      'ENERGY', 'OIL', 'GAS',
      
      // Precious Metals
      'GOLD', 'SILVER', 'PLATINUM', 'PALLADIUM'
    ],
    uppercase: true,
    default: 'NSE'
  }, 
  name: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  currentPrice: {
    type: String,
    required: true
  },
  previousPrice: {
    type: String,
    required: false // Previous day's close, set by cron
  },
  todayClosingPrice: {
    type: String,
    required: false // Today's close, set by cron
  },
  closingPriceUpdatedAt: {
    type: Date, // Tracks when todayClosingPrice was last set
    required: false
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  // Additional fields
  currency: {
    type: String,
    default: 'INR',
    uppercase: true
  },
  sector: {
    type: String,
    trim: true
  },
  marketCap: {
    type: String
  },
  volume: {
    type: String
  },
  high52Week: {
    type: String
  },
  low52Week: {
    type: String
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { 
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.__v;
      delete ret.id;
      return ret;
    }
  },
  toObject: {
    virtuals: true
  }
});

// Compound index for symbol and exchange
stockSymbolSchema.index({ symbol: 1, exchange: 1 }, { unique: true });

// Text index for searching
stockSymbolSchema.index({ 
  symbol: 'text', 
  name: 'text',
  sector: 'text'
});

// Virtual for price change percentage
stockSymbolSchema.virtual('priceChangePercent').get(function() {
  if (!this.previousPrice || !this.currentPrice) return 0;
  const current = parseFloat(this.currentPrice);
  const previous = parseFloat(this.previousPrice);
  if (previous === 0) return 0;
  return ((current - previous) / previous * 100).toFixed(2);
});

// Virtual for price change amount
stockSymbolSchema.virtual('priceChange').get(function() {
  if (!this.previousPrice || !this.currentPrice) return 0;
  const current = parseFloat(this.currentPrice);
  const previous = parseFloat(this.previousPrice);
  return (current - previous).toFixed(2);
});

// Pre-save middleware
stockSymbolSchema.pre('save', function(next) {
  if (this.isModified('currentPrice') && !this.isModified('todayClosingPrice')) {
    this.lastUpdated = new Date();
  }
  next();
});

// Static method to get exchange categories
stockSymbolSchema.statics.getExchangeCategories = function() {
  return {
    stock: ['NYSE', 'NASDAQ', 'LSE', 'TSE', 'HKEX', 'SSE', 'SZSE', 'NSE', 'BSE', 'ASX', 'TSX', 'EURONEXT', 'XETRA', 'SIX', 'BIT', 'JSE', 'MOEX', 'KOSPI', 'SET', 'PSX', 'IDX', 'KLSE', 'SGX', 'TASE', 'EGX', 'BMV', 'BVC', 'BOVESPA'],
    commodity: ['MCX', 'NCDEX', 'ICEX', 'CBOT', 'CME', 'NYMEX', 'COMEX', 'LME', 'ICE', 'SHFE', 'DCE', 'ZCE', 'TOCOM', 'SAFEX', 'EEX', 'EUREX'],
    forex: ['FOREX', 'FX'],
    crypto: ['CRYPTO', 'BINANCE', 'COINBASE', 'KRAKEN', 'BITSTAMP'],
    funds: ['MUTUAL', 'ETF', 'MF'],
    bonds: ['BOND', 'CORPORATE_BOND', 'GOVT_BOND'],
    derivatives: ['DERIVATIVES', 'FUTURES', 'OPTIONS'],
    energy: ['ENERGY', 'OIL', 'GAS'],
    metals: ['GOLD', 'SILVER', 'PLATINUM', 'PALLADIUM']
  };
};

// Static method to validate exchange
stockSymbolSchema.statics.isValidExchange = function(exchange) {
  const categories = this.getExchangeCategories();
  return Object.values(categories).flat().includes(exchange.toUpperCase());
};

// Instance method to get exchange category
stockSymbolSchema.methods.getExchangeCategory = function() {
  const categories = this.constructor.getExchangeCategories();
  for (const [category, exchanges] of Object.entries(categories)) {
    if (exchanges.includes(this.exchange)) {
      return category;
    }
  }
  return 'unknown';
};

module.exports = mongoose.model('StockSymbol', stockSymbolSchema);