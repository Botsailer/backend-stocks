const { StockSymbol } = require('../models/stockSymbol');

/**
 * Controller for Stock Symbol CRUD operations
 */
const stockSymbolController = {
  /**
   * Create a new stock symbol
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON response with created stock symbol or error
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

      // Create new stock symbol with uppercase symbol
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
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON response with all stock symbols or error
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
   * Get a stock symbol by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON response with stock symbol or error
   */
  getStockSymbolById: async (req, res) => {
    try {
      const { id } = req.params;
      
      const stockSymbol = await StockSymbol.findById(id);
      
      if (!stockSymbol) {
        return res.status(404).json({
          success: false,
          message: 'Stock symbol not found',
        });
      }
      
      return res.status(200).json({
        success: true,
        data: stockSymbol,
      });
    } catch (error) {
      console.error('Error fetching stock symbol:', error);
      
      // Check if error is due to invalid ID format
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
   * Get a stock symbol by ticker symbol
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON response with stock symbol or error
   */
  getStockSymbolBySymbol: async (req, res) => {
    try {
      const { symbol } = req.params;
      
      const stockSymbol = await StockSymbol.findOne({ symbol: symbol.toUpperCase() });
      
      if (!stockSymbol) {
        return res.status(404).json({
          success: false,
          message: 'Stock symbol not found',
        });
      }
      
      return res.status(200).json({
        success: true,
        data: stockSymbol,
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
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON response with updated stock symbol or error
   */
  updateStockSymbol: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, currentPrice } = req.body;
      
      // Find the stock symbol
      const stockSymbol = await StockSymbol.findById(id);
      
      if (!stockSymbol) {
        return res.status(404).json({
          success: false,
          message: 'Stock symbol not found',
        });
      }
      
      // Update fields if provided
      if (name) stockSymbol.name = name;
      if (currentPrice) stockSymbol.currentPrice = currentPrice;
      
      // Save the updated stock symbol
      await stockSymbol.save();
      
      return res.status(200).json({
        success: true,
        message: 'Stock symbol updated successfully',
        data: stockSymbol,
      });
    } catch (error) {
      console.error('Error updating stock symbol:', error);
      
      // Check if error is due to invalid ID format
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
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON response with deletion status or error
   */
  deleteStockSymbol: async (req, res) => {
    try {
      const { id } = req.params;
      
      const stockSymbol = await StockSymbol.findByIdAndDelete(id);
      
      if (!stockSymbol) {
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
      
      // Check if error is due to invalid ID format
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
  }
};

module.exports = stockSymbolController;