// Schema for admin tips linked to a portfolio
const mongoose = require('mongoose');
const { Schema } = mongoose;

const TipSchema = new Schema({
    portfolio: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Portfolio',
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    content: {
      type: String,  // rich text content (HTML/Markdown)
      default: ''
    },
    status: {
      type: String,
      enum: ['Active', 'Closed'],
      default: 'Active'
    }
  }, { timestamps: true });
  
  module.exports = mongoose.model('Tip', TipSchema);
  