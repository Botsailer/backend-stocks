const mongoose = require('mongoose');
const { Schema } = mongoose;

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
  },
  compareIndexValue: {
    type: Number,
    required: false
  },
  compareIndexPriceSource: {
    type: String,
    enum: ['closing', 'current', null],
    required: false
  },
  // Track if this log used closing prices
  usedClosingPrices: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

// Indexes
PriceLogSchema.index({ portfolio: 1, date: 1 });
PriceLogSchema.index({ date: 1 });
PriceLogSchema.index({ portfolio: 1, dateOnly: 1 }, { unique: true });

// Pre-save middleware
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