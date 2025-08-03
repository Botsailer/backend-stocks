const mongoose = require('mongoose');
const { Schema } = mongoose;

const PaymentHistorySchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  subscription: {
    type: Schema.Types.ObjectId,
    ref: 'Subscription',
    required: false,  // 🔧 FIXED: Changed from true to false
    index: true
  },
  portfolio: {
    type: Schema.Types.ObjectId,
    ref: 'Portfolio',
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  paymentId: {
    type: String,
    required: true,
    unique: true,  // Prevent duplicate payments
    index: true
  },
  orderId: {
    type: String,
    index: true
  },
  signature: {
    type: String
  },
  status: {
    type: String,
    enum: ['PENDING', 'VERIFIED', 'FAILED', 'completed', 'refunded'],
    default: 'PENDING',
    index: true
  },
  // Additional fields for better tracking
  paymentMethod: {
    type: String,
    enum: ['card', 'netbanking', 'wallet', 'upi', 'emandate'],
    default: 'card'
  },
  description: {
    type: String,
    default: ''
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true }
});

// Indexes for better query performance
PaymentHistorySchema.index({ user: 1, status: 1 });
PaymentHistorySchema.index({ user: 1, createdAt: -1 });
PaymentHistorySchema.index({ paymentId: 1, status: 1 });

module.exports = mongoose.model('PaymentHistory', PaymentHistorySchema);
