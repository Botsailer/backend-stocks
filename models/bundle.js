const mongoose = require('mongoose');
const { Schema } = mongoose;

const BundleSchema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    default: ""
  },
  externalId: {
    type: String,
    required: false,
    trim: true,
    index: true // Add index for faster queries
  },
  portfolios: [{
    type: Schema.Types.ObjectId,
    ref: 'Portfolio',
    required: false,
  }],
  category: {
    type: String,
    required: true,
    enum: ['basic', 'premium'],
    default: 'basic'
  },
  monthlyPrice: {
    type: Number,
    min: 0,
    default: null
  },
  monthlyemandateprice: {
    type: Number,
    min: 0,
    default: null
  },


  quarterlyemandateprice: {
    type: Number,
    min: 0,
    default: null
  },

  yearlyemandateprice: {
    type: Number,
    min: 0,
    default: null
  },
  yearlyPrice: {
    type: Number,
    min: 0,
    default: null
  },
  telegramProductId: {
    type: String,
    required: false,
    trim: true,
    index: true
  },
}, { 
  timestamps: true,
  toJSON: { virtuals: false },
  toObject: { virtuals: false }
});


BundleSchema.pre('validate', function(next) {
  if (this.monthlyPrice === null && 
      this.monthlyemandateprice === null && 
      this.quarterlyemandateprice === null &&
      this.yearlyemandateprice === null &&
      this.yearlyPrice === null) {
    this.invalidate('pricing', 'At least one pricing option is required', this.pricing);
  }
  next();
});

module.exports = mongoose.model('Bundle', BundleSchema);