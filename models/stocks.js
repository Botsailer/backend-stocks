const mongoose = require('mongoose');

const tipSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  tip:  { type: String, required: true }
}, { _id:false });

const segmentSchema = new mongoose.Schema({
  title:     String,
  type:      String,
  sector:    String,
  weightage: Number,               // e.g. 10.7
  status:    String                // free-text: 'hold','sell','addonbuy', etc.
}, { _id:false });

const recSchema = new mongoose.Schema({
  category:        String,         // dynamic
  buyPercent:      { low:Number, high:Number },
  addMorePercent:  { low:Number, high:Number },
  targetPercent:   { low:Number, high:Number },
  recommendedDate: Date,
  horizon:         String,
  ltp:             Number,
  whyBuy:          String,         // HTML from TinyMCE
  pdfUrl:          String
}, { _id:false });

const subscriptionSchema = new mongoose.Schema({
  minInvestment: { type:Number, required:true },
  feeAmount:     { type:Number, required:true },
  feeCurrency:   { type:String, default:'INR' },
  feeInterval:   { type:String, enum:['one-time','monthly','yearly'], default:'one-time' },
  // computed:
  cashPercent: { type:Number, default:0 },  
  cashAmount:  { type:Number, default:0 }
}, { _id:false });

const stockModelSchema = new mongoose.Schema({
  title:           String,
  description:     String,
  symbol:          String,
  segments:        [segmentSchema],
  recommendations: [recSchema],
  dailyTips:       [tipSchema],
  subscription:    subscriptionSchema,
  trailingReturns: {
    type: Map,
    of: Number
  }
}, { timestamps:true });

module.exports = mongoose.model('StockModel', stockModelSchema);
