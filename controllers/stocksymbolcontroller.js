// controllers/stockSymbolController.js
const { TradingViewAPI } = require("tradingview-scraper");
const StockSymbol = require('../models/stockSymbol');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Configure logging
const LOGS_DIR = path.resolve(__dirname, '../logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR);
}

class TradingViewService {
  constructor() {
    this.client = null;
    this.batchSize = 50;
    this.batchDelay = 1500;
  }

  async initialize() {
    if (!this.client) {
      this.client = new TradingViewAPI();
      await this.client.setup();
    }
    return this;
  }

  async fetchBatchPrices(symbols) {
    const results = [];
    
    for (const stock of symbols) {
      const symbolKey = `${stock.exchange}:${stock.symbol}`;
      try {
        const ticker = await this.client.getTicker(symbolKey);
        const data = await ticker.fetch();
        results.push({
          stock,
          price: data.lp ? data.lp.toString() : null,
          error: data.lp ? null : 'No price data'
        });
      } catch (error) {
        results.push({
          stock,
          price: null,
          error: error.message || 'API error'
        });
      }
    }
    return results;
  }

  cleanup() {
    this.client = null;
  }
}

class PriceUpdater {
  constructor() {
    this.tvService = new TradingViewService();
    this.logger = {
      logUpdate: (results, duration) => {
        const date = new Date();
        const logFile = `price-update-${date.toISOString().split('T')[0]}.log`;
        const logPath = path.join(LOGS_DIR, logFile);
        
        const logData = {
          timestamp: date.toISOString(),
          duration: `${duration}ms`,
          total: results.total,
          updated: results.updatedCount,
          failed: results.failed.length,
          failures: results.failed
        };
        
        fs.appendFileSync(logPath, JSON.stringify(logData) + '\n');
      }
    };
  }

  async executeUpdate() {
    const start = Date.now();
    let updateQueue = [];
    
    try {
      await this.tvService.initialize();
      const stocks = await StockSymbol.find({}, '_id symbol exchange currentPrice');
      
      if (!stocks.length) {
        return {
          success: false,
          message: 'No stocks found',
          total: 0,
          updatedCount: 0,
          failed: []
        };
      }

      const batchCount = Math.ceil(stocks.length / this.tvService.batchSize);
      let updatedCount = 0;
      const failedUpdates = [];

      for (let i = 0; i < batchCount; i++) {
        const startIdx = i * this.tvService.batchSize;
        const endIdx = Math.min(startIdx + this.tvService.batchSize, stocks.length);
        const batch = stocks.slice(startIdx, endIdx);

        const batchResults = await this.tvService.fetchBatchPrices(batch);
        
        for (const result of batchResults) {
          const { stock, price, error } = result;
          
          if (price && price !== stock.currentPrice) {
            updateQueue.push({
              updateOne: {
                filter: { _id: stock._id },
                update: {
                  $set: {
                    currentPrice: price,
                    previousPrice: stock.currentPrice,
                    lastUpdated: new Date()
                  }
                }
              }
            });
            updatedCount++;
          } else if (error) {
            failedUpdates.push({
              symbol: stock.symbol,
              exchange: stock.exchange,
              error
            });
          }
        }

        // Process batch updates if queue has items
        if (updateQueue.length > 0) {
          await StockSymbol.bulkWrite(updateQueue);
          updateQueue = []; // Reset queue
        }

        // Add delay between batches except last one
        if (i < batchCount - 1) {
          await new Promise(r => setTimeout(r, this.tvService.batchDelay));
        }
      }

      const result = {
        success: true,
        total: stocks.length,
        updatedCount,
        failed: failedUpdates,
        message: `Updated ${updatedCount}/${stocks.length} symbols`
      };

      this.logger.logUpdate(result, Date.now() - start);
      return result;

    } catch (error) {
      return {
        success: false,
        message: 'Update failed',
        error: error.message,
        total: 0,
        updatedCount: 0,
        failed: []
      };
    } finally {
      this.tvService.cleanup();
    }
  }
}

// Initialize updater and cron jobs
const priceUpdater = new PriceUpdater();

// Schedule updates (8:00 AM and 4:00 PM IST)
cron.schedule('30 2 * * *', () => {  // 8:00 AM IST (2:30 UTC)
  console.log('🚀 Starting morning update (8:00 AM IST)');
  priceUpdater.executeUpdate()
    .then(result => 
      console.log(`✅ Morning update: ${result.message || 'Completed without results'}`))
    .catch(err => 
      console.error('❌ Morning update failed:', err));
}, { timezone: "UTC" });

cron.schedule('0 10 * * *', () => {  // 4:00 PM IST (10:30 UTC)
  console.log('🚀 Starting afternoon update (4:00 PM IST)');
  priceUpdater.executeUpdate()
    .then(result => 
      console.log(`✅ Afternoon update: ${result.message || 'Completed without results'}`))
    .catch(err => 
      console.error('❌ Afternoon update failed:', err));
}, { timezone: "UTC" });

