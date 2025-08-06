const mongoose = require('mongoose');
const crypto = require('crypto');
const { Schema } = mongoose;

const TelegramInviteLinkSchema = new Schema({
  // Link identification
  linkId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    default: () => crypto.randomBytes(32).toString('hex')
  },
  inviteLink: {
    type: String,
    required: true,
    trim: true
  },
  
  // Associated group and product
  telegramGroup: {
    type: Schema.Types.ObjectId,
    ref: "TelegramGroup",
    required: true,
    index: true
  },
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
  
  // User who requested the link
  requestedBy: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  
  // Associated subscription
  subscription: {
    type: Schema.Types.ObjectId,
    ref: "Subscription",
    required: true,
    index: true
  },
  
  // Link properties
  linkType: {
    type: String,
    required: true,
    enum: ["one_time", "subscription_based"],
    default: "subscription_based"
  },
  
  // Usage tracking
  maxUses: {
    type: Number,
    default: 1 // For one-time use
  },
  currentUses: {
    type: Number,
    default: 0
  },
  usedBy: [{
    user: {
      type: Schema.Types.ObjectId,
      ref: "User"
    },
    telegramUserId: {
      type: String,
      required: true
    },
    usedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Expiry settings
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  subscriptionExpiresAt: {
    type: Date,
    required: true,
    index: true
  },
  
  // Status
  status: {
    type: String,
    required: true,
    enum: ["active", "expired", "exhausted", "cancelled"],
    default: "active",
    index: true
  },
  
  // Additional metadata
  generatedAt: {
    type: Date,
    default: Date.now
  },
  lastUsedAt: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true }
});

// Index for cleanup queries
TelegramInviteLinkSchema.index({ expiresAt: 1, status: 1 });
TelegramInviteLinkSchema.index({ subscriptionExpiresAt: 1, status: 1 });

// Virtual to check if link is valid
TelegramInviteLinkSchema.virtual('isValid').get(function() {
  if (this.status !== 'active') return false;
  if (this.expiresAt && this.expiresAt < new Date()) return false;
  if (this.subscriptionExpiresAt && this.subscriptionExpiresAt < new Date()) return false;
  if (this.maxUses && this.currentUses >= this.maxUses) return false;
  return true;
});

// Method to use the link
TelegramInviteLinkSchema.methods.useLink = function(userId, telegramUserId) {
  if (!this.isValid) {
    throw new Error('Link is not valid');
  }
  
  // Check if user already used this link
  const alreadyUsed = this.usedBy.some(use => 
    use.user.toString() === userId.toString() || 
    use.telegramUserId === telegramUserId
  );
  
  if (alreadyUsed) {
    throw new Error('Link already used by this user');
  }
  
  this.usedBy.push({
    user: userId,
    telegramUserId: telegramUserId,
    usedAt: new Date()
  });
  
  this.currentUses += 1;
  this.lastUsedAt = new Date();
  
  // Update status if exhausted
  if (this.maxUses && this.currentUses >= this.maxUses) {
    this.status = 'exhausted';
  }
  
  return this.save();
};

// Pre-save middleware to update status based on expiry
TelegramInviteLinkSchema.pre('save', function(next) {
  const now = new Date();
  
  if (this.status === 'active') {
    if ((this.expiresAt && this.expiresAt < now) || 
        (this.subscriptionExpiresAt && this.subscriptionExpiresAt < now)) {
      this.status = 'expired';
    } else if (this.maxUses && this.currentUses >= this.maxUses) {
      this.status = 'exhausted';
    }
  }
  
  next();
});

module.exports = mongoose.model('TelegramInviteLink', TelegramInviteLinkSchema);