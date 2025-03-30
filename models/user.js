// models/User.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const UserSchema = new Schema({
  username: { type: String, unique: true, sparse: true }, // For local and OAuth (email)
  password: { type: String }, // Only for local auth
  email : { type: String, unique: true, sparse: true }, // For local and OAuth (email)
  provider: { type: String, required: true, default: 'local' }, // 'local', 'google', 'apple'
  providerId: { type: String }, // ID from OAuth providers
  mainUserId: { type: String }, // Reference to your main DB user
  refreshToken: { type: String } // For token refresh management
});

module.exports = mongoose.model('User', UserSchema);
