const Portfolio = require('../models/modelPortFolio');
const StockSymbol = require('../models/stockSymbol');
const PriceLog = require('../models/PriceLog');
const winston = require('winston');
const { default: mongoose } = require('mongoose');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ 
      filename: 'logs/portfolio-service.log',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 7
    })
  ]
});

// Calculate portfolio value with closing price preference
exports.calculatePortfolioValue = async (portfolio, useClosingPrice = false) => {
  try {
    let totalValue = portfolio.cashBalance;
    
    for (const holding of portfolio.holdings) {
      let price = null;
      const stock = await StockSymbol.findOne({ symbol: holding.symbol });
      
      // Prefer closing price if requested and available
      if (useClosingPrice && stock && stock.todayClosingPrice) {
        price = parseFloat(stock.todayClosingPrice);
        logger.debug(`Using closing price for ${holding.symbol}: ${price}`);
      } 
      // Fallback to current price
      else if (stock && stock.currentPrice) {
        price = parseFloat(stock.currentPrice);
        logger.debug(`Using current price for ${holding.symbol}: ${price}`);
      }
      // Final fallback to buy price
      else {
        price = holding.buyPrice;
        logger.warn(`Using buy price for ${holding.symbol}: ${price}`);
      }
      
      totalValue += price * holding.quantity;
    }
    
    return parseFloat(totalValue.toFixed(2));
  } catch (error) {
    logger.error(`Calculate value failed: ${error.message}`);
    throw error;
  }
};

// Update portfolio's current value
exports.updatePortfolioCurrentValue = async (portfolio, newValue) => {
  try {
    const updatedPortfolio = await Portfolio.findByIdAndUpdate(
      portfolio._id,
      { currentValue: newValue },
      { new: true }
    );
    return updatedPortfolio;
  } catch (error) {
    logger.error(`Update value failed: ${error.message}`);
    throw error;
  }
};

