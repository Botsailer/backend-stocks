const mongoose = require('mongoose');

const bundleSchema = new mongoose.Schema({
  name:        { type:String, required:true },
  description: String,
  models:      [{ type: mongoose.Schema.Types.ObjectId, ref:'StockModel' }],
  subscription: {
    minInvestment: { type:Number, required:true },
    feeAmount:     { type:Number, required:true },
    feeCurrency:   { type:String, default:'INR' },
    feeInterval:   { type:String, enum:['one-time','monthly','yearly'], default:'one-time' }
  }
}, { timestamps:true });

module.exports = mongoose.model('Bundle', bundleSchema);
