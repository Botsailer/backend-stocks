/*
 * models/Portfolio.js
 * -------------------
 * Mongoose schema for the Portfolio model.
 * Fields:
 *   - name (String, required, unique)
 *   - description (String)
 *   - cashRemaining (Number)
 *   - subscriptionFee (Number, required)
 *   - minInvestment (Number, required)
 *   - durationMonths (Number, required)
 *   - expiryDate (Date)
 *   - holdings (Array of subdocuments)
 * 
 * Usage:
 *   const Portfolio = require('../models/Portfolio');
 */
const mongoose = require('mongoose');
const { Schema } = mongoose;

// Subdocument: individual stock holding
const StockHoldingSchema = new Schema({
  symbol: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    index: true,
  },
  weight: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  sector: {
    type: String,
    required: true,
    trim: true,
  },
  status: {
    type: String,
    enum: ['Hold', 'Fresh-Buy', 'partial-sell', 'addon-buy', 'Sell'],
    default: 'Hold',
  },
}, { _id: false });

const PortfolioSchema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  description: {
    type: String,
    default: ''
  },
  cashRemaining: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
  subscriptionFee: {
    type: Number,
    required: true,
    min: 0,
  },
  minInvestment: {
    type: Number,
    required: true,
    min: 0,
  },
  durationMonths: {
    type: Number,
    required: true,
    min: 1,
  },
  expiryDate: {
    type: Date,
    required: true,
  },
  holdings: {
    type: [StockHoldingSchema],
    default: []
  }
}, { timestamps: true });

// Pre-validate hook to compute expiryDate based on createdAt + durationMonths
PortfolioSchema.pre('validate', function(next) {
  if (!this.expiryDate && this.durationMonths) {
    const start = this.createdAt || new Date();
    const expire = new Date(start);
    expire.setMonth(expire.getMonth() + this.durationMonths);
    this.expiryDate = expire;
  }
  next();
});

// Index on name for fast lookup and unique constraint
PortfolioSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('Portfolio', PortfolioSchema);
