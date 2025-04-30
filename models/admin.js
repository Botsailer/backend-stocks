// models/admin.js
const mongoose = require('mongoose');

const AdminSchema = new mongoose.Schema({
  // Reference to the User document
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,           // each user can be an admin only once
  },

  // When this user was promoted to admin
  promotedAt: {
    type: Date,
    default: Date.now,
  },

  // Optional: granular permissions or admin roles
  // (e.g. ['user:read', 'user:write', 'settings:modify'])
  permissions: {
    type: [String],
    default: [],
  }
}, {
  timestamps: true,         // adds createdAt / updatedAt
});

module.exports = mongoose.model('Admin', AdminSchema);
