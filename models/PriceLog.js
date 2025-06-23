// models/PriceLog.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Records a daily snapshot of an entire portfolio’s performance:
 * - portfolio: ObjectId of the Portfolio
 * - date: timestamp of the snapshot
 * - portfolioValue: total value across all holdings (baseSum + net change)
 * - cashRemaining: updated cash buffer after threshold enforcement
 */
const PriceLogSchema = new Schema({
  portfolio: {
    type: Schema.Types.ObjectId,
    ref: 'Portfolio',
    required: true
  },
  date: {
    type: Date,
    required: true,
    default: () => new Date()
  },
  portfolioValue: {
    type: Number,
    required: true,
    min: 0
  },
  cashRemaining: {
    type: Number,
    required: true,
    min: 0
  }
}, { timestamps: true });

PriceLogSchema.index({ portfolio: 1, date: 1 });  // For time-based queries
PriceLogSchema.index({ date: 1 });                // For global historical analysis

module.exports = mongoose.model('PriceLog', PriceLogSchema);