const stockSymbolController = {
  createStockSymbol: async (req, res) => {
    try {
      const { symbol, name, currentPrice, exchange } = req.body;
      const required = ['symbol', 'name', 'currentPrice', 'exchange'];
      
      if (required.some(field => !req.body[field])) {
        return res.status(400).json({
          success: false,
          message: `Missing fields: ${required.join(', ')}`
        });
      }

      const existing = await StockSymbol.findOne({
        symbol: symbol.toUpperCase(),
        exchange: exchange.toUpperCase()
      });
      
      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'Symbol already exists'
        });
      }

      const newSymbol = await StockSymbol.create({
        symbol: symbol.toUpperCase(),
        name,
        currentPrice,
        exchange: exchange.toUpperCase(),
        lastUpdated: new Date()
      });

      return res.status(201).json({
        success: true,
        data: newSymbol
      });
    } catch (error) {
      console.error('Create error:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  searchStockSymbols: async (req, res) => {
    try {
      const { keyword } = req.query;
      if (!keyword || keyword.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Minimum 2 characters required'
        });
      }

      const symbols = await StockSymbol.find({
        $or: [
          { symbol: { $regex: keyword, $options: 'i' } },
          { name: { $regex: keyword, $options: 'i' } }
        ]
      }).limit(10);

      return res.status(200).json({
        success: true,
        count: symbols.length,
        data: symbols
      });
    } catch (error) {
      console.error('Search error:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  },

getAllStockSymbols: async (req, res) => {
  try {

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 2500;
    if (page < 1) {
      return res.status(400).json({
        success: false,
        message: 'Page number must be greater than 0'
      });
    }

    if (limit < 1 || limit > 5000) {
      return res.status(400).json({
        success: false,
        message: 'Limit must be between 1 and 5000'
      });
    }

    const totalSymbols = await StockSymbol.countDocuments();
    const totalPages = Math.ceil(totalSymbols / limit);
    
    if (page > totalPages && totalSymbols > 0) {
      return res.status(400).json({
        success: false,
        message: `Page ${page} does not exist. Total pages: ${totalPages}`
      });
    }

    const skip = (page - 1) * limit;

    const symbols = await StockSymbol.find()
      .sort({ symbol: 1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      success: true,
      count: symbols.length,
      totalCount: totalSymbols,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        limit: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        nextPage: page < totalPages ? page + 1 : null,
        prevPage: page > 1 ? page - 1 : null
      },
      data: symbols
    });
  } catch (error) {
    console.error('Fetch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
},
  getStockSymbolById: async (req, res) => {
    try {
      const stock = await StockSymbol.findById(req.params.id);
      if (!stock) {
        return res.status(404).json({
          success: false,
          message: 'Symbol not found'
        });
      }
      return res.status(200).json({
        success: true,
        data: stock
      });
    } catch (error) {
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid ID format'
        });
      }
      console.error('Fetch by ID error:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  },

  getStockSymbolBySymbol: async (req, res) => {
    try {
      const stock = await StockSymbol.findOne({ 
        symbol: req.params.symbol.toUpperCase() 
      });
      
      if (!stock) {
        return res.status(404).json({
          success: false,
          message: 'Symbol not found'
        });
      }
      
      return res.status(200).json({
        success: true,
        data: stock
      });
    } catch (error) {
      console.error('Fetch by symbol error:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  },

  updateStockSymbol: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, currentPrice } = req.body;
      
      if (!name && currentPrice === undefined) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update'
        });
      }

      const stock = await StockSymbol.findById(id);
      if (!stock) {
        return res.status(404).json({
          success: false,
          message: 'Symbol not found'
        });
      }

      const updates = {};
      if (name && name !== stock.name) updates.name = name;
      if (currentPrice !== undefined && currentPrice !== stock.currentPrice) {
        updates.previousPrice = stock.currentPrice;
        updates.currentPrice = currentPrice;
        updates.lastUpdated = new Date();
      }

      if (Object.keys(updates).length === 0) {
        return res.status(200).json({
          success: true,
          message: 'No changes needed',
          data: stock
        });
      }

      const updated = await StockSymbol.findByIdAndUpdate(id, updates, {
        new: true,
        runValidators: true
      });

      return res.status(200).json({
        success: true,
        data: updated
      });
    } catch (error) {
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: Object.values(error.errors).map(e => e.message)
        });
      }
      console.error('Update error:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  },

  deleteStockSymbol: async (req, res) => {
    try {
      const deleted = await StockSymbol.findByIdAndDelete(req.params.id);
      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: 'Symbol not found'
        });
      }
      return res.status(200).json({
        success: true,
        message: 'Symbol deleted'
      });
    } catch (error) {
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid ID format'
        });
      }
      console.error('Delete error:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  },

  updateStockPrices: async (req, res) => {
    try {
      console.log('🚀 Manual stock price update initiated');
      const result = await priceUpdater.executeUpdate();
      
      if (result.success) {
        console.log(`✅ Manual update: ${result.message}`);
        return res.json({
          success: true,
          updated: result.updatedCount,
          failed: result.failed.length,
          total: result.total,
          message: result.message,
          failures: result.failed
        });
      }
      
      console.error(`❌ Manual update failed: ${result.error}`);
      return res.status(500).json({
        success: false,
        message: result.message,
        error: result.error
      });
    } catch (error) {
      console.error('❌ Manual update error:', error);
      res.status(500).json({
        success: false,
        message: 'Update failed',
        error: error.message
      });
    }
  }
};

module.exports = stockSymbolController;