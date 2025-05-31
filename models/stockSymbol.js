const mongoose = require('mongoose');
const { Schema } = mongoose;

const stockSymbolSchema = new Schema({
  symbol: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  currentPrice: {
    type: String,
    required: true
  },
  previousPrice: {
    type: String,
    required: true,
    default: function() {
      return this.currentPrice;
    }
  }
}, { 
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.__v;
      delete ret.id;
      return ret;
    }
  },
  toObject: {
    virtuals: true
  }
});

module.exports = mongoose.model('StockSymbol', stockSymbolSchema);