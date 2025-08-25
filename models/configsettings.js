const mongoose = require('mongoose');
const { Schema } = mongoose;

const ConfigSettingsSchema = new Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  value: {
    type: Schema.Types.Mixed,
    required: function() { return !this.isArray; } // Required only for non-array configs
  },
  category: {
    type: String,
    required: true,
    enum: ['smtp', 'payment', 'general', 'security', 'digio', 'other'],
    index: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  isSecret: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // NEW: Array configuration support
  isArray: {
    type: Boolean,
    default: false
  },
  arrayItems: [{
    type: Schema.Types.Mixed
  }]
}, { timestamps: true });

module.exports = mongoose.model('ConfigSettings', ConfigSettingsSchema);