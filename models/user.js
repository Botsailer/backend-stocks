// models/user.js
const mongoose = require('mongoose');

const panCardRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;


const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  provider: { type: String, enum: ['local','google'], default: 'local' },
  providerId: String,
  mainUserId: { type: String, default: null },
  fullName: { type: String, default: null },
  phone: { type: String, default: null },
  pandetails: { 
    type: String, 
    default: null,
    
    validate: {
      validator: function(v) {
        return v === null || v === '' || panCardRegex.test(v);
      },
      message: 'PAN card number must be in format AAAAA9999A (5 letters, 4 digits, 1 letter)'
    }
  },
    panUpdatedByUser: { type: Boolean, default: false },
  panUpdatedAt: { type: Date, default: null },
  
  // NEW for token invalidation
  changedPasswordAt: { type: Date, default: Date.now },
  tokenVersion:      { type: Number, default: 0 },

  // Store the latest refresh token (or its jti)
  refreshToken:      { type: String, default: null },

  emailVerified:     { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
