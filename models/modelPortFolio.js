// models/Portfolio.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Subdocument: individual stock holding
 * - symbol: ticker symbol, uppercase, indexed
 * - weight: percent allocation of minInvestment
 * - sector: sector name
 * - status: lifecycle state of the holding
 * - price: the base price recorded at creation/most recent reset
 */
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
    required: true,
    min: 0,
    max: 100
  },
  sector: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['Hold', 'Fresh-Buy', 'partial-sell', 'addon-buy', 'Sell'],
    default: 'Hold'
  },
  // Base price per share (or unit) at time of portfolio creation/last rebase
  price: {
    type: Number,
    required: true,
    min: 0
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
    type: String,
    default: ''
  },
  // Cash buffer above minInvestment: admin can spend up to this amount
  cashRemaining: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  subscriptionFee: {
    type: Number,
    required: true,
    min: 0
  },
  minInvestment: {
    type: Number,
    required: true,
    min: 0
  },
  durationMonths: {
    type: Number,
    required: true,
    min: 1
  },
  expiryDate: {
    type: Date,
    required: true
  },
  // Array of holdings with base prices
  holdings: {
    type: [StockHoldingSchema],
    default: []
  }
}, { timestamps: true });

// Auto-calculate expiryDate from createdAt + durationMonths
PortfolioSchema.pre('validate', function(next) {
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
