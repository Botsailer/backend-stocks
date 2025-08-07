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
  },
  // Flag to track if this is verified data
  dataVerified: {
    type: Boolean,
    default: false
  },
  // Track any issues with this data point
  dataQualityIssues: {
    type: [String],
    default: []
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

// Method to safely create or update a price log with retry mechanism
PriceLogSchema.statics.createOrUpdateDailyLog = async function(portfolioId, logData, retries = 3) {
  const PriceLog = this;
  const startOfDay = PriceLog.getStartOfDay(logData.date || new Date());
  
  // Set dateOnly consistently
  logData.dateOnly = startOfDay;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Ensure we're not creating a duplicate
      const priceLog = await PriceLog.findOneAndUpdate(
        { portfolio: portfolioId, dateOnly: startOfDay },
        {
          $set: {
            ...logData,
            dateOnly: startOfDay // Ensure dateOnly is properly set
          },
          $inc: { updateCount: 1 }
        },
        { 
          upsert: true, 
          new: true, 
          runValidators: true,
          setDefaultsOnInsert: true
        }
      );
      
      return { 
        success: true, 
        priceLog,
        action: attempt === 1 ? 'created' : 'retry-success',
        attempt 
      };
    } catch (error) {
      if (attempt === retries) {
        console.error(`Failed to create/update price log after ${retries} attempts:`, error);
        return { 
          success: false, 
          error: error.message,
          code: error.code,
          action: 'failed',
          attempt
        };
      }
      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500));
    }
  }
};

// Static method to validate there's only one record per portfolio per day
PriceLogSchema.statics.cleanupDuplicates = async function() {
  const PriceLog = this;
  const duplicateCandidates = await PriceLog.aggregate([
    {
      $group: {
        _id: { portfolio: "$portfolio", dateOnly: "$dateOnly" },
        count: { $sum: 1 },
        docs: { $push: { id: "$_id", date: "$date", updateCount: "$updateCount" } }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]);

  const results = {
    checked: duplicateCandidates.length,
    duplicatesRemoved: 0,
    errors: []
  };

  for (const duplicate of duplicateCandidates) {
    try {
      // Sort by updateCount descending, then by date descending
      const sortedDocs = duplicate.docs.sort((a, b) => {
        if (b.updateCount !== a.updateCount) return b.updateCount - a.updateCount;
        return new Date(b.date) - new Date(a.date);
      });
      
      // Keep the first one (highest updateCount or most recent)
      const keepId = sortedDocs[0].id;
      const removeIds = sortedDocs.slice(1).map(doc => doc.id);
      
      if (removeIds.length > 0) {
        const deleteResult = await PriceLog.deleteMany({ _id: { $in: removeIds } });
        results.duplicatesRemoved += deleteResult.deletedCount;
      }
    } catch (error) {
      results.errors.push({
        portfolio: duplicate._id.portfolio,
        dateOnly: duplicate._id.dateOnly,
        error: error.message
      });
    }
  }
  
  return results;
};

module.exports = mongoose.model('PriceLog', PriceLogSchema);