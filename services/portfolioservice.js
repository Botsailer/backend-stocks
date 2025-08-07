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
    let totalValue = parseFloat(portfolio.cashBalance) || 0;
    let priceSourceCounts = { closing: 0, current: 0, buy: 0 };
    
    logger.debug(`Starting portfolio calculation. Cash balance: ${totalValue}`);
    
    for (const holding of portfolio.holdings) {
      let price = null;
      let priceSource = null;
      const stock = await StockSymbol.findOne({ symbol: holding.symbol });
      
      // Prefer closing price if requested and available
      if (useClosingPrice && stock && stock.todayClosingPrice && stock.todayClosingPrice > 0) {
        price = stock.todayClosingPrice;
        priceSource = 'closing';
        priceSourceCounts.closing++;
      } 
      // Fallback to current price
      else if (stock && stock.currentPrice && stock.currentPrice > 0) {
        price = stock.currentPrice;
        priceSource = 'current';
        priceSourceCounts.current++;
      }
      // Final fallback to buy price
      else {
        price = parseFloat(holding.buyPrice) || 0;
        priceSource = 'buy';
        priceSourceCounts.buy++;
      }
      
      const holdingValue = price * (parseFloat(holding.quantity) || 0);
      logger.debug(`${holding.symbol}: ${priceSource} price ${price} × quantity ${holding.quantity} = ${holdingValue}`);
      totalValue += holdingValue;
    }
    
    const finalValue = parseFloat(totalValue.toFixed(2));
    logger.info(`Portfolio "${portfolio.name}" value: ₹${finalValue} (Cash: ${portfolio.cashBalance}, Holdings: ${(finalValue - portfolio.cashBalance).toFixed(2)}) | Price sources: ${priceSourceCounts.closing} closing, ${priceSourceCounts.current} current, ${priceSourceCounts.buy} buy`);
    return finalValue;
  } catch (error) {
    logger.error(`Calculate value failed for portfolio ${portfolio.name}: ${error.message}`);
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
      // 1. Calculate portfolio value
      const portfolioValue = await this.calculatePortfolioValue(portfolio, useClosingPrice);
      
      // 2. Update portfolio's current value
      await this.updatePortfolioCurrentValue(portfolio, portfolioValue);
      
      const now = new Date();
      const startOfDay = PriceLog.getStartOfDay(now);
      
      // 3. Fetch benchmark index value (if configured)
      let compareIndexValue = null;
      let benchmarkPriceSource = null;
      
      if (portfolio.compareWith && portfolio.compareWith.trim() !== '') {
        try {
          let indexStock = null;
          const compareWith = portfolio.compareWith.trim();
          
          logger.info(`🔍 Looking for comparison index: "${compareWith}"`);
          
          // Check if compareWith is a MongoDB ObjectId
          if (mongoose.Types.ObjectId.isValid(compareWith)) {
            indexStock = await StockSymbol.findById(compareWith);
          } 
          // Otherwise search by symbol
          else {
            indexStock = await StockSymbol.findOne({ 
              symbol: { $regex: new RegExp(`^${compareWith}$`, 'i') }
            });
          }
          
          if (indexStock) {
            logger.info(`📊 Index found: ${indexStock.symbol} (${indexStock.name})`);
            
            // Determine best available price with priority based on useClosingPrice
            if (useClosingPrice) {
              // For closing prices: todayClosingPrice → currentPrice → previousPrice
              if (indexStock.todayClosingPrice > 0) {
                compareIndexValue = indexStock.todayClosingPrice;
                benchmarkPriceSource = 'closing';
              } else if (indexStock.currentPrice > 0) {
                compareIndexValue = indexStock.currentPrice;
                benchmarkPriceSource = 'current';
              } else if (indexStock.previousPrice > 0) {
                compareIndexValue = indexStock.previousPrice;
                benchmarkPriceSource = 'previous';
              }
            } else {
              // For real-time prices: currentPrice → todayClosingPrice → previousPrice
              if (indexStock.currentPrice > 0) {
                compareIndexValue = indexStock.currentPrice;
                benchmarkPriceSource = 'current';
              } else if (indexStock.todayClosingPrice > 0) {
                compareIndexValue = indexStock.todayClosingPrice;
                benchmarkPriceSource = 'closing';
              } else if (indexStock.previousPrice > 0) {
                compareIndexValue = indexStock.previousPrice;
                benchmarkPriceSource = 'previous';
              }
            }
            
            if (compareIndexValue !== null) {
              logger.info(`✅ Using ${benchmarkPriceSource} price for ${indexStock.symbol}: ₹${compareIndexValue}`);
            } else {
              logger.error(`❌ No valid price found for ${indexStock.symbol}`);
            }
          } else {
            logger.error(`❌ Benchmark index "${compareWith}" not found`);
            
            // Try to find similar symbols for debugging
            const similarStocks = await StockSymbol.find({
              $or: [
                { symbol: { $regex: new RegExp(compareWith, 'i') }},
                { name: { $regex: new RegExp(compareWith, 'i') }}
              ]
            }).limit(5);
            
            if (similarStocks.length > 0) {
              logger.info(`🔍 Similar symbols found: ${similarStocks.map(s => `${s.symbol} (${s.name})`).join(', ')}`);
            }
          }
        } catch (error) {
          logger.error(`❌ Error fetching benchmark: ${error.message}`);
        }
      } else {
        logger.debug(`No benchmark index configured for portfolio ${portfolio.name}`);
      }

      // 4. Prepare log data
      const logData = {
        portfolioValue: portfolioValue,
        cashRemaining: portfolio.cashBalance,
        date: now,
        usedClosingPrices: useClosingPrice,
        compareIndexValue: compareIndexValue,
        compareIndexPriceSource: benchmarkPriceSource
      };

      logger.debug(`Creating/updating daily log:`, {
        portfolio: portfolio.name,
        value: portfolioValue,
        benchmarkValue: compareIndexValue,
        benchmarkSource: benchmarkPriceSource
      });

      // 5. Create/update price log
      const result = await PriceLog.createOrUpdateDailyLog(portfolio._id, logData);
      
      if (!result.success) {
        throw new Error(`Failed to save price log: ${result.error}`);
      }
      
      // 6. Handle log result
      const priceLog = result.priceLog;
      const isUpdate = result.action !== 'created';
      
      let logMessage = isUpdate 
        ? `🔄 Updated portfolio "${portfolio.name}" value: ₹${portfolioValue.toFixed(2)}`
        : `📊 Created portfolio "${portfolio.name}" daily log: ₹${portfolioValue.toFixed(2)}`;
      
      if (compareIndexValue !== null) {
        logMessage += ` | Benchmark ${portfolio.compareWith}: ₹${compareIndexValue.toFixed(2)}`;
      }
      
      logger.info(logMessage);
      
      return {
        portfolio: portfolio.name,
        status: 'success',
        value: portfolioValue,
        benchmarkValue: compareIndexValue,
        action: result.action
      };
      
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        logger.error(`Log value failed for ${portfolio.name} after ${MAX_RETRIES} attempts: ${error.message}`);
        return {
          portfolio: portfolio.name,
          status: 'failed',
          error: error.message
        };
      }
      
      logger.warn(`Attempt ${attempt} failed for ${portfolio.name}, retrying in 2s...`);
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
        compareDataPoints: 0,
        compareSymbol: portfolio?.compareWith || null
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
      value: log.portfolioValue,
      cash: log.cashRemaining,
      usedClosingPrice: log.usedClosingPrices
    }));

    // Transform to zero-based gains for comparison index
    let compareData = [];
    if (portfolio && portfolio.compareWith) {
      const logsWithCompareValue = filteredLogs.filter(
        log => log.compareIndexValue != null && log.compareIndexValue > 0
      );
      
      compareData = logsWithCompareValue.map(log => ({
        date: log.date,
        value: log.compareIndexValue,
        priceSource: log.compareIndexPriceSource || 'unknown'
      }));
    }else {
      logger.info(`No compareWith symbol set for portfolio ${portfolioId}`);
    }

     return {
      portfolioId,
      period,
      data: transformedData,
      compareData,
      compareSymbol: portfolio?.compareWith || null
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