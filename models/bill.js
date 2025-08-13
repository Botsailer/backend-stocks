const mongoose = require('mongoose');
const { Schema } = mongoose;

const BillSchema = new Schema({
  // Bill identification
  billNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // User and subscription references
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  subscription: {
    type: Schema.Types.ObjectId,
    ref: "Subscription",
    required: true
  },
  
  // Bill details
  billDate: {
    type: Date,
    default: Date.now,
    required: true
  },
  dueDate: {
    type: Date,
    required: true
  },
  
  // Customer details (snapshot at time of billing)
  customerDetails: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: String,
    address: String,
    panDetails: String
  },
  
  // Product/Service details
  items: [{
    description: { type: String, required: true },
    productType: { type: String, enum: ["Portfolio", "Bundle"], required: true },
    productId: { type: Schema.Types.ObjectId, required: true },
    planType: { type: String, enum: ["monthly", "quarterly", "yearly"], required: true },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, required: true },
    totalPrice: { type: Number, required: true }
  }],
  
  // Financial details
  subtotal: { type: Number, required: true },
  taxRate: { type: Number, default: 18 }, // GST rate in percentage
  taxAmount: { type: Number, required: true },
  totalAmount: { type: Number, required: true },
  
  // Payment details
  paymentId: String,
  orderId: String,
  paymentStatus: {
    type: String,
    enum: ["pending", "paid", "failed", "refunded"],
    default: "pending"
  },
  paymentDate: Date,
  
  // Bill status
  status: {
    type: String,
    enum: ["draft", "sent", "paid", "overdue", "cancelled"],
    default: "draft"
  },
  
  // Email tracking
  emailSent: { type: Boolean, default: false },
  emailSentAt: Date,
  emailDelivered: { type: Boolean, default: false },
  
  // Additional metadata
  notes: String,
  isRenewal: { type: Boolean, default: false },
  previousBillId: { type: Schema.Types.ObjectId, ref: "Bill" }
}, { 
  timestamps: true,
  toJSON: { virtuals: true }
});

// Generate bill number
BillSchema.pre('save', async function(next) {
  if (!this.billNumber) {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const count = await this.constructor.countDocuments({
      createdAt: {
        $gte: new Date(year, new Date().getMonth(), 1),
        $lt: new Date(year, new Date().getMonth() + 1, 1)
      }
    });
    this.billNumber = `INV-${year}${month}-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

// Indexes for performance
BillSchema.index({ user: 1, billDate: -1 });
BillSchema.index({ billNumber: 1 }, { unique: true });
BillSchema.index({ paymentId: 1 }, { sparse: true });

module.exports = mongoose.model("Bill", BillSchema);