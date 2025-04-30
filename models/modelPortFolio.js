const mongoose = require('mongoose');
const { Schema } = mongoose;

// Schema for an individual stock holding within a portfolio
const StockHoldingSchema = new Schema({
  symbol: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    index: true  // index for faster lookup by symbol if needed
  },
  weight: {
    type: Number,
    required: true,
    min: 0,
    max: 100  // assuming weight is a percentage
  },
  sector: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['Hold', 'Fresh-Buy', 'partial-sell', 'addon-buy','Sell'],  // example statuses
    default: 'Hold'
  }
}, { _id: false }); // disable separate _id for subdocs (optional)

// Main Portfolio schema
const PortfolioSchema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,    // creates a unique index (not a validator)&#8203;:contentReference[oaicite:4]{index=4}
    trim: true
  },
  description: {
    type: String,      // rich-text from TinyMCE (store HTML)
    default: ''
  },
  cashRemaining: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  holdings: {
    type: [StockHoldingSchema],  // embed holdings as subdocuments
    default: []
  }
}, { timestamps: true });

// Example index: ensure name is unique
PortfolioSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('Portfolio', PortfolioSchema);
