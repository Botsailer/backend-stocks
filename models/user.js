// models/user.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  provider: { type: String, enum: ['local','google'], default: 'local' },
  providerId: String,
  mainUserId: { type: String, default: null },
  fullName: { type: String, default: null },
  dateofBirth: { type: Date, default: null },
  phone: { type: String, default: null },
  pnadetails: { type: String, default: null },
  // NEW for token invalidation
  changedPasswordAt: { type: Date, default: Date.now },
  tokenVersion:      { type: Number, default: 0 },

  // Store the latest refresh token (or its jti)
  refreshToken:      { type: String, default: null },

  emailVerified:     { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
