const mongoose = require("mongoose");
const { Schema } = mongoose;

const downloadLinksSchema = new Schema({
  name: {
    type: String,
    required: true,
  },
  url: {
    type: String,
    required: true,
  },

});

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
    stockId :{
      type:String,
      required:true
    },
    //content can be an array of objects with key-value pairs
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
    action:String, //here action will be buy sell hold partial profit
    buyRange: String,
    targetPrice: String,
    targetPercentage:String,
    addMoreAt: String,
    tipUrl: String,
    exitPrice:String,
    exitStatus:String,
    exitStatusPercentage: String,
    horizon: { type: String, default: "Long Term" },
  },
  {
    downloadLinks: [downloadLinksSchema],
  },
  { _id: true, versionKey: false },
  { timestamps: true }
);

module.exports = mongoose.model("Tip", TipSchema);