const { TradingViewAPI } = require("tradingview-scraper");
const StockSymbol = require('../models/stockSymbol'); // Use the model from separate file
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const emailService = require('../services/emailServices');
const config = require('../config/config'); // Import config

// Configure logging
const LOGS_DIR = path.resolve(__dirname, '../logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Enhanced TradingViewService with retry logic
class TradingViewService {
  constructor() {
    this.client = null;
    this.batchSize = 50;
    this.batchDelay = 1500;
    this.maxRetries = 3;
    this.retryDelay = 2000;
  }

  async initialize() {
    if (!this.client) {
      this.client = new TradingViewAPI();
      await this.client.setup();
    }
    return this;
  }

  async fetchPriceWithRetry(stock) {
    const symbolKey = `${stock.exchange}:${stock.symbol}`;
    let retries = 0;
    
    while (retries < this.maxRetries) {
      try {
        const ticker = await this.client.getTicker(symbolKey);
        const data = await ticker.fetch();
        if (data.lp) {
          return {
            price: data.lp.toString(),
            error: null
          };
        }
      } catch (error) {
        if (retries === this.maxRetries - 1) {
          return {
            price: null,
            error: error.message || 'API error'
          };
        }
      }
      
      retries++;
      await new Promise(r => setTimeout(r, this.retryDelay));
    }
    
    return {
      price: null,
      error: 'Max retries reached'
    };
  }

  async fetchBatchPrices(symbols) {
    const results = [];
    
    for (const stock of symbols) {
      const { price, error } = await this.fetchPriceWithRetry(stock);
      results.push({
        stock,
        price,
        error
      });
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
        
        // Send email report if failures exist
        if (results.failed.length > 0 && config.mail && config.mail.reportTo) {
          const failureRate = (results.failed.length / results.total * 100).toFixed(2);
          const subject = `Stock Price Update Report - ${failureRate}% Failed`;
          
          let htmlContent = `
            <h1>Stock Price Update Report</h1>
            <p><strong>Time:</strong> ${date.toLocaleString()}</p>
            <p><strong>Duration:</strong> ${duration}ms</p>
            <p><strong>Total Symbols:</strong> ${results.total}</p>
            <p><strong>Updated:</strong> ${results.updatedCount}</p>
            <p><strong>Failed:</strong> ${results.failed.length} (${failureRate}%)</p>
          `;
          
          if (results.failed.length > 0) {
            htmlContent += `<h2>Failure Details:</h2><ul>`;
            results.failed.forEach(failure => {
              htmlContent += `<li>${failure.symbol} (${failure.exchange}): ${failure.error}</li>`;
            });
            htmlContent += `</ul>`;
          }
          
          emailService.sendEmail(
            config.mail.reportTo,
            subject,
            htmlContent
          ).catch(err => {
            console.error('Failed to send email report:', err);
          });
        }
      }
    };
  }

 async executeUpdate(updateType = 'regular') {
    const start = Date.now();
    let updateQueue = [];
    
    try {
      await this.tvService.initialize();
      const stocks = await StockSymbol.find({}, '_id symbol exchange currentPrice');
      
      if (!stocks.length) {
        return {
          success: false,
          message: 'No active stocks found',
          total: 0,
          updatedCount: 0,
          failed: []
        };
      }

      console.log(`Found ${stocks.length} stocks to update`);
      
      const batchCount = Math.ceil(stocks.length / this.tvService.batchSize);
      let updatedCount = 0;
      const failedUpdates = [];

      for (let i = 0; i < batchCount; i++) {
        const startIdx = i * this.tvService.batchSize;
        const endIdx = Math.min(startIdx + this.tvService.batchSize, stocks.length);
        const batch = stocks.slice(startIdx, endIdx);

        console.log(`Processing batch ${i+1}/${batchCount} with ${batch.length} stocks`);
        
        const batchResults = await this.tvService.fetchBatchPrices(batch);
        
       
    for (const result of batchResults) {
      const { stock, price, error } = result;
      
      if (price) {
        const update = {
          $set: {
            lastUpdated: new Date()
          }
        };

        // Always update currentPrice and previousPrice
        if (price !== stock.currentPrice) {
          update.$set.currentPrice = price;
          update.$set.previousPrice = stock.currentPrice;
        }

        // Always set todayClosingPrice for closing updates
        if (updateType === 'closing') {
          update.$set.todayClosingPrice = price;
        }
        
        // For existing stocks without closing price, set it during any update
        if (updateType !== 'closing' && !stock.todayClosingPrice) {
          update.$set.todayClosingPrice = price;
        }
        
        updateQueue.push({
          updateOne: {
            filter: { _id: stock._id },
            update
          }
        });
        updatedCount++;
      } else if (error) {
            console.error(`Failed to fetch price for ${stock.symbol}: ${error}`);
            failedUpdates.push({
              symbol: stock.symbol,
              exchange: stock.exchange,
              error
            });
          }
        }

        if (updateQueue.length > 0) {
          console.log(`Writing ${updateQueue.length} updates to database...`);
          await StockSymbol.bulkWrite(updateQueue);
          updateQueue = [];
        }

        if (i < batchCount - 1) {
          await new Promise(r => setTimeout(r, this.tvService.batchDelay));
        }
      }

      const result = {
        success: true,
        total: stocks.length,
        updatedCount,
        failed: failedUpdates,
        message: `Processed ${stocks.length} symbols`,
        updateType
      };

      this.logger.logUpdate(result, Date.now() - start);
      return result;

    } catch (error) {
      console.error('Price update error:', error);
      return {
        success: false,
        message: 'Update failed',
        error: error?.message,
        total: 0,
        updatedCount: 0,
        failed: [],
        updateType
      };
    } finally {
      this.tvService.cleanup();
    }
  }
}

