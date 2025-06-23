const mongoose = require('mongoose');
const { Schema } = mongoose;

const PaymentHistorySchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  orderId: {
    type: String,
    required: true
  },
  paymentId: {
    type: String,
    default: null
  },
  signature: {
    type: String,
    default: null
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'INR'
  },
  planType: {
    type: String,
    enum: ['monthly', 'quarterly', 'yearly'],
    required: true
  },
  products: [{
    productType: {
      type: String,
      enum: ['Portfolio', 'Bundle']
    },
    productId: {
      type: Schema.Types.ObjectId
    }
  }],
  status: {
    type: String,
    enum: ['CREATED', 'PAID', 'FAILED', 'VERIFIED'],
    default: 'CREATED'
  }
}, { timestamps: true });

module.exports = mongoose.model('PaymentHistory', PaymentHistorySchema);