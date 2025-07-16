// services/portfolioService.js
const Portfolio = require('../models/modelPortFolio');
const StockSymbol = require('../models/stockSymbol');
const PriceLog = require('../models/PriceLog');
const winston = require('winston');

// Create a logger for portfolio service
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} [${level}]: ${message}`;
        })
      )
    }),
    new winston.transports.File({ 
      filename: 'logs/portfolio-service.log',
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 7 // Keep 7 days of logs
    })
  ]
});

/**
 * Calculate current portfolio value using live stock prices
 * @param {Object} portfolio - Portfolio document
 * @returns {Number} - Total portfolio value
 */
exports.calculatePortfolioValue = async (portfolio) => {
  try {
    let totalValue = portfolio.cashBalance;
    let stocksUpdated = 0;
    let stocksFallback = 0;
    
    logger.info(`Calculating value for portfolio: ${portfolio.name} (ID: ${portfolio._id})`);
    
    for (const holding of portfolio.holdings) {
      // Try to find the stock by symbol alone (don't rely on exchange field)
      const stock = await StockSymbol.findOne({ symbol: holding.symbol });
      
      if (stock && stock.currentPrice) {
        const currentPrice = parseFloat(stock.currentPrice);
        const holdingValue = currentPrice * holding.quantity;
        const buyValue = holding.buyPrice * holding.quantity;
        const priceDiff = (((currentPrice - holding.buyPrice) / holding.buyPrice) * 100).toFixed(2);
        
        logger.info(`${portfolio.name}: ${holding.symbol} using LIVE price ${currentPrice} (${priceDiff}% from buy price ${holding.buyPrice}) = ${holdingValue.toFixed(2)}`);
        
        totalValue += holdingValue;
        stocksUpdated++;
      } else {
        const fallbackValue = holding.buyPrice * holding.quantity;
        logger.warn(`${portfolio.name}: ${holding.symbol} NO LIVE PRICE - using buy price ${holding.buyPrice} = ${fallbackValue.toFixed(2)}`);
        
        totalValue += fallbackValue;
        stocksFallback++;
      }
    }

    // Log the results summary
    if (stocksFallback > 0) {
      logger.warn(`${portfolio.name}: ${stocksUpdated} stocks used live prices, ${stocksFallback} used fallback buy prices`);
    } else {
      logger.info(`${portfolio.name}: All ${stocksUpdated} stocks used live prices!`);
    }

    logger.info(`${portfolio.name} calculated value: ${totalValue.toFixed(2)} (Cash: ${portfolio.cashBalance.toFixed(2)})`);
    
   return parseFloat(totalValue.toFixed(2));
  } catch (error) {
    logger.error(`Failed to calculate portfolio value for ${portfolio.name}: ${error.message}`);
    throw error;
  }
};

/**
 * Update the portfolio's currentValue field with latest valuation
 * @param {Object} portfolio - Portfolio document
 * @param {Number} newValue - Calculated portfolio value
 * @returns {Object} - Updated portfolio document
 */
exports.updatePortfolioCurrentValue = async (portfolio, newValue) => {
  try {
    const oldValue = portfolio.currentValue;
    const percentChange = oldValue > 0 ? 
      (((newValue - oldValue) / oldValue) * 100).toFixed(2) : 0;
    
    logger.info(`Updating ${portfolio.name} currentValue: ${oldValue.toFixed(2)} → ${newValue.toFixed(2)} (${percentChange}%)`);
    
    const updatedPortfolio = await Portfolio.findByIdAndUpdate(
      portfolio._id,
      { currentValue: newValue },
      { new: true }
    );
    
    return updatedPortfolio;
  } catch (error) {
    logger.error(`Failed to update currentValue for ${portfolio.name}: ${error.message}`);
    throw error;
  }
};

/**
 * Log portfolio value for historical tracking
 * @param {Object} portfolio - Portfolio document
 * @returns {Object} - Created PriceLog document
 */
exports.logPortfolioValue = async (portfolio) => {
  try {
    // Calculate latest portfolio value
    const portfolioValue = await this.calculatePortfolioValue(portfolio);
    
    // Update the portfolio's currentValue field
    await this.updatePortfolioCurrentValue(portfolio, portfolioValue);
    
    // Create a price log entry
    const priceLog = await PriceLog.create({
      portfolio: portfolio._id,
      date: new Date(),
 portfolioValue: parseFloat(portfolioValue.toFixed(2)),
    cashRemaining: parseFloat(portfolio.cashBalance.toFixed(2))
 
    });
    
    logger.info(`Created PriceLog for ${portfolio.name}: ID ${priceLog._id}, Value ${portfolioValue.toFixed(2)}`);
    
    return priceLog;
  } catch (error) {
    logger.error(`Failed to log portfolio value for ${portfolio.name}: ${error.message}`);
    throw error;
  }
};

/**
 * Process all portfolios and log their daily values
 * @returns {Array} - Array of results for each portfolio
 */
exports.logAllPortfoliosDaily = async () => {
  try {
    const portfolios = await Portfolio.find();
    const results = [];
    
    logger.info(`Starting daily valuation for ${portfolios.length} portfolios`);
    
    for (const portfolio of portfolios) {
      try {
        const log = await this.logPortfolioValue(portfolio);
        results.push({
          portfolio: portfolio.name,
          status: 'success',
          logId: log._id,
          value: log.portfolioValue
        });
      } catch (error) {
        logger.error(`Failed to process portfolio ${portfolio.name}: ${error.message}`);
        results.push({
          portfolio: portfolio.name,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    // Summarize results
    const successCount = results.filter(r => r.status === 'success').length;
    const failedCount = results.filter(r => r.status === 'failed').length;
    
    logger.info(`Daily valuation complete: ${successCount} portfolios succeeded, ${failedCount} portfolios failed`);
    
    return results;
  } catch (error) {
    logger.error(`Failed to run daily portfolio valuations: ${error.message}`);
    throw error;
  }
};

/**
 * Get historical portfolio values for charting
 * @param {String} portfolioId - Portfolio ID
 * @param {Number} days - Number of days to fetch (default: 30)
 * @returns {Array} - Array of price log entries
 */
exports.getPortfolioHistory = async (portfolioId, days = 30) => {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const priceLogs = await PriceLog.find({
      portfolio: portfolioId,
      date: { $gte: startDate }
    })
    .sort('date')
    .select('date portfolioValue cashRemaining');
    
    logger.info(`Retrieved ${priceLogs.length} historical data points for portfolio ${portfolioId}`);
    
    return priceLogs;
  } catch (error) {
    logger.error(`Failed to get portfolio history for ${portfolioId}: ${error.message}`);
    throw error;
  }
};

/**
 * Manually recalculate a portfolio's value
 * @param {String} portfolioId - Portfolio ID
 * @returns {Object} - Updated portfolio with new value
 */
exports.recalculatePortfolioValue = async (portfolioId) => {
  try {
    const portfolio = await Portfolio.findById(portfolioId);
    
    if (!portfolio) {
      throw new Error(`Portfolio not found: ${portfolioId}`);
    }
    
    const portfolioValue = await this.calculatePortfolioValue(portfolio);
    const updatedPortfolio = await this.updatePortfolioCurrentValue(portfolio, portfolioValue);
    
    logger.info(`Manual recalculation for ${portfolio.name}: new value ${portfolioValue.toFixed(2)}`);
    
    return {
      portfolio: updatedPortfolio,
      calculatedValue: portfolioValue
    };
  } catch (error) {
    logger.error(`Failed to recalculate portfolio ${portfolioId}: ${error.message}`);
    throw error;
  }
};