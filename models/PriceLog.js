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

PriceLogSchema.index(
  { 
    portfolio: 1, 
    dateOnly: 1 
  }, 
  { 
    unique: true,
    sparse: true
  }
);

PriceLogSchema.virtual('dateOnly').get(function() {
  if (this.date) {
    const d = new Date(this.date);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  return null;
});

// Pre-save middleware to set dateOnly field
PriceLogSchema.pre('save', function(next) {
  if (this.date) {
    const d = new Date(this.date);
    this.dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  next();
});

module.exports = mongoose.model('PriceLog', PriceLogSchema);
