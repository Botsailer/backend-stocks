// services/portfolioService.js
const Portfolio = require('../models/modelPortFolio');
const StockSymbol = require('../models/stockSymbol');
const PriceLog = require('../models/PriceLog');
const winston = require('winston');
const { default: mongoose } = require('mongoose');

// Logger setup
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

// Calculate portfolio value using live prices
exports.calculatePortfolioValue = async (portfolio) => {
  try {
    let totalValue = portfolio.cashBalance;
    
    for (const holding of portfolio.holdings) {
      const stock = await StockSymbol.findOne({ symbol: holding.symbol });
      
      if (stock && stock.currentPrice) {
        totalValue += parseFloat(stock.currentPrice) * holding.quantity;
      } else {
        totalValue += holding.buyPrice * holding.quantity;
      }
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

// Log portfolio value with zero-based gain tracking
exports.logPortfolioValue = async (portfolio) => {
  try {
    const portfolioValue = await this.calculatePortfolioValue(portfolio);
    await this.updatePortfolioCurrentValue(portfolio, portfolioValue);
    
    const today = new Date();
    const dateKey = today.toISOString().split('T')[0];
    
    const priceLog = await PriceLog.findOneAndUpdate(
      {
        portfolio: portfolio._id,
        $expr: {
          $eq: [
            { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
            dateKey
          ]
        }
      },
      {
        $set: {
          portfolioValue: portfolioValue,
          cashRemaining: portfolio.cashBalance,
          date: new Date()
        },
        $setOnInsert: {
          portfolio: portfolio._id
        }
      },
      {
        upsert: true,
        new: true
      }
    );
    
    return priceLog;
  } catch (error) {
    logger.error(`Log value failed: ${error.message}`);
    throw error;
  }
};

// Get portfolio history with zero-based gains
exports.getPortfolioHistory = async (portfolioId, period = '1m') => {
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

    // Find baseline (earliest log in period)
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
      cash: log.cashRemaining
    }));

    return {
      portfolioId,
      period,
      baselineValue,
      baselineDate: baselineLog.date,
      data: transformedData
    };
    
  } catch (error) {
    logger.error(`Get history failed: ${error.message}`);
    throw error;
  }
};

// Process all portfolios daily
exports.logAllPortfoliosDaily = async () => {
  try {
    const portfolios = await Portfolio.find();
    const results = [];
    
    for (const portfolio of portfolios) {
      try {
        const log = await this.logPortfolioValue(portfolio);
        results.push({
          portfolio: portfolio.name,
          status: 'success',
          value: log.portfolioValue
        });
      } catch (error) {
        results.push({
          portfolio: portfolio.name,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    return results;
  } catch (error) {
    logger.error(`Daily log failed: ${error.message}`);
    throw error;
  }
};

// Manual portfolio recalculation
exports.recalculatePortfolioValue = async (portfolioId) => {
  try {
    const portfolio = await Portfolio.findById(portfolioId);
    if (!portfolio) throw new Error('Portfolio not found');
    
    const portfolioValue = await this.calculatePortfolioValue(portfolio);
    const updatedPortfolio = await this.updatePortfolioCurrentValue(portfolio, portfolioValue);
    
    return {
      portfolio: updatedPortfolio,
      calculatedValue: portfolioValue
    };
  } catch (error) {
    logger.error(`Recalculation failed: ${error.message}`);
    throw error;
  }
};