// Log portfolio value with retry
exports.logPortfolioValue = async (portfolio, useClosingPrice = false) => {
  const MAX_RETRIES = 3;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const portfolioValue = await this.calculatePortfolioValue(portfolio, useClosingPrice);
      await this.updatePortfolioCurrentValue(portfolio, portfolioValue);
      
      const now = new Date();
      const startOfDay = PriceLog.getStartOfDay(now);
      
      // Check if record exists
      const existingLog = await PriceLog.findOne({
        portfolio: portfolio._id,
        dateOnly: startOfDay
      });
      
      const isUpdate = !!existingLog;
      const previousValue = existingLog ? existingLog.portfolioValue : null;
      
      // Create/update log
      const priceLog = await PriceLog.findOneAndUpdate(
        { portfolio: portfolio._id, dateOnly: startOfDay },
        {
          $set: {
            portfolioValue: portfolioValue,
            cashRemaining: portfolio.cashBalance,
            date: now,
            dateOnly: startOfDay,
            usedClosingPrices: useClosingPrice
          },
          $inc: { updateCount: 1 }
        },
        { upsert: true, new: true, runValidators: true }
      );
      
      // Log result
      if (isUpdate) {
        const change = portfolioValue - previousValue;
        logger.info(`🔄 Updated portfolio "${portfolio.name}" value: ₹${portfolioValue} (Δ${change >= 0 ? '+' : ''}${change.toFixed(2)})`);
      } else {
        logger.info(`📊 Created portfolio "${portfolio.name}" daily log: ₹${portfolioValue}`);
      }
      
      return {
        portfolio: portfolio.name,
        status: 'success',
        value: portfolioValue,
        action: isUpdate ? 'updated' : 'created',
        valueChange: isUpdate ? portfolioValue - previousValue : 0
      };
      
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        logger.error(`Log value failed for portfolio ${portfolio.name} after ${MAX_RETRIES} attempts: ${error.message}`);
        return {
          portfolio: portfolio.name,
          status: 'failed',
          error: error.message
        };
      }
      
      logger.warn(`Attempt ${attempt} failed for ${portfolio.name}, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
};

// Enhanced daily logging with closing prices
exports.logAllPortfoliosDaily = async (useClosingPrice = false) => {
  try {
    const portfolios = await Portfolio.find();
    const results = [];
    
    for (const portfolio of portfolios) {
      const result = await this.logPortfolioValue(portfolio, useClosingPrice);
      results.push(result);
    }
    
    // Generate summary
    const successCount = results.filter(r => r.status === 'success').length;
    const failedCount = results.filter(r => r.status === 'failed').length;
    
    logger.info(`📋 Daily Summary: ${successCount} successful, ${failedCount} failed`);
    return results;
    
  } catch (error) {
    logger.error(`Daily log failed: ${error.message}`);
    throw error;
  }
};

// Get portfolio history
exports.getPortfolioHistory = async (portfolioId, period = '1m') => {
  const MAX_RETRIES = 2;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Validate inputs
      if (!mongoose.Types.ObjectId.isValid(portfolioId)) {
        throw new Error('Invalid portfolio ID');
      }

      // Period configuration
      const periodConfig = {
        '1d': { days: 1, maxPoints: 24, intervalHours: 1 },
        '1w': { days: 7, maxPoints: 14, intervalHours: 12 },
        '1m': { days: 30, maxPoints: 30, intervalDays: 1 },
        '3m': { days: 90, maxPoints: 13, intervalDays: 7 },
        '6m': { days: 180, maxPoints: 24, intervalDays: 7 },
        '1y': { days: 365, maxPoints: 26, intervalDays: 14 },
        'all': { days: null, maxPoints: 100, intervalDays: 7 }
      };
      
      const config = periodConfig[period] || periodConfig['1m'];
      const startDate = config.days 
        ? new Date(Date.now() - config.days * 86400000)
        : new Date(0);

      // Fetch logs
      const allLogs = await PriceLog.find({
        portfolio: portfolioId,
        date: { $gte: startDate }
      }).sort('date');

      if (allLogs.length === 0) {
        return { portfolioId, period, baselineValue: 0, data: [] };
      }

      // Find baseline
      const baselineLog = allLogs.reduce((oldest, current) => 
        current.date < oldest.date ? current : oldest
      );
      const baselineValue = baselineLog.portfolioValue;

      // Apply interval filtering
      let filteredLogs = allLogs;
      
      if (config.intervalDays && config.intervalDays > 1) {
        const intervalMs = config.intervalDays * 86400000;
        let lastIncluded = null;
        filteredLogs = [];
        
        for (const log of allLogs) {
          if (!lastIncluded || (log.date - lastIncluded) >= intervalMs) {
            filteredLogs.push(log);
            lastIncluded = log.date;
          }
        }
        
        // Always include the latest log
        if (filteredLogs.length === 0 || 
            filteredLogs[filteredLogs.length-1]._id !== allLogs[allLogs.length-1]._id) {
          filteredLogs.push(allLogs[allLogs.length-1]);
        }
      }
      
      // Transform to zero-based gains
      const transformedData = filteredLogs.map(log => ({
        date: log.date,
        gain: parseFloat((log.portfolioValue - baselineValue).toFixed(2)),
        value: log.portfolioValue,
        cash: log.cashRemaining,
        usedClosingPrice: log.usedClosingPrices
      }));

      return {
        portfolioId,
        period,
        baselineValue,
        baselineDate: baselineLog.date,
        data: transformedData
      };
      
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        logger.error(`Get history failed after ${MAX_RETRIES} attempts: ${error.message}`);
        throw error;
      }
      logger.warn(`History fetch attempt ${attempt} failed, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
};

// Manual portfolio recalculation
exports.recalculatePortfolioValue = async (portfolioId, useClosingPrice = false) => {
  const MAX_RETRIES = 3;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const portfolio = await Portfolio.findById(portfolioId);
      if (!portfolio) throw new Error('Portfolio not found');
      
      const portfolioValue = await this.calculatePortfolioValue(portfolio, useClosingPrice);
      const updatedPortfolio = await this.updatePortfolioCurrentValue(portfolio, portfolioValue);
      
      return {
        portfolio: updatedPortfolio,
        calculatedValue: portfolioValue,
        usedClosingPrice
      };
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        logger.error(`Recalculation failed after ${MAX_RETRIES} attempts: ${error.message}`);
        throw error;
      }
      logger.warn(`Recalculation attempt ${attempt} failed, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
};