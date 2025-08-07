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
    let priceSourceCounts = { closing: 0, current: 0, buy: 0 };
    
    for (const holding of portfolio.holdings) {
      let price = null;
      let priceSource = null;
      const stock = await StockSymbol.findOne({ symbol: holding.symbol });
      
      // Prefer closing price if requested and available
      if (useClosingPrice && stock && stock.todayClosingPrice) {
        price = parseFloat(stock.todayClosingPrice);
        priceSource = 'closing';
        priceSourceCounts.closing++;
      } 
      // Fallback to current price
      else if (stock && stock.currentPrice) {
        price = parseFloat(stock.currentPrice);
        priceSource = 'current';
        priceSourceCounts.current++;
      }
      // Final fallback to buy price
      else {
        price = holding.buyPrice;
        priceSource = 'buy';
        priceSourceCounts.buy++;
      }
      
      logger.debug(`${holding.symbol}: Using ${priceSource} price: ${price} × ${holding.quantity} = ${price * holding.quantity}`);
      totalValue += price * holding.quantity;
    }
    
    logger.info(`Portfolio value calculation: ₹${totalValue.toFixed(2)} (Used prices: ${priceSourceCounts.closing} closing, ${priceSourceCounts.current} current, ${priceSourceCounts.buy} buy)`);
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
      
      // Fetch compareWith index price if it exists
      let compareIndexValue = null;
      let benchmarkPriceSource = null;
      
      if (portfolio.compareWith) {
        try {
          let indexStock = null;
          
          // Check if compareWith is a MongoDB ObjectId
          if (/^[0-9a-fA-F]{24}$/.test(portfolio.compareWith)) {
            indexStock = await StockSymbol.findById(portfolio.compareWith);
          } else {
            indexStock = await StockSymbol.findOne({ symbol: portfolio.compareWith });
          }
          
          if (indexStock) {
            // For daily logs with closing prices, prefer todayClosingPrice
            if (useClosingPrice && indexStock.todayClosingPrice) {
              compareIndexValue = parseFloat(indexStock.todayClosingPrice);
              benchmarkPriceSource = 'closing';
              logger.debug(`Using closing price for benchmark ${indexStock.symbol}: ${compareIndexValue}`);
            } 
            // Otherwise use current price
            else if (indexStock.currentPrice) {
              compareIndexValue = parseFloat(indexStock.currentPrice);
              benchmarkPriceSource = 'current';
              logger.debug(`Using current price for benchmark ${indexStock.symbol}: ${compareIndexValue}`);
            } else {
              logger.warn(`No price available for benchmark ${indexStock.symbol}`);
            }
          } else {
            logger.warn(`Benchmark index ${portfolio.compareWith} not found in stock symbols`);
          }
        } catch (error) {
          logger.error(`Error fetching benchmark ${portfolio.compareWith}: ${error.message}`);
        }
      } else {
        logger.debug(`No benchmark index set for portfolio ${portfolio.name}`);
      }

      // Use the new static method for creating/updating logs with built-in retry
      const logData = {
        portfolioValue: portfolioValue,
        cashRemaining: portfolio.cashBalance,
        date: now,
        usedClosingPrices: useClosingPrice,
        compareIndexValue: compareIndexValue,
        compareIndexPriceSource: benchmarkPriceSource,
        dataVerified: true // Mark this data as verified
      };

      const result = await PriceLog.createOrUpdateDailyLog(portfolio._id, logData);
      
      if (!result.success) {
        throw new Error(`Failed to save price log: ${result.error}`);
      }
      
      const priceLog = result.priceLog;
      const isUpdate = result.action !== 'created';
      const previousValue = isUpdate ? await PriceLog.findOne({
        portfolio: portfolio._id,
        dateOnly: startOfDay
      }).then(log => log?.portfolioValue) : null;
      
      // Log result
      if (isUpdate) {
        const change = portfolioValue - previousValue;
        let logMsg = `🔄 Updated portfolio "${portfolio.name}" value: ₹${portfolioValue.toFixed(2)} (Δ${change >= 0 ? '+' : ''}${change.toFixed(2)})`;
        if (compareIndexValue) {
          logMsg += ` | Benchmark ${portfolio.compareWith}: ${compareIndexValue.toFixed(2)} (${priceLog.compareIndexPriceSource || 'unknown'} price)`;
        }
        logger.info(logMsg);
      } else {
        let logMsg = `📊 Created portfolio "${portfolio.name}" daily log: ₹${portfolioValue.toFixed(2)}`;
        if (compareIndexValue) {
          logMsg += ` | Benchmark ${portfolio.compareWith}: ${compareIndexValue.toFixed(2)} (${priceLog.compareIndexPriceSource || 'unknown'} price)`;
        }
        logger.info(logMsg);
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
const moment = require('moment-timezone');

exports.getPortfolioHistory = async (portfolioId, period = '1m', timezone = 'Asia/Kolkata') => {
  // Validate inputs
  if (!mongoose.Types.ObjectId.isValid(portfolioId)) {
    throw new Error('Invalid portfolio ID');
  }

  // Period configuration with improved intervals
  const periodConfig = {
    '1d': { days: 1, maxPoints: 24, interval: 'hours' },
    '1w': { days: 7, maxPoints: 14, interval: 'hours' },
    '1m': { days: 30, maxPoints: 30, interval: 'days' },
    '3m': { days: 90, maxPoints: 13, interval: 'days' },
    '6m': { days: 180, maxPoints: 24, interval: 'weeks' },
    '1y': { days: 365, maxPoints: 52, interval: 'weeks' },
    'all': { days: null, maxPoints: 100, interval: 'months' }
  };
  
  const config = periodConfig[period] || periodConfig['1m'];
  
  try {
    // Calculate date range with timezone support
    const startDate = config.days 
      ? moment().tz(timezone).subtract(config.days, 'days').startOf('day').toDate()
      : new Date(0);

    // Fetch logs and portfolio info
    const [allLogs, portfolio] = await Promise.all([
      PriceLog.find({
        portfolio: portfolioId,
        date: { $gte: startDate }
      }).sort({ date: 1 }), // Sort chronologically
      Portfolio.findById(portfolioId).select('compareWith')
    ]);

    if (allLogs.length === 0) {
      return { 
        portfolioId, 
        period, 
        baselineValue: 0, 
        data: [], 
        compareData: [],
        dataPoints: 0,
        compareDataPoints: 0
      };
    }

    // Convert logs to timezone-adjusted moments
    const tzLogs = allLogs.map(log => ({
      ...log.toObject(),
      tzMoment: moment(log.date).tz(timezone)
    }));

    // Find baseline (first log in period)
    const baselineLog = tzLogs[0];
    const baselineValue = baselineLog.portfolioValue;

    // Smart downsampling
    const filteredLogs = this.downsampleLogs(tzLogs, config);
    
    // Transform to zero-based gains for portfolio
    const transformedData = filteredLogs.map(log => ({
      date: log.date,
      gain: parseFloat((log.portfolioValue - baselineValue).toFixed(2)),
      value: log.portfolioValue,
      cash: log.cashRemaining,
      usedClosingPrice: log.usedClosingPrices
    }));

      // Transform to zero-based gains for comparison index
      let compareData = [];
      if (portfolio.compareWith) {
        // Filter logs with valid compareIndexValue
        const logsWithCompareValue = filteredLogs.filter(log => 
          log.compareIndexValue != null && !isNaN(log.compareIndexValue)
        );
        
        if (logsWithCompareValue.length > 0) {
          // Get baseline for index
          const indexBaselineValue = baselineIndexValue || logsWithCompareValue[0].compareIndexValue;
          
          if (indexBaselineValue != null && !isNaN(indexBaselineValue)) {
            compareData = logsWithCompareValue.map(log => ({
              date: log.date,
              gain: parseFloat((log.compareIndexValue - indexBaselineValue).toFixed(2)),
              value: log.compareIndexValue,
              priceSource: log.compareIndexPriceSource || 'unknown'
            }));
            
            logger.info(`Generated ${compareData.length} comparison data points for ${portfolio.compareWith}`);
          } else {
            logger.warn(`Invalid baseline value for ${portfolio.compareWith}: ${indexBaselineValue}`);
          }
        } else {
          logger.warn(`No valid comparison data found for ${portfolio.compareWith}`);
        }
      }

    return {
      portfolioId,
      period,
      baselineValue,
      baselineDate: baselineLog.date,
      dataPoints: transformedData.length,
      compareDataPoints: compareData.length,
      data: transformedData,
      compareData,
      compareSymbol: portfolio.compareWith || null
    };
    
  } catch (error) {
    logger.error(`Get history failed: ${error.message}`);
    throw error;
  }
};


exports.downsampleLogs = (logs, config) => {
  if (logs.length <= config.maxPoints) return logs;
  
  const interval = config.interval;
  const grouped = {};
  
  // Group logs by time interval
  logs.forEach(log => {
    const key = log.tzMoment.startOf(interval).format();
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(log);
  });
  
  // Select best representative from each group
  return Object.values(grouped).map(group => {
    // Prefer logs with closing prices
    const closingPriceLog = group.find(log => log.usedClosingPrices);
    if (closingPriceLog) return closingPriceLog;
    
    // Otherwise most recent in group
    return group.reduce((latest, current) => 
      current.date > latest.date ? current : latest
    );
  });
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