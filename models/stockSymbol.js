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
      'NYSE',           // New York Stock Exchange
      'NASDAQ',         // NASDAQ Stock Market
      'LSE',            // London Stock Exchange
      'TSE',            // Tokyo Stock Exchange
      'HKEX',           // Hong Kong Stock Exchange
      'SSE',            // Shanghai Stock Exchange
      'SZSE',           // Shenzhen Stock Exchange
      'NSE',            // National Stock Exchange of India
      'BSE',            // Bombay Stock Exchange
      'ASX',            // Australian Securities Exchange
      'TSX',            // Toronto Stock Exchange
      'EURONEXT',       // Euronext (Pan-European)
      'XETRA',          // Deutsche Börse XETRA
      'SIX',            // SIX Swiss Exchange
      'BIT',            // Borsa Italiana
      'JSE',            // Johannesburg Stock Exchange
      'MOEX',           // Moscow Exchange
      'KOSPI',          // Korea Stock Exchange
      'SET',            // Stock Exchange of Thailand
      'PSX',            // Pakistan Stock Exchange
      'IDX',            // Indonesia Stock Exchange
      'KLSE',           // Bursa Malaysia
      'SGX',            // Singapore Exchange
      'TASE',           // Tel Aviv Stock Exchange
      'EGX',            // Egyptian Exchange
      'BMV',            // Mexican Stock Exchange
      'BVC',            // Colombia Stock Exchange
      'BOVESPA',        // Brazil Stock Exchange (B3)
      
      // Commodity Exchanges
      'MCX',            // Multi Commodity Exchange of India
      'NCDEX',          // National Commodity & Derivatives Exchange
      'ICEX',           // Indian Commodity Exchange
      'CBOT',           // Chicago Board of Trade
      'CME',            // Chicago Mercantile Exchange
      'NYMEX',          // New York Mercantile Exchange
      'COMEX',          // Commodity Exchange (part of NYMEX)
      'LME',            // London Metal Exchange
      'ICE',            // Intercontinental Exchange
      'SHFE',           // Shanghai Futures Exchange
      'DCE',            // Dalian Commodity Exchange
      'ZCE',            // Zhengzhou Commodity Exchange
      'TOCOM',          // Tokyo Commodity Exchange
      'SAFEX',          // South African Futures Exchange
      'EEX',            // European Energy Exchange
      'EUREX',          // Eurex Exchange
      
      // Forex/Currency
      'FOREX',          // Foreign Exchange Market
      'FX',             // FX Market
      
      // Cryptocurrency Exchanges
      'CRYPTO',         // General Crypto
      'BINANCE',        // Binance
      'COINBASE',       // Coinbase
      'KRAKEN',         // Kraken
      'BITSTAMP',       // Bitstamp
      
      // Mutual Funds & ETFs
      'MUTUAL',         // Mutual Funds
      'ETF',            // Exchange Traded Funds
      'MF',             // Mutual Funds (Short)
      
      // Bonds
      'BOND',           // General Bonds
      'CORPORATE_BOND', // Corporate Bonds
      'GOVT_BOND',      // Government Bonds
      
      // Derivatives
      'DERIVATIVES',    // General Derivatives
      'FUTURES',        // Futures Contracts
      'OPTIONS',        // Options Contracts
      
      // Energy Markets
      'ENERGY',         // General Energy
      'OIL',            // Oil Markets
      'GAS',            // Gas Markets
      
      // Precious Metals
      'GOLD',           // Gold Trading
      'SILVER',         // Silver Trading
      'PLATINUM',       // Platinum Trading
      'PALLADIUM'       // Palladium Trading
    ],
    uppercase: true,
    default: 'NSE'  // Default to Indian exchange
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
    required: true,
    default: function() {
      return this.currentPrice;
    }
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  // Additional fields for better tracking
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

// Compound index for symbol and exchange (must be unique together)
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

// Pre-save middleware to update lastUpdated when price changes
stockSymbolSchema.pre('save', function(next) {
  if (this.isModified('currentPrice')) {
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