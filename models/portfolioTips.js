const mongoose = require("mongoose");
const { Schema } = mongoose;

const downloadLinksSchema = new Schema({
  name: { type: String, required: true },
  url: { type: String, required: true },
}, { _id: true }); 

const TipSchema = new Schema(
  {
    portfolio: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Portfolio",
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    mpWeightage:{
      type: Number,
      required: false,
      min: 0,
      max: 100
    },
    stockId :{
      type:String,
      required:true
    },

    analysistConfidence: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

      category: {
      type: String,
      enum: ["basic", "premium"],
      default: "basic"
    },
    content: [
      {
        key: {
          type: String,
          required: true,
          trim: true,
        },
        value: {
          type: String,
          required: true,
          trim: true,
        },
      },
    ],
    description: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["Active", "Closed"],
      default: "Active",
    },
    action:String, 
    buyRange: String,
    targetPrice: String,
    targetPercentage:String,
    addMoreAt: String,
    tipUrl: String,
    exitPrice:String,
    exitStatus:String,
    exitStatusPercentage: String,
  downloadLinks: { 
      type: [downloadLinksSchema],
      default: [] 
    },
    horizon: { type: String, default: "Long Term" },
  },
  { _id: true, versionKey: false,timestamps: true }

);

module.exports = mongoose.model("Tip", TipSchema);