const mongoose = require('mongoose');
const { Schema } = mongoose;

const cartItemSchema = new mongoose.Schema({
  productType: {
    type: String,
    enum: ['Portfolio', 'Bundle'],
    required: true
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'items.productType'
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  planType: {
    type: String,
    enum: ['monthly', 'quarterly', 'yearly'],
    required: true,
    default: 'monthly'
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
});

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  items: [cartItemSchema],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

cartSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Cart', cartSchema);