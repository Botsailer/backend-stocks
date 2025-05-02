//file: models/configsettings.js

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
    type: Schema.Types.Mixed, // Using Mixed type to store different value types
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: ['smtp', 'payment', 'general', 'security'],
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
  }
}, { timestamps: true });

module.exports = mongoose.model('ConfigSettings', ConfigSettingsSchema);