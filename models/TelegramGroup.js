const mongoose = require('mongoose');
const { Schema } = mongoose;

const TelegramGroupSchema = new Schema({
  // Group identification
  chatId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  groupTitle: {
    type: String,
    required: true,
    trim: true
  },
  groupUsername: {
    type: String,
    trim: true,
    sparse: true // Allow null but enforce uniqueness when present
  },
  
  // Product mapping
  productType: {
    type: String,
    required: true,
    enum: ["Portfolio", "Bundle"]
  },
  productId: {
    type: Schema.Types.ObjectId,
    required: true,
    refPath: "productType"
  },
  
  // Group category
  category: {
    type: String,
    required: true,
    enum: ["basic", "premium"],
    default: "basic"
  },
  
  // Group settings
  isActive: {
    type: Boolean,
    default: true
  },
  maxMembers: {
    type: Number,
    default: null // null means unlimited
  },
  
  // Bot permissions
  botUserId: {
    type: String,
    required: true
  },
  isAdminBot: {
    type: Boolean,
    default: false
  },
  
  // Group description/welcome message
  welcomeMessage: {
    type: String,
    default: "Welcome to the group! Please follow the rules and enjoy trading discussions."
  },
  
  // Statistics
  totalMembers: {
    type: Number,
    default: 0
  },
  activeMembers: {
    type: Number,
    default: 0
  },
  
  // Group creation info
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true }
});

// Ensure unique product mapping per group
TelegramGroupSchema.index({ 
  productType: 1, 
  productId: 1 
}, { unique: true, background: true });

// Virtual to get associated product
TelegramGroupSchema.virtual('product', {
  refPath: 'productType',
  localField: 'productId',
  foreignField: '_id',
  justOne: true
});

module.exports = mongoose.model('TelegramGroup', TelegramGroupSchema);