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
    content: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["Active", "Closed"],
      default: "Active",
    },
    buyRange: String,
    targetPrice: String,
    addMoreAt: String,
    tipUrl: String,
    horizon: { type: String, default: "Long Term" },
  },
  {
    downloadLinks: [downloadLinksSchema],
  },
  { _id: true, versionKey: false },
  { timestamps: true }
);

module.exports = mongoose.model("Tip", TipSchema);