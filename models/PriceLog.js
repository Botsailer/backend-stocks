// models/PriceLog.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Records a daily snapshot of an entire portfolio's performance:
 * - portfolio: ObjectId of the Portfolio
 * - date: timestamp of the snapshot
 * - dateOnly: date without time (for unique daily constraint)
 * - portfolioValue: total value across all holdings
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
  dateOnly: {
    type: Date,
    required: true
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
  },
  updateCount: {
    type: Number,
    default: 0,
    min: 0
  }
}, { timestamps: true });

// Indexes
PriceLogSchema.index({ portfolio: 1, date: 1 });  // For time-based queries
PriceLogSchema.index({ date: 1 });                // For global historical analysis

// Unique constraint: one log per portfolio per day
PriceLogSchema.index(
  { 
    portfolio: 1, 
    dateOnly: 1 
  }, 
  { 
    unique: true
  }
);

// Pre-save middleware to automatically set dateOnly
PriceLogSchema.pre('save', function(next) {
  if (this.date && !this.dateOnly) {
    const d = new Date(this.date);
    this.dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  next();
});

// Static method to get start of day
PriceLogSchema.statics.getStartOfDay = function(date = new Date()) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

module.exports = mongoose.model('PriceLog', PriceLogSchema);