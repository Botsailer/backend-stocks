// models/BannedUser.js
const mongoose = require('mongoose');

const BannedUserSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  bannedAt: { type: Date, default: Date.now },
  reason: { type: String, required: true },
  bannedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true }
});

module.exports = mongoose.model('BannedUser', BannedUserSchema);
