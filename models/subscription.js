
/**
 * models/Subscription.js
 * ---
 * Tracks the subscription status for a user and a specific portfolio.
 */
const mongoose = require('mongoose');
const { Schema } = mongoose;

const SubscriptionSchema = new Schema({
    user: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        description: 'ObjectId of the subscribing User',
    },
    portfolio: {
        type: Schema.Types.ObjectId,
        ref: 'Portfolio',
        required: true,
        description: 'ObjectId of the subscribed Portfolio',
    },
    lastPaidAt: {
        type: Date,
        default: null,
        description: 'Timestamp of last successful payment',
    },
    missedCycles: {
        type: Number,
        default: 0,
        description: 'Number of missed monthly payment cycles (max 3)',
    },
    isActive: {
        type: Boolean,
        default: false,
        description: 'Indicates whether the subscription is currently active',
    }
}, { timestamps: true });

/**
 * Updates subscription after successful payment.
 * @param {Date} paymentDate - The date of the successful payment.
 * @returns {Promise<Subscription>}
 */
SubscriptionSchema.methods.recordPayment = function (paymentDate = new Date()) {
    if (this.lastPaidAt) {
        const nextDue = new Date(this.lastPaidAt);
        nextDue.setMonth(nextDue.getMonth() + 1);
        if (paymentDate <= nextDue) {
            this.missedCycles = 0;
        } else {
            this.missedCycles = Math.min(this.missedCycles + 1, 3);
        }
    }
    this.lastPaidAt = paymentDate;
    this.isActive = true;
    return this.save();
};

module.exports = mongoose.model('Subscription', SubscriptionSchema);