// Initialize updater and cron jobs
const priceUpdater = new PriceUpdater();

// Schedule regular updates (8:00 AM and 4:00 PM IST)
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

// Schedule closing price update (3:45 PM IST - 10:15 UTC)
cron.schedule('15 10 * * *', () => {  // 3:45 PM IST (10:15 UTC)
  console.log('🚀 Starting closing price update (3:45 PM IST)');
  priceUpdater.executeUpdate('closing')
    .then(result => 
      console.log(`✅ Closing price update: ${result.message || 'Completed without results'}`))
    .catch(err => 
      console.error('❌ Closing price update failed:', err));
}, { timezone: "UTC" })

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
      const updateType = req.query.type || 'regular';
      console.log(`🚀 Manual stock price update initiated (${updateType})`);
      
      const result = await priceUpdater.executeUpdate(updateType);
      
      if (result.success) {
        console.log(`✅ Manual ${updateType} update: ${result.message}`);
        return res.json({
          success: true,
          updated: result.updatedCount,
          failed: result.failed.length,
          total: result.total,
          message: result.message,
          failures: result.failed
        });
      }
      
      console.error(`❌ Manual ${updateType} update failed: ${result.error}`);
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
  },

  // Get benchmark stocks for dropdown selection
  getBenchmarkStocks: async (req, res) => {
    try {
      const benchmarks = await StockSymbol.find({
        isActive: true,
        $or: [
          // Common market indices
          { symbol: { $in: ['NIFTY50', 'BANKNIFTY', 'SENSEX', 'NIFTYMIDCAP150', 'NIFTYSMALLCAP250'] } },
          // Find all stocks that are used as benchmarks in portfolios
          { _id: { $in: await getStocksUsedAsBenchmarks() } }
        ]
      }).select('_id symbol name exchange currentPrice');

      res.status(200).json({
        success: true,
        count: benchmarks.length,
        data: benchmarks
      });
    } catch (error) {
      console.error('Error getting benchmark stocks:', error);
      res.status(500).json({
        success: false,
        error: 'Server Error'
      });
    }
  },

  // Get stock symbol details with price history
  getStockWithHistory: async (req, res) => {
    try {
      const { id } = req.params;
      let query = {};
      
      // Check if id is a MongoDB ObjectId or a symbol string
      if (mongoose.Types.ObjectId.isValid(id)) {
        query._id = id;
      } else {
        query.symbol = id.toUpperCase();
      }
      
      const stock = await StockSymbol.findOne(query);
      
      if (!stock) {
        return res.status(404).json({
          success: false,
          error: 'Stock symbol not found'
        });
      }
      
      // Format response with historical price data if available
      const response = {
        ...stock.toObject(),
        priceHistory: {
          last30Days: await getPriceHistory(stock._id, 30),
          last90Days: await getPriceHistory(stock._id, 90),
        }
      };
      
      res.status(200).json({
        success: true,
        data: response
      });
    } catch (error) {
      console.error('Error getting stock with history:', error);
      res.status(500).json({
        success: false,
        error: 'Server Error'
      });
    }
  },

  // Get all available enum values for stock symbols
  getEnumValues: async (req, res) => {
    try {
      const StockSymbolSchema = StockSymbol.schema;
      
      // Get enum values from the schema
      const exchanges = StockSymbolSchema.path('exchange').enumValues || [];
      const sectors = StockSymbolSchema.path('sector').enumValues || [];
      
      // Additional static values
      const currencies = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD', 'HKD'];
      const stockCapTypes = ['Large Cap', 'Mid Cap', 'Small Cap', 'Micro Cap'];
      
      res.status(200).json({
        success: true,
        data: {
          exchanges,
          sectors,
          stockCapTypes,
          currencies
        }
      });
    } catch (error) {
      console.error('Error getting enum values:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Error fetching enum values'
      });
    }
  }
};

// Helper function to get stock IDs used as benchmarks in portfolios
async function getStocksUsedAsBenchmarks() {
  try {
    const Portfolio = require('../models/modelPortFolio');
    const portfolios = await Portfolio.find({ 
      compareWith: { $exists: true, $ne: "" } 
    }).select('compareWith');
    
    const benchmarkIds = [];
    
    for (const portfolio of portfolios) {
      if (/^[0-9a-fA-F]{24}$/.test(portfolio.compareWith)) {
        benchmarkIds.push(mongoose.Types.ObjectId(portfolio.compareWith));
      }
    }
    
    return benchmarkIds;
  } catch (error) {
    console.error('Error getting stocks used as benchmarks:', error);
    return [];
  }
}

// Helper function to get price history for a stock
async function getPriceHistory(stockId, days) {
  try {
    return [
      { date: new Date(Date.now() - 86400000 * days), price: "0" },
      { date: new Date(), price: "0" }
    ];
  } catch (error) {
    console.error('Error getting price history:', error);
    return [];
  }
}

module.exports = { stockSymbolController, PriceUpdater };