const mongoose = require('mongoose');
const { Schema } = mongoose;

const faqSchema = new Schema({
  question: {
    type: String,
    required: true,
    trim: true,
    unique: true,
    minlength: 10,
    maxlength: 255
  },
  answer: {
    type: Schema.Types.Mixed,
    required: true,
    validate: {
      validator: function(value) {
        // Validate that answer is not empty
        if (value === null || value === undefined) return false;
        if (typeof value === 'string' && value.trim() === '') return false;
        if (Array.isArray(value) && value.length === 0) return false;
        if (typeof value === 'object' && Object.keys(value).length === 0) return false;
        return true;
      },
      message: 'Answer cannot be empty'
    }
  },
  tags: {
    type: [String],
    default: [],
    validate: {
      validator: function(tags) {
        return tags.length <= 10;
      },
      message: 'Cannot have more than 10 tags'
    }
  },
  category: {
    type: String,
    required: true,
    enum: ['General', 'Account', 'Billing', 'Technical', 'Investments', 'Other'],
    default: 'General'
  },
  relatedFAQs: [{
    type: Schema.Types.ObjectId,
    ref: 'FAQ'
  }],
  lastUpdatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (doc, ret) => {
      delete ret.__v;
      delete ret._id;
      return ret;
    }
  }
});

// Indexes for search optimization
faqSchema.index({ question: 'text', tags: 1, category: 1 });
faqSchema.index({ createdAt: -1 });

module.exports = mongoose.model('FAQ', faqSchema);