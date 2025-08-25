// const mongoose = require("mongoose");

// const digioSignSchema = new mongoose.Schema({
//   // Document identifiers
//   documentId: { type: String },             // Set after initiating eSign
  
//   // User information
//   name:       { type: String, required: true },
//   email:      { type: String, required: true },
//   phone:      { type: String, required: true },
  
//   // KYC information
//   idType:     { type: String, enum: ["aadhaar","pan"], required: true },
//   idNumber:   { type: String, required: true },
//   kycRequestId: { type: String },           // Holds OTP session/request ID for Aadhaar
//   kycVerified:  { type: Boolean, default: false },
  
//   // Status tracking
//   status:       { 
//     type: String, 
//     default: "pending",
//     enum: ["pending", "kyc_initiated", "kyc_verified", "kyc_failed", "esign_initiated", "esign_sent", "esign_viewed", "esign_signed", "completed", "expired", "declined", "failed"]
//   },
  
//   // API responses and webhook data
//   digioResponse: {
//     type: Object,
//     default: {}
//   },
//   webhookData: Object,
  
//   // Additional tracking fields (optional but helpful)
//   lastWebhookAt: { type: Date },
//   kycCompletedAt: { type: Date },
//   esignCompletedAt: { type: Date },
//   signedDocumentUrl: { type: String },      // URL of the signed document
  
//   // Error tracking
//   lastError: { type: String },
//   errorCount: { type: Number, default: 0 },
  
//   // Metadata
//   ipAddress: { type: String },
//   userAgent: { type: String }
// }, { 
//   timestamps: true,
//   toJSON: { 
//     transform: function(doc, ret) {
//       // Remove sensitive data from JSON output
//       delete ret.digioResponse;
//       delete ret.webhookData;
//       return ret;
//     }
//   }
// });

// // Indexes for better query performance
// digioSignSchema.index({ documentId: 1 });
// digioSignSchema.index({ email: 1 });
// digioSignSchema.index({ phone: 1 });
// digioSignSchema.index({ idNumber: 1 });
// digioSignSchema.index({ status: 1 });
// digioSignSchema.index({ createdAt: -1 });

// // Virtual for display purposes
// digioSignSchema.virtual('isCompleted').get(function() {
//   return ['completed', 'esign_signed'].includes(this.status);
// });

// module.exports = mongoose.model("DigioSign", digioSignSchema);