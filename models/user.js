// models/user.js
const mongoose = require('mongoose');

const panCardRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

// List of Indian states
const indianStates = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
];

const userSchema = new mongoose.Schema({
  // Username can be different from email
  username: { 
    type: String, 
    required: true, 
    unique: true
  },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  provider: { type: String, enum: ['local','google'], default: 'local' },
  providerId: String,
  mainUserId: { type: String, default: null },
  fullName: { type: String, default: null },
  phone: { type: String, required: true },
  state: { 
    type: String, 
    enum: [...indianStates, null],
    default: null,
    validate: {
      validator: function(v) {
        return v === null || indianStates.includes(v);
      },
      message: props => `${props.value} is not a valid Indian state`
    }
  },
  dateOfBirth: { type: Date, default: null },
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
  
  // PAN verification metadata
  panVerified: { type: Boolean, default: false },
  panVerificationStatus: { type: String, enum: ['unverified', 'verified', 'failed'], default: 'unverified' },
  panVerifiedName: { type: String, default: null },
  panVerifiedDob: { type: String, default: null }, // DD/MM/YYYY
  panLastVerifiedAt: { type: Date, default: null },
  panVerificationData: { type: Object, default: null },
  
  // NEW for token invalidation
  changedPasswordAt: { type: Date, default: Date.now },
  tokenVersion:      { type: Number, default: 0 },

  // Store the latest refresh token (or its jti)
  refreshToken:      { type: String, default: null },

  emailVerified:     { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
