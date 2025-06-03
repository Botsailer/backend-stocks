// controllers/stocksymbolcontroller.js
const { TradingViewAPI } = require("tradingv-scraper");
const StockSymbol = require('../models/stockSymbol');

class BatchManager {
  constructor(allSymbols, batchSize = 100) {
    this.allSymbols = allSymbols;
    this.batchSize = batchSize;
    this.currentBatch = 0;
    this.totalBatches = Math.ceil(allSymbols.length / batchSize);
    this.results = { success: [], failed: [] };
  }

  getNextBatch() {
    if (this.currentBatch >= this.totalBatches) return null;
    
    const start = this.currentBatch * this.batchSize;
    const end = start + this.batchSize;
    const batch = this.allSymbols.slice(start, end);
    
    this.currentBatch++;
    return batch;
  }

  getProgress() {
    return {
      current: this.currentBatch,
      total: this.totalBatches,
      processed: this.currentBatch * this.batchSize,
      totalSymbols: this.allSymbols.length
    };
  }

  recordResult(successful = [], failed = []) {
    this.results.success.push(...successful);
    this.results.failed.push(...failed);
  }
}

const stockSymbolController = {
  createStockSymbol: async (req, res) => {
    try {
      const { symbol, name, currentPrice, exchange } = req.body;

      if (!symbol || !name || !currentPrice || !exchange) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: symbol, name, currentPrice, exchange'
        });
      }

      const existingSymbol = await StockSymbol.findOne({ 
        symbol: symbol.toUpperCase(),
        exchange: exchange.toUpperCase()
      });
      
      if (existingSymbol) {
        return res.status(409).json({
          success: false,
          message: 'Stock symbol already exists for this exchange'
        });
      }

      const newStockSymbol = await StockSymbol.create({
        symbol: symbol.toUpperCase(),
        name,
        currentPrice,
        exchange: exchange.toUpperCase(),
        lastUpdated: new Date()
      });

      return res.status(201).json({
        success: true,
        data: newStockSymbol
      });
    } catch (error) {
      console.error('Error creating stock symbol:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
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
        message: 'Keyword must be at least 2 characters long'
      });
    }

    const symbols = await StockSymbol.find({
      $or: [
        { symbol: { $regex: keyword, $options: 'i' } },
        { name: { $regex: keyword, $options: 'i' } }
      ]
    })
    .limit(10);

    return res.status(200).json({
      success: true,
      count: symbols.length,
      data: symbols
    });
    
  } catch (error) {
    console.error('Error searching stock symbols:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
},


  getAllStockSymbols: async (req, res) => {
    try {
      const stockSymbols = await StockSymbol.find().sort({ createdAt: -1 });
      return res.status(200).json({
        success: true,
        count: stockSymbols.length,
        data: stockSymbols
      });
    } catch (error) {
      console.error('Error fetching stock symbols:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  getStockSymbolById: async (req, res) => {
    try {
      const { id } = req.params;
      const stock = await StockSymbol.findById(id);
      if (!stock) {
        return res.status(404).json({
          success: false,
          message: 'Stock symbol not found'
        });
      }
      return res.status(200).json({
        success: true,
        data: stock
      });
    } catch (error) {
      console.error('Error fetching stock symbol:', error);
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid stock symbol ID format'
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  getStockSymbolBySymbol: async (req, res) => {
    try {
      const { symbol } = req.params;
      const stock = await StockSymbol.findOne({ symbol: symbol.toUpperCase() });
      if (!stock) {
        return res.status(404).json({
          success: false,
          message: 'Stock symbol not found'
        });
      }
      return res.status(200).json({
        success: true,
        data: stock
      });
    } catch (error) {
      console.error('Error fetching stock symbol:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  updateStockSymbol: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, currentPrice } = req.body;
      const stock = await StockSymbol.findById(id);
      if (!stock) {
        return res.status(404).json({
          success: false,
          message: 'Stock symbol not found'
        });
      }
      if (name) stock.name = name;
      if (currentPrice) {
        stock.previousPrice = stock.currentPrice;
        stock.currentPrice = currentPrice;
      }
      await stock.save();
      return res.status(200).json({
        success: true,
        data: stock
      });
    } catch (error) {
      console.error('Error updating stock symbol:', error);
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid stock symbol ID format'
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  deleteStockSymbol: async (req, res) => {
    try {
      const { id } = req.params;
      const stock = await StockSymbol.findByIdAndDelete(id);
      if (!stock) {
        return res.status(404).json({
          success: false,
          message: 'Stock symbol not found'
        });
      }
      return res.status(200).json({
        success: true,
        message: 'Stock symbol deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting stock symbol:', error);
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid stock symbol ID format'
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  },

  updateStockPrices: async (req, res) => {
    try {
      const stocks = await StockSymbol.find({}, 'symbol exchange currentPrice');
      if (stocks.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No stocks found in database'
        });
      }

      const tv = new TradingViewAPI();
      await tv.setup();

      const batchManager = new BatchManager(stocks, 100);
      const updateOperations = [];
      const delayBetweenBatches = 3000; // 3 seconds

      while (true) {
        const batch = batchManager.getNextBatch();
        if (!batch) break;

        try {
          const batchSymbols = batch.map(stock => `${stock.exchange}:${stock.symbol}`);
          const batchResults = [];

          for (const symbol of batchSymbols) {
            try {
              const ticker = await tv.getTicker(symbol);
              const data = await ticker.fetch();
              
              if (data.lp) {
                batchResults.push({
                  symbol,
                  price: data.lp.toString(),
                  error: null
                });
              } else {
                batchResults.push({
                  symbol,
                  price: null,
                  error: 'Price not available'
                });
              }
            } catch (error) {
              batchResults.push({
                symbol,
                price: null,
                error: error.message || 'Fetch error'
              });
            }
          }

          // Process results
          const successfulUpdates = [];
          const failedUpdates = [];

          for (let i = 0; i < batch.length; i++) {
            const stock = batch[i];
            const result = batchResults[i];
            const [exchange, symbol] = result.symbol.split(':');

            if (result.price) {
              updateOperations.push({
                updateOne: {
                  filter: { symbol, exchange },
                  update: {
                    $set: {
                      currentPrice: result.price,
                      previousPrice: stock.currentPrice,
                      lastUpdated: new Date()
                    }
                  }
                }
              });
              successfulUpdates.push(`${exchange}:${symbol}`);
            } else {
              failedUpdates.push({
                symbol: `${exchange}:${symbol}`,
                error: result.error
              });
            }
          }

          batchManager.recordResult(successfulUpdates, failedUpdates.map(f => f.symbol));
        } catch (batchError) {
          console.error(`Batch ${batchManager.currentBatch} failed:`, batchError);
          batchManager.recordResult([], batch.map(s => `${s.exchange}:${s.symbol}`));
        }

        // Add delay between batches to avoid rate limiting
        if (batchManager.currentBatch < batchManager.totalBatches) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
        }
      }

      // Bulk update database
      if (updateOperations.length > 0) {
        await StockSymbol.bulkWrite(updateOperations);
      }

      const results = batchManager.results;
      res.json({
        success: true,
        updated: results.success.length,
        failed: results.failed.length,
        successSymbols: results.success,
        failedSymbols: results.failed,
        progress: batchManager.getProgress(),
        message: `Updated ${results.success.length} stocks, ${results.failed.length} failed`
      });

    } catch (error) {
      console.error('Error updating stock prices:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
};

module.exports = stockSymbolController;