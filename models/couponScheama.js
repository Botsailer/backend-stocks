const mongoose = require('mongoose');
const { Schema } = mongoose;

const CouponSchema = new Schema({
  // Core coupon fields
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    minlength: 3,
    maxlength: 20,
    match: /^[A-Z0-9]+$/,
    index: true
  },
  
  // Discount configuration
  discountType: {
    type: String,
    required: true,
    enum: ['percentage', 'fixed'],
    index: true
  },
  
  discountValue: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: function(value) {
        if (this.discountType === 'percentage') {
          return value <= 100; // Max 100% discount
        }
        return value >= 0; // Fixed amount can be any positive number
      },
      message: 'Percentage discount cannot exceed 100%'
    }
  },
  
  // Usage limits
  usageLimit: {
    type: Number,
    default: -1, // -1 means unlimited
    validate: {
      validator: function(value) {
        return value === -1 || value > 0;
      },
      message: 'Usage limit must be -1 (unlimited) or positive number'
    }
  },
  
  usedCount: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Validity period
  validFrom: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  validUntil: {
    type: Date,
    required: true,
    index: true,
    validate: {
      validator: function(value) {
        return value > this.validFrom;
      },
      message: 'Valid until date must be after valid from date'
    }
  },
  
  // Applicable products
  applicableProducts: {
    portfolios: [{
      type: Schema.Types.ObjectId,
      ref: 'Portfolio'
    }],
    bundles: [{
      type: Schema.Types.ObjectId,
      ref: 'Bundle'
    }],
    // If both arrays are empty, coupon applies to all products
    applyToAll: {
      type: Boolean,
      default: false
    }
  },
  
  // Minimum order requirements
  minOrderValue: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Maximum discount cap (for percentage discounts)
  maxDiscountAmount: {
    type: Number,
    default: null,
    min: 0
  },
  
  // User restrictions
  userRestrictions: {
    // Specific users who can use this coupon (empty means all users)
    allowedUsers: [{
      type: Schema.Types.ObjectId,
      ref: 'User'
    }],
    
    // Users who cannot use this coupon
    blockedUsers: [{
      type: Schema.Types.ObjectId,
      ref: 'User'
    }],
    
    // First time users only
    newUsersOnly: {
      type: Boolean,
      default: false
    },
    
    // One use per user
    oneUsePerUser: {
      type: Boolean,
      default: false
    }
  },
  
  // Coupon metadata
  title: {
    type: String,
    required: true,
    maxlength: 100
  },
  
  description: {
    type: String,
    maxlength: 500
  },
  
  status: {
    type: String,
    enum: ['active', 'inactive', 'expired'],
    default: 'active',
    index: true
  },
  
  // Creator information
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Usage tracking
  usageHistory: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    usedAt: {
      type: Date,
      default: Date.now
    },
    orderId: String,
    discountApplied: Number,
    productType: {
      type: String,
      enum: ['Portfolio', 'Bundle', 'Cart']
    },
    productId: Schema.Types.ObjectId
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
CouponSchema.index({ code: 1, status: 1 });
CouponSchema.index({ validFrom: 1, validUntil: 1 });
CouponSchema.index({ status: 1, validUntil: 1 });
CouponSchema.index({ 'usageHistory.user': 1 });

// Virtual for checking if coupon is expired
CouponSchema.virtual('isExpired').get(function() {
  return new Date() > this.validUntil;
});

// Virtual for checking if coupon is valid (active and not expired)
CouponSchema.virtual('isValid').get(function() {
  const now = new Date();
  return this.status === 'active' && 
         now >= this.validFrom && 
         now <= this.validUntil;
});

// Virtual for remaining uses
CouponSchema.virtual('remainingUses').get(function() {
  if (this.usageLimit === -1) return 'Unlimited';
  return Math.max(0, this.usageLimit - this.usedCount);
});

// Method to check if user can use this coupon
CouponSchema.methods.canUserUseCoupon = function(userId) {
  // Check if user is blocked
  if (this.userRestrictions.blockedUsers.includes(userId)) {
    return { canUse: false, reason: 'User is blocked from using this coupon' };
  }
  
  // Check if coupon is restricted to specific users
  if (this.userRestrictions.allowedUsers.length > 0 && 
      !this.userRestrictions.allowedUsers.includes(userId)) {
    return { canUse: false, reason: 'User is not authorized to use this coupon' };
  }
  
  // Check one use per user restriction
  if (this.userRestrictions.oneUsePerUser) {
    const hasUsed = this.usageHistory.some(usage => 
      usage.user.toString() === userId.toString()
    );
    if (hasUsed) {
      return { canUse: false, reason: 'Coupon already used by this user' };
    }
  }
  
  return { canUse: true };
};

// Method to check if coupon applies to a product
CouponSchema.methods.appliesTo = function(productType, productId) {
  // Apply to all products
  if (this.applicableProducts.applyToAll || 
      (this.applicableProducts.portfolios.length === 0 && 
       this.applicableProducts.bundles.length === 0)) {
    return true;
  }
  
  if (productType === 'Portfolio') {
    return this.applicableProducts.portfolios.includes(productId);
  } else if (productType === 'Bundle') {
    return this.applicableProducts.bundles.includes(productId);
  }
  
  return false;
};

// Method to calculate discount
CouponSchema.methods.calculateDiscount = function(orderValue) {
  if (orderValue < this.minOrderValue) {
    return { discount: 0, reason: `Minimum order value ₹${this.minOrderValue} required` };
  }
  
  let discount = 0;
  
  if (this.discountType === 'percentage') {
    discount = (orderValue * this.discountValue) / 100;
    
    // Apply maximum discount cap if set
    if (this.maxDiscountAmount && discount > this.maxDiscountAmount) {
      discount = this.maxDiscountAmount;
    }
  } else if (this.discountType === 'fixed') {
    discount = Math.min(this.discountValue, orderValue); // Don't discount more than order value
  }
  
  return { 
    discount: Math.round(discount * 100) / 100, // Round to 2 decimal places
    finalAmount: Math.max(0, orderValue - discount)
  };
};

// Method to use coupon
CouponSchema.methods.useCoupon = function(userId, orderId, productType, productId, discountApplied) {
  this.usedCount += 1;
  this.usageHistory.push({
    user: userId,
    orderId,
    discountApplied,
    productType,
    productId,
    usedAt: new Date()
  });
  
  return this.save();
};

// Pre-save middleware to update status based on dates
CouponSchema.pre('save', function(next) {
  const now = new Date();
  
  if (now > this.validUntil) {
    this.status = 'expired';
  } else if (this.status === 'expired' && now <= this.validUntil) {
    this.status = 'active';
  }
  
  next();
});

// Static method to find valid coupons
CouponSchema.statics.findValidCoupons = function(code = null) {
  const now = new Date();
  const query = {
    status: 'active',
    validFrom: { $lte: now },
    validUntil: { $gte: now }
  };
  
  if (code) {
    query.code = code.toUpperCase();
  }
  
  return this.find(query);
};

module.exports = mongoose.model('Coupon', CouponSchema);