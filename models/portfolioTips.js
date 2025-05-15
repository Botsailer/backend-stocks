// Schema for admin tips linked to a portfolio
const mongoose = require("mongoose");
const { Schema } = mongoose;

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
    buyrange: String,
    targetprice: String,
    addmoreat: String,
    tipurl: String,
    horizon: { type: String, default: "Long Term" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Tip", TipSchema);
