const mongoose = require('mongoose');
const { Schema } = mongoose;

const TelegramUserSchema = new Schema({
  // User identification
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  telegramUserId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  username: {
    type: String,
    trim: true
  },
  firstName: {
    type: String,
    trim: true
  },
  lastName: {
    type: String,
    trim: true
  },
  
  // Group memberships
  groupMemberships: [{
    telegramGroup: {
      type: Schema.Types.ObjectId,
      ref: "TelegramGroup",
      required: true
    },
    chatId: {
      type: String,
      required: true
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    joinedViaLink: {
      type: Schema.Types.ObjectId,
      ref: "TelegramInviteLink"
    },
    subscription: {
      type: Schema.Types.ObjectId,
      ref: "Subscription",
      required: true
    },
    status: {
      type: String,
      enum: ["active", "kicked", "banned", "left"],
      default: "active"
    },
    // Track subscription expiry for this group
    subscriptionExpiresAt: {
      type: Date,
      required: true
    }
  }],
  
  // User settings
  notifications: {
    joinNotifications: {
      type: Boolean,
      default: true
    },
    kickNotifications: {
      type: Boolean,
      default: true
    },
    subscriptionReminders: {
      type: Boolean,
      default: true
    }
  },
  
  // Activity tracking
  lastActivity: {
    type: Date,
    default: Date.now
  },
  totalGroups: {
    type: Number,
    default: 0
  },
  
  // Bot interaction
  isBlocked: {
    type: Boolean,
    default: false
  },
  language: {
    type: String,
    default: 'en'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true }
});

// Compound indexes for queries
TelegramUserSchema.index({ user: 1, telegramUserId: 1 });
TelegramUserSchema.index({ 'groupMemberships.telegramGroup': 1, 'groupMemberships.status': 1 });

// Virtual for active memberships
TelegramUserSchema.virtual('activeMemberships').get(function() {
  return this.groupMemberships.filter(membership => membership.status === 'active');
});

// Method to add group membership
TelegramUserSchema.methods.addGroupMembership = function(groupData) {
  // Check if already a member
  const existingMembership = this.groupMemberships.find(m => 
    m.telegramGroup.toString() === groupData.telegramGroup.toString()
  );
  
  if (existingMembership) {
    // Update existing membership
    existingMembership.status = 'active';
    existingMembership.joinedAt = new Date();
    existingMembership.joinedViaLink = groupData.joinedViaLink;
    existingMembership.subscription = groupData.subscription;
    existingMembership.subscriptionExpiresAt = groupData.subscriptionExpiresAt;
  } else {
    // Add new membership
    this.groupMemberships.push({
      telegramGroup: groupData.telegramGroup,
      chatId: groupData.chatId,
      joinedViaLink: groupData.joinedViaLink,
      subscription: groupData.subscription,
      subscriptionExpiresAt: groupData.subscriptionExpiresAt,
      status: 'active'
    });
  }
  
  this.totalGroups = this.activeMemberships.length;
  this.lastActivity = new Date();
  
  return this.save();
};

// Method to remove group membership
TelegramUserSchema.methods.removeGroupMembership = function(telegramGroupId, reason = 'kicked') {
  const membership = this.groupMemberships.find(m => 
    m.telegramGroup.toString() === telegramGroupId.toString()
  );
  
  if (membership) {
    membership.status = reason;
    this.totalGroups = this.activeMemberships.length;
    return this.save();
  }
  
  return Promise.resolve(this);
};

module.exports = mongoose.model('TelegramUser', TelegramUserSchema);