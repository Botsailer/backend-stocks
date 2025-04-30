// Schema for daily price logs of portfolio holdings
const mongoose = require('mongoose');
const { Schema } = mongoose;

const PriceLogSchema = new Schema({
    portfolio: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Portfolio',
      required: true,
      index: true
    },
    symbol: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },
    date: {
      type: Date,
      required: true
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    value: {
      type: Number,
      required: true,
      min: 0
    }
  }, { timestamps: false });
  
  // Prevent duplicate entries for same stock on same day
  PriceLogSchema.index({ portfolio: 1, symbol: 1, date: 1 }, { unique: true });
  
  module.exports = mongoose.model('PriceLog', PriceLogSchema);
  