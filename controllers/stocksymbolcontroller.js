const axios = require('axios');
const { getFmpApiKeys } = require('../utils/configSettings');
const StockSymbol = require('../models/stockSymbol'); // Use PascalCase for model

class ApiKeyManager {
  constructor(keys = []) {
    this.keys = keys.filter(key => key && key.trim() !== '');
    this.index = 0;
  }

  getNextKey() {
    if (this.keys.length === 0) return null;
    const key = this.keys[this.index];
    this.index = (this.index + 1) % this.keys.length;
    return key;
  }
}

/**
 * Controller for Stock Symbol CRUD operations
 */
const stockSymbolController = {
  /**
   * Create a new stock symbol
   */
  createStockSymbol: async (req, res) => {
    try {
      const { symbol, name, currentPrice } = req.body;

      // Validate required fields
      if (!symbol || !name || !currentPrice) {
        return res.status(400).json({
          success: false,
          message: 'Please provide symbol, name, and currentPrice',
        });
      }

      // Check if symbol already exists
      const existingSymbol = await StockSymbol.findOne({ symbol: symbol.toUpperCase() });
      if (existingSymbol) {
        return res.status(409).json({
          success: false,
          message: 'Stock symbol already exists',
        });
      }

      // Create new stock symbol
      const newStockSymbol = await StockSymbol.create({
        symbol: symbol.toUpperCase(),
        name,
        currentPrice,
      });

      return res.status(201).json({
        success: true,
        message: 'Stock symbol created successfully',
        data: newStockSymbol,
      });
    } catch (error) {
      console.error('Error creating stock symbol:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  /**
   * Get all stock symbols
   */
  getAllStockSymbols: async (req, res) => {
    try {
      const stockSymbols = await StockSymbol.find().sort({ createdAt: -1 });
      return res.status(200).json({
        success: true,
        count: stockSymbols.length,
        data: stockSymbols,
      });
    } catch (error) {
      console.error('Error fetching stock symbols:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  /**
   * Get stock symbol by ID
   */
  getStockSymbolById: async (req, res) => {
    try {
      const { id } = req.params;
      const stock = await StockSymbol.findById(id);
      if (!stock) {
        return res.status(404).json({
          success: false,
          message: 'Stock symbol not found',
        });
      }
      return res.status(200).json({
        success: true,
        data: stock,
      });
    } catch (error) {
      console.error('Error fetching stock symbol:', error);
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid stock symbol ID format',
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  /**
   * Get stock symbol by ticker symbol
   */
  getStockSymbolBySymbol: async (req, res) => {
    try {
      const { symbol } = req.params;
      const stock = await StockSymbol.findOne({ symbol: symbol.toUpperCase() });
      if (!stock) {
        return res.status(404).json({
          success: false,
          message: 'Stock symbol not found',
        });
      }
      return res.status(200).json({
        success: true,
        data: stock,
      });
    } catch (error) {
      console.error('Error fetching stock symbol:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  /**
   * Update a stock symbol
   */
  updateStockSymbol: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, currentPrice } = req.body;
      const stock = await StockSymbol.findById(id);
      if (!stock) {
        return res.status(404).json({
          success: false,
          message: 'Stock symbol not found',
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
        message: 'Stock symbol updated successfully',
        data: stock,
      });
    } catch (error) {
      console.error('Error updating stock symbol:', error);
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid stock symbol ID format',
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  /**
   * Delete a stock symbol
   */
  deleteStockSymbol: async (req, res) => {
    try {
      const { id } = req.params;
      const stock = await StockSymbol.findByIdAndDelete(id);
      if (!stock) {
        return res.status(404).json({
          success: false,
          message: 'Stock symbol not found',
        });
      }
      return res.status(200).json({
        success: true,
        message: 'Stock symbol deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting stock symbol:', error);
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid stock symbol ID format',
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },

  /**
   * Update stock prices from FMP API
   */
  updateStockPrices: async (req, res) => {
    try {
      // 1. Get FMP API keys
      const apiKeys = await getFmpApiKeys();
      if (!apiKeys || apiKeys.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No active FMP API keys found'
        });
      }

      const keyManager = new ApiKeyManager(apiKeys);

      // 2. Get all stock symbols
      const stocks = await StockSymbol.find({}, 'symbol currentPrice');
      const symbols = stocks.map(stock => stock.symbol);

      if (symbols.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No stocks found in database'
        });
      }

      // 3. Prepare batch requests
      const BATCH_SIZE = 10;
      const batches = [];
      for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
        batches.push(symbols.slice(i, i + BATCH_SIZE));
      }

      // 4. Fetch prices using round-robin API keys
      const updateOperations = [];
      const failedSymbols = [];

      for (const batch of batches) {
        const apiKey = keyManager.getNextKey();
        if (!apiKey) break;

        try {
          const response = await axios.get(
            `https://financialmodelingprep.com/api/v3/quote/${batch.join(',')}`,
            {
              params: { apikey: apiKey },
              timeout: 15000
            }
          );

          if (response.data && Array.isArray(response.data)) {
            for (const stockData of response.data) {
              const symbol = stockData.symbol;
              const newPrice = stockData.price.toString();
              const stock = stocks.find(s => s.symbol === symbol);

              if (stock) {
                updateOperations.push({
                  updateOne: {
                    filter: { symbol },
                    update: {
                      $set: {
                        currentPrice: newPrice,
                        previousPrice: stock.currentPrice
                      }
                    }
                  }
                });
              }
            }
          }
        } catch (error) {
          console.error(`Failed to fetch batch ${batch.join(',')}:`, error.message);
          failedSymbols.push(...batch);
        }
      }

      // 5. Bulk update database
      if (updateOperations.length > 0) {
        await StockSymbol.bulkWrite(updateOperations);
      }

      res.json({
        success: true,
        updated: updateOperations.length,
        failed: failedSymbols.length,
        failedSymbols,
        message: `Updated ${updateOperations.length} stocks, ${failedSymbols.length} failed`
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
