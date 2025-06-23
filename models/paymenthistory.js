const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * models/PaymentHistory.js
 * ---
 * Tracks each Razorpay payment order and verification lifecycle.
 */
const PaymentHistorySchema = new Schema({
    user: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        description: 'User who initiated the payment',
    },
    portfolio: {
        type: Schema.Types.ObjectId,
        ref: 'Portfolio',
        required: true,
        description: 'Portfolio being subscribed to',
    },
    subscription: {
        type: Schema.Types.ObjectId,
        ref: 'Subscription',
        required: true,
        description: 'Associated subscription document',
    },
    orderId: {
        type: String,
        required: true,
        description: 'Razorpay order ID',
    },
    paymentId: {
        type: String,
        default: null,
        description: 'Razorpay payment ID if successful',
    },
    signature: {
        type: String,
        default: null,
        description: 'Razorpay payment signature used for verification',
    },
    amount: {
        type: Number,
        required: true,
        description: 'Amount paid in paise (INR subunit)',
    },
    status: {
        type: String,
        enum: ['CREATED', 'PAID', 'FAILED', 'VERIFIED'],
        default: 'CREATED',
        description: 'Lifecycle state of the payment',
    }
}, { timestamps: true });

module.exports = mongoose.model('PaymentHistory', PaymentHistorySchema);