const { Schema, model } = require('mongoose');

const stockSymbolSchema = new Schema({
    symbol: {
        type: String,
        required: true,
        unique: true,
    },
    name: {
        type: String,
        required: true,
    },
    currentPrice: {
        type: String,
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
    }, { timestamps: true });


exports.StockSymbol = model('StockSymbol', stockSymbolSchema);