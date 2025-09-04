const mongoose = require("mongoose");

const digioSignSchema = new mongoose.Schema({
  // User reference
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // Document identifiers
  documentId: { type: String },
  sessionId: { type: String },
  
  // User information
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  
  // KYC information (for compatibility)
  idType: { 
    type: String, 
    enum: ["aadhaar", "pan", "document", "esign", "pdf_uploaded", "pdf_refetched", "document_created"], 
    required: true 
  },
  idNumber: { type: String, required: true },
  kycRequestId: { type: String },
  kycVerified: { type: Boolean, default: false },
  
  // PDF upload fields
  fileBase64: { type: String }, // Base64 encoded PDF data
  fileName: { type: String }, // Generated filename
  fileSize: { type: Number }, // File size in bytes
  sourceUrl: { type: String }, // Source URL if fetched from config
  isTemplate: { type: Boolean, default: false }, // Whether this is a reusable template or signing document
  
  // Status tracking
  status: { 
    type: String, 
    default: "initiated",
    enum: ["initiated", "sent", "viewed", "signed", "completed", "expired", "declined", "failed", "template_uploaded", "template_refetched", "document_created"]
  },
  
  // API responses and webhook data
  digioResponse: {
    type: Object,
    default: {}
  },
  webhookData: Object,
  
  // Tracking fields
  lastWebhookAt: { type: Date },
  signedAt: { type: Date },
  signedDocumentUrl: { type: String },
  
  // Error tracking
  lastError: { type: String },
  errorCount: { type: Number, default: 0 },
  
  // Metadata
  ipAddress: { type: String },
  userAgent: { type: String }
}, { 
  timestamps: true,
  toJSON: { 
    transform: function(doc, ret) {
      delete ret.digioResponse;
      delete ret.webhookData;
      return ret;
    }
  }
});

// Indexes for better query performance
digioSignSchema.index({ documentId: 1 });
digioSignSchema.index({ userId: 1 });
digioSignSchema.index({ email: 1 });
digioSignSchema.index({ status: 1 });
digioSignSchema.index({ isTemplate: 1 });
digioSignSchema.index({ userId: 1, isTemplate: 1 });
digioSignSchema.index({ createdAt: -1 });

// Virtual for display purposes
digioSignSchema.virtual('isCompleted').get(function() {
  return ['completed', 'signed'].includes(this.status);
});

module.exports = mongoose.model("DigioSign", digioSignSchema);
