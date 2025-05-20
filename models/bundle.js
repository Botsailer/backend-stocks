const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * @swagger
 * components:
 *   schemas:
 *     BundleSubscription:
 *       type: object
 *       required:
 *         - amount
 *         - currency
 *       properties:
 *         amount:
 *           type: number
 *           description: Total subscription amount after discount
 *         currency:
 *           type: string
 *           default: "INR"
 *         interval:
 *           type: string
 *           enum: [one-time, monthly, yearly]
 *           default: "monthly"
 * 
 *     Bundle:
 *       type: object
 *       required:
 *         - name
 *         - portfolios
 *         - discountPercentage
 *       properties:
 *         name:
 *           type: string
 *           example: "Starter Pack"
 *         description:
 *           type: string
 *           example: "Best portfolios for new investors"
 *         portfolios:
 *           type: array
 *           items:
 *             type: string
 *             format: objectid
 *           description: Array of Portfolio IDs
 *         discountPercentage:
 *           type: number
 *           minimum: 0
 *           maximum: 100
 *           example: 15
 *         subscription:
 *           $ref: '#/components/schemas/BundleSubscription'
 *         createdAt:
 *           type: string
 *           format: date-time
 *           readOnly: true
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           readOnly: true
 */

const BundleSchema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  description: String,
  portfolios: [{
    type: Schema.Types.ObjectId,
    ref: 'Portfolio',
    required: true,
    validate: {
      validator: async function(portfolios) {
        const count = await mongoose.model('Portfolio').countDocuments({ _id: { $in: portfolios } });
        return count === portfolios.length;
      },
      message: 'One or more portfolios are invalid'
    }
  }],
  discountPercentage: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  subscription: {
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      default: 'INR'
    },
    interval: {
      type: String,
      enum: ['one-time', 'monthly', 'yearly'],
      default: 'monthly'
    }
  }
}, { timestamps: true });

// Calculate subscription amount before saving
BundleSchema.pre('save', async function(next) {
  if (this.isModified('portfolios') || this.isModified('discountPercentage')) {
    const portfolios = await mongoose.model('Portfolio').find({
      _id: { $in: this.portfolios }
    });
    
    const total = portfolios.reduce((sum, portfolio) => 
      sum + (portfolio.subscriptionFee || 0), 0);
    
    this.subscription.amount = total * (1 - this.discountPercentage / 100);
  }
  next();
});

module.exports = mongoose.model('Bundle', BundleSchema);
