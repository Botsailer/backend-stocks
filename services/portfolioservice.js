const Portfolio = require('../models/modelPortFolio');
const StockSymbol = require('../models/stockSymbol');
const PriceLog = require('../models/PriceLog');
const winston = require('winston');
const { default: mongoose } = require('mongoose');
const portfolioCalculationLogger = require('./portfolioCalculationLogger');
const transactionLogger = require('../utils/transactionLogger');
const portfolioTransactionLogger = require('../utils/portfolioTransactionLogger');


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
    let priceSourceCounts = { closing: 0, current: 0, buy: 0, sold: 0 };
    let activeHoldings = 0;
    let soldHoldings = 0;
    
    logger.debug(`Starting portfolio calculation. Cash balance: ${totalValue}`);
    
    for (const holding of portfolio.holdings) {
      // Skip sold stocks - they don't contribute to portfolio value
      if (holding.status === 'Sell' || holding.quantity === 0) {
        logger.debug(`${holding.symbol}: SOLD - Excluding from portfolio value calculation`);
        priceSourceCounts.sold++;
        soldHoldings++;
        continue;
      }

      activeHoldings++;
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
    logger.info(`Portfolio "${portfolio.name}" value: ₹${finalValue} (Cash: ${portfolio.cashBalance}, Active Holdings: ${activeHoldings}, Sold Holdings: ${soldHoldings}) | Price sources: ${priceSourceCounts.closing} closing, ${priceSourceCounts.current} current, ${priceSourceCounts.buy} buy, ${priceSourceCounts.sold} sold`);
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
      { 
        currentValue: newValue,
        // Update lastUpdated timestamp for tracking
        lastValueUpdate: new Date()
      },
      { new: true }
    );
    
    // Also update weights based on current market prices
    await updatedPortfolio.updateWithMarketPrices();
    await updatedPortfolio.save();
    
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



exports.calculateRealTimeValue = async (portfolio) => {
  try {
    let totalValue = parseFloat(portfolio.cashBalance) || 0;
    const priceMap = new Map();
    
    // Get all symbols in portfolio
    const symbols = portfolio.holdings.map(h => h.symbol);
    
    // Batch fetch current prices from database
    const stocks = await StockSymbol.find({ symbol: { $in: symbols } });
    stocks.forEach(stock => {
      priceMap.set(stock.symbol, stock.currentPrice);
    });

    portfolio.holdings.forEach(holding => {
      const realTimePrice = priceMap.get(holding.symbol) || holding.buyPrice;
      const holdingValue = realTimePrice * holding.quantity;
      totalValue += holdingValue;
    });

    return parseFloat(totalValue.toFixed(2));
  } catch (error) {
    logger.error(`Real-time calculation failed: ${error.message}`);
    throw error;
  }
};

exports.generateChartData = async (portfolioId, days = 30) => {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);
  
  // Get historical logs
  const logs = await PriceLog.find({
    portfolio: portfolioId,
    date: { $gte: startDate }
  }).sort({ date: 1 });

  const chartData = [];
  let previousValue = null;

  for (const log of logs) {
    const dailyValue = log.portfolioValue;
    
    // Calculate percentage change
    let changePercent = 0;
    if (previousValue !== null && previousValue > 0) {
      changePercent = ((dailyValue - previousValue) / previousValue) * 100;
    }
    
    chartData.push({
      date: log.date,
      portfolioValue: dailyValue,
      benchmarkValue: log.compareIndexValue,
      changePercent: parseFloat(changePercent.toFixed(2))
    });
    
    previousValue = dailyValue;
  }

  return chartData;
};

exports.updatePortfolioValue = async (portfolioId) => {
  try {
    const portfolio = await Portfolio.findById(portfolioId);
    if (!portfolio) return null;
    
    // Calculate real-time value
    const realTimeValue = await this.calculateRealTimeValue(portfolio);
    
    // Update stored value in database
    await this.updatePortfolioCurrentValue(portfolio, realTimeValue);
    
    logger.info(`Portfolio ${portfolio.name} value updated: ₹${realTimeValue}`);
    return realTimeValue;
  } catch (error) {
    logger.error(`Portfolio value update failed: ${error.message}`);
    throw error;
  }
};

// Mass update all portfolio values with current market prices
exports.updateAllPortfolioValues = async () => {
  try {
    const portfolios = await Portfolio.find();
    const results = [];
    
    for (const portfolio of portfolios) {
      try {
        const updatedValue = await this.updatePortfolioValue(portfolio._id);
        results.push({
          portfolio: portfolio.name,
          status: 'success',
          value: updatedValue
        });
      } catch (error) {
        results.push({
          portfolio: portfolio.name,
          status: 'failed',
          error: error.message
        });
        logger.error(`Failed to update ${portfolio.name}: ${error.message}`);
      }
    }
    
    const successCount = results.filter(r => r.status === 'success').length;
    logger.info(`Portfolio values updated: ${successCount}/${portfolios.length} successful`);
    
    return results;
  } catch (error) {
    logger.error(`Mass portfolio update failed: ${error.message}`);
    throw error;
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
}

// New function for detailed portfolio calculation with step-by-step logging
exports.calculatePortfolioValueWithDetailedLogging = async (portfolioId) => {
  try {
    const portfolio = await Portfolio.findById(portfolioId);
    if (!portfolio) {
      throw new Error(`Portfolio with ID ${portfolioId} not found`);
    }

    logger.info(`🔍 Starting detailed portfolio calculation with logging for "${portfolio.name}"`);
    
    // Use the detailed logger to perform step-by-step calculation
    const result = await portfolioCalculationLogger.logCompleteCalculation(portfolio);
    
    // Update the portfolio with calculated values
    const updatedPortfolio = await Portfolio.findByIdAndUpdate(
      portfolioId,
      {
        currentValue: result.totalPortfolioValue,
        cashBalance: result.cashBalance,
        holdingsValueAtMarket: result.holdingsValueAtMarket,
        lastValueUpdate: new Date()
      },
      { new: true }
    );

    logger.info(`✅ Detailed calculation completed for portfolio "${portfolio.name}". Total value: ₹${result.totalPortfolioValue}`);
    
    return {
      success: true,
      portfolio: updatedPortfolio,
      calculationResult: result,
      message: 'Portfolio calculation completed with detailed logging'
    };

  } catch (error) {
    logger.error(`❌ Detailed calculation failed for portfolio ${portfolioId}: ${error.message}`);
    throw error;
  }
};

// Enhanced stock sale processing with detailed logging
exports.processStockSaleWithLogging = async (portfolioId, saleData) => {
  try {
    const portfolio = await Portfolio.findById(portfolioId);
    if (!portfolio) {
      throw new Error('Portfolio not found');
    }

    const { symbol, quantityToSell, saleType = 'partial' } = saleData;
    
    // Find the holding to sell
    const holdingIndex = portfolio.holdings.findIndex(
      h => h.symbol.toUpperCase() === symbol.toUpperCase() && h.status !== 'Sell'
    );

    if (holdingIndex === -1) {
      throw new Error(`Holding not found for symbol: ${symbol}`);
    }

    const existingHolding = portfolio.holdings[holdingIndex];
    
    // Log the existing holding to debug missing fields
    logger.info(`🔍 Existing holding before sale:`, {
      symbol: existingHolding.symbol,
      sector: existingHolding.sector,
      buyPrice: existingHolding.buyPrice,
      quantity: existingHolding.quantity,
      minimumInvestmentValueStock: existingHolding.minimumInvestmentValueStock,
      status: existingHolding.status
    });
    
    // Validate that the existing holding has all required fields
    if (!existingHolding.symbol || !existingHolding.sector || 
        !existingHolding.buyPrice || existingHolding.buyPrice <= 0) {
      throw new Error(`Existing holding for ${symbol} is missing required fields`);
    }
    
    // Get current market price
    const stock = await StockSymbol.findOne({ symbol: existingHolding.symbol });
    let currentMarketPrice = existingHolding.buyPrice; // fallback
    
    if (stock) {
      if (stock.currentPrice && stock.currentPrice > 0) {
        currentMarketPrice = stock.currentPrice;
      } else if (stock.todayClosingPrice && stock.todayClosingPrice > 0) {
        currentMarketPrice = stock.todayClosingPrice;
      }
    }

    logger.info(`🔄 Processing ${saleType} sale for ${symbol}`, {
      portfolioId,
      symbol,
      quantityToSell,
      existingQuantity: existingHolding.quantity,
      currentMarketPrice,
      saleType
    });

    // Handle special case: if quantity is already 0, calculate sale proceeds and add to cash
    if (existingHolding.quantity === 0) {
      const saleValue = quantityToSell * currentMarketPrice;
      const profitLoss = (currentMarketPrice - existingHolding.buyPrice) * quantityToSell;
      
      // Add sale proceeds to cash balance
      portfolio.cashBalance = (portfolio.cashBalance || 0) + saleValue;
      
      // Mark as sold
      portfolio.holdings[holdingIndex] = {
        ...existingHolding,
        status: 'Sell',
        soldDate: new Date().toISOString(),
        finalSalePrice: currentMarketPrice,
        totalSaleValue: saleValue,
        totalProfitLoss: profitLoss,
        realizedPnL: (existingHolding.realizedPnL || 0) + profitLoss
      };

      await portfolio.save();

      logger.info(`✅ Manual quantity 0 sale processed for ${symbol}`, {
        saleValue,
        profitLoss,
        newCashBalance: portfolio.cashBalance
      });

      return {
        success: true,
        message: 'Sale processed for zero quantity stock',
        saleValue,
        profitLoss,
        newCashBalance: portfolio.cashBalance
      };
    }

    // Determine actual quantity to sell
    let actualQuantityToSell = quantityToSell;
    if (saleType === 'complete' || quantityToSell >= existingHolding.quantity) {
      actualQuantityToSell = existingHolding.quantity;
      // Force complete sale type when selling all available quantity
      saleData.saleType = 'complete';
    }

    // Capture portfolio state before transaction for logging
    const portfolioBefore = {
      totalValue: await exports.calculatePortfolioValue(portfolio).then(result => result.totalValue),
      cashBalance: portfolio.cashBalance || 0,
      totalInvestment: portfolio.holdings.reduce((sum, h) => sum + (h.buyPrice * h.quantity), 0),
      holdingsCount: portfolio.holdings.filter(h => h.status !== 'Sell').length
    };

    // Capture holding state before transaction
    const beforeState = {
      quantity: existingHolding.quantity,
      buyPrice: existingHolding.buyPrice,
      investmentValueAtBuy: existingHolding.buyPrice * existingHolding.quantity,
      investmentValueAtMarket: currentMarketPrice * existingHolding.quantity,
      weight: existingHolding.weight || 0,
      unrealizedPnL: (currentMarketPrice - existingHolding.buyPrice) * existingHolding.quantity,
      unrealizedPnLPercent: ((currentMarketPrice - existingHolding.buyPrice) / existingHolding.buyPrice) * 100
    };

    // Process the sale using the calculation validator
    const { PortfolioCalculationValidator } = require('../utils/portfolioCalculationValidator');
    const saleResult = PortfolioCalculationValidator.processStockSale(
      { quantityToSell: actualQuantityToSell, saleType: saleData.saleType },
      existingHolding,
      currentMarketPrice,
      portfolio.cashBalance || 0
    );

    // Prepare transaction data for logging
    const transactionData = {
      sellPrice: currentMarketPrice,
      quantity: actualQuantityToSell,
      totalSaleValue: saleResult.operation.saleValue,
      transactionFee: 0,
      netAmount: saleResult.operation.saleValue
    };

    const sellCalculation = {
      originalInvestment: existingHolding.buyPrice * actualQuantityToSell,
      realizedPnL: saleResult.operation.profitLoss,
      realizedPnLPercent: ((currentMarketPrice - existingHolding.buyPrice) / existingHolding.buyPrice) * 100,
      remainingInvestment: saleResult.operation.type === 'complete_sale' ? 0 : 
        existingHolding.buyPrice * (existingHolding.quantity - actualQuantityToSell),
      remainingMarketValue: saleResult.operation.type === 'complete_sale' ? 0 : 
        currentMarketPrice * (existingHolding.quantity - actualQuantityToSell)
    };

    // Get stock data for logging
    const stockData = await StockSymbol.findOne({ symbol: existingHolding.symbol }) || {
      currentPrice: currentMarketPrice,
      symbol: existingHolding.symbol
    };

    // Update portfolio with sale results
    portfolio.cashBalance = saleResult.cashImpact.newBalance;
    
    // Handle complete vs partial sales
    if (saleResult.operation.type === 'complete_sale' || saleResult.updatedHolding.quantity === 0) {
      // For complete sales, remove the holding entirely to avoid validation errors
      portfolio.holdings.splice(holdingIndex, 1);
      
      // Store sale information in a separate field if needed for history
      if (!portfolio.saleHistory) {
        portfolio.saleHistory = [];
      }
      portfolio.saleHistory.push({
        symbol: existingHolding.symbol,
        soldDate: new Date().toISOString(),
        originalQuantity: existingHolding.quantity,
        salePrice: currentMarketPrice,
        saleValue: saleResult.operation.saleValue,
        profitLoss: saleResult.operation.profitLoss,
        originalBuyPrice: existingHolding.buyPrice
      });
      
      logger.info(`📤 Removed holding ${symbol} after complete sale`, {
        portfolioId,
        originalQuantity: existingHolding.quantity,
        saleValue: saleResult.operation.saleValue,
        profitLoss: saleResult.operation.profitLoss
      });
    } else {
      // For partial sales, create the updated holding manually with all required fields
      const remainingQuantity = existingHolding.quantity - actualQuantityToSell;
      const newInvestmentValue = remainingQuantity * existingHolding.buyPrice;
      const profitLoss = (currentMarketPrice - existingHolding.buyPrice) * actualQuantityToSell;
      const saleValue = actualQuantityToSell * currentMarketPrice;
      
      // Create a clean updated holding object with all required fields
      const updatedHolding = {
        symbol: existingHolding.symbol,
        sector: existingHolding.sector,
        buyPrice: existingHolding.buyPrice,
        quantity: remainingQuantity,
        minimumInvestmentValueStock: Number(newInvestmentValue.toFixed(2)),
        weight: existingHolding.weight || 0,
        stockCapType: existingHolding.stockCapType,
        status: 'Hold', // Reset to Hold after partial sale
        originalBuyPrice: existingHolding.originalBuyPrice || existingHolding.buyPrice,
        realizedPnL: (existingHolding.realizedPnL || 0) + profitLoss,
        priceHistory: [
          ...(existingHolding.priceHistory || []),
          {
            date: new Date().toISOString(),
            price: currentMarketPrice,
            quantity: -actualQuantityToSell, // Negative for sale
            saleValue: saleValue,
            profitLoss: profitLoss,
            action: 'partial_sell'
          }
        ],
        lastSaleDate: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        createdAt: existingHolding.createdAt
      };
      
      // Validate the manually created holding
      if (!updatedHolding.symbol || !updatedHolding.sector || 
          !updatedHolding.buyPrice || updatedHolding.buyPrice <= 0 ||
          !updatedHolding.quantity || updatedHolding.quantity <= 0 ||
          !updatedHolding.minimumInvestmentValueStock || updatedHolding.minimumInvestmentValueStock <= 0) {
        
        logger.error(`❌ Manual holding creation failed:`, {
          symbol: updatedHolding.symbol || 'MISSING',
          sector: updatedHolding.sector || 'MISSING',
          buyPrice: updatedHolding.buyPrice || 'MISSING',
          quantity: updatedHolding.quantity || 'MISSING',
          minimumInvestmentValueStock: updatedHolding.minimumInvestmentValueStock || 'MISSING'
        });
        
        throw new Error(`Failed to create valid holding data after partial sale for ${symbol}`);
      }
      
      portfolio.holdings[holdingIndex] = updatedHolding;
      
      logger.info(`📝 Updated holding ${symbol} after partial sale`, {
        portfolioId,
        remainingQuantity: updatedHolding.quantity,
        newInvestmentValue: updatedHolding.minimumInvestmentValueStock,
        realizedPnL: updatedHolding.realizedPnL,
        profitLoss: profitLoss,
        saleValue: saleValue
      });
    }

    // Calculate portfolio state after transaction for logging
    const portfolioAfter = {
      totalValue: portfolioBefore.totalValue - sellCalculation.originalInvestment + saleResult.operation.profitLoss,
      cashBalance: saleResult.cashImpact.newBalance,
      totalInvestment: portfolioBefore.totalInvestment - sellCalculation.originalInvestment,
      holdingsCount: saleResult.operation.type === 'complete_sale' ? 
        portfolioBefore.holdingsCount - 1 : portfolioBefore.holdingsCount
    };

    // Determine after state for logging
    const afterState = saleResult.operation.type === 'complete_sale' ? null : {
      quantity: saleResult.updatedHolding.quantity,
      buyPrice: existingHolding.buyPrice,
      investmentValueAtBuy: existingHolding.buyPrice * saleResult.updatedHolding.quantity,
      investmentValueAtMarket: currentMarketPrice * saleResult.updatedHolding.quantity,
      weight: 0, // Will be calculated after save
      unrealizedPnL: (currentMarketPrice - existingHolding.buyPrice) * saleResult.updatedHolding.quantity,
      unrealizedPnLPercent: ((currentMarketPrice - existingHolding.buyPrice) / existingHolding.buyPrice) * 100,
      status: saleResult.operation.type === 'complete_sale' ? 'Sell' : 'Hold'
    };

    // Log the sell transaction
    await transactionLogger.logSellTransaction({
      portfolioId: portfolio._id,
      portfolioName: portfolio.name,
      stockSymbol: existingHolding.symbol,
      action: saleResult.operation.type === 'complete_sale' ? 'Sell' : 'partial-sell',
      beforeState,
      stockData,
      transactionData,
      afterState,
      portfolioBefore,
      portfolioAfter,
      userEmail: 'System', // Can be passed from controller if available
      sellCalculation
    });
    
    // Validate all holdings before saving
    for (let i = 0; i < portfolio.holdings.length; i++) {
      const holding = portfolio.holdings[i];
      if (!holding.symbol || !holding.sector || 
          !holding.buyPrice || holding.buyPrice <= 0 ||
          !holding.quantity || holding.quantity <= 0 ||
          !holding.minimumInvestmentValueStock || holding.minimumInvestmentValueStock <= 0) {
        
        logger.error(`❌ Invalid holding found at index ${i} before save:`, {
          index: i,
          symbol: holding.symbol,
          sector: holding.sector,
          buyPrice: holding.buyPrice,
          quantity: holding.quantity,
          minimumInvestmentValueStock: holding.minimumInvestmentValueStock
        });
        
        throw new Error(`Invalid holding data found for ${holding.symbol || 'unknown symbol'} at index ${i}`);
      }
    }

    // Save portfolio
    await portfolio.save();

    // Log final portfolio snapshot
    await transactionLogger.logPortfolioSnapshot(portfolio, `After ${saleResult.operation.type} of ${symbol}`);

    logger.info(`✅ Stock sale completed for ${symbol}`, {
      portfolioId,
      operation: saleResult.operation.type,
      quantitySold: saleResult.operation.quantitySold,
      saleValue: saleResult.operation.saleValue,
      profitLoss: saleResult.operation.profitLoss,
      newCashBalance: saleResult.cashImpact.newBalance,
      newQuantity: saleResult.updatedHolding.quantity,
      newStatus: saleResult.updatedHolding.status
    });

    return {
      success: true,
      saleResult,
      updatedPortfolio: portfolio
    };

  } catch (error) {
    logger.error(`Stock sale failed for portfolio ${portfolioId}: ${error.message}`);
    throw error;
  }
};

// Enhanced stock sale processing with comprehensive debug logging
exports.processStockSaleWithDetailedLogging = async (portfolioId, saleData, userEmail = 'System') => {
  const startTime = Date.now();
  
  try {
    portfolioTransactionLogger.logger.info('💰 STOCK SALE TRANSACTION INITIATED', {
      portfolioId,
      userEmail,
      frontendData: saleData,
      timestamp: new Date().toISOString()
    });

    // 1. FRONTEND DATA VALIDATION & ANALYSIS
    portfolioTransactionLogger.logger.debug('📥 ANALYZING FRONTEND SALE REQUEST', {
      step: '1_FRONTEND_ANALYSIS',
      receivedData: saleData,
      saleType: saleData.saleType || 'partial',
      dataValidation: {
        hasSymbol: !!saleData.symbol,
        hasQuantity: !!saleData.quantityToSell,
        hasSaleType: !!saleData.saleType,
        quantityIsValid: saleData.quantityToSell > 0
      }
    });

    // 2. FETCH PORTFOLIO FROM DATABASE
    const portfolio = await Portfolio.findById(portfolioId);
    if (!portfolio) {
      throw new Error(`Portfolio with ID ${portfolioId} not found`);
    }

    // 3. FIND HOLDING TO SELL
    const holdingIndex = portfolio.holdings.findIndex(
      h => h.symbol.toUpperCase() === saleData.symbol.toUpperCase() && h.status !== 'Sell'
    );

    if (holdingIndex === -1) {
      throw new Error(`No active holding found for symbol: ${saleData.symbol}`);
    }

    const beforeHoldingState = portfolio.holdings[holdingIndex];
    
    portfolioTransactionLogger.logger.debug('🔍 HOLDING ANALYSIS BEFORE SALE', {
      step: '3_HOLDING_ANALYSIS',
      holdingData: {
        symbol: beforeHoldingState.symbol,
        currentQuantity: beforeHoldingState.quantity,
        quantityToSell: saleData.quantityToSell,
        remainingAfterSale: beforeHoldingState.quantity - saleData.quantityToSell,
        originalBuyPrice: beforeHoldingState.buyPrice,
        currentInvestment: beforeHoldingState.minimumInvestmentValueStock,
        sector: beforeHoldingState.sector,
        status: beforeHoldingState.status
      },
      saleValidation: {
        hasSufficientQuantity: beforeHoldingState.quantity >= saleData.quantityToSell,
        quantityDeficit: Math.max(0, saleData.quantityToSell - beforeHoldingState.quantity),
        isCompleteSale: saleData.quantityToSell >= beforeHoldingState.quantity || saleData.saleType === 'complete'
      }
    });

    // Validate quantity
    if (beforeHoldingState.quantity < saleData.quantityToSell) {
      throw new Error(`Insufficient quantity. Available: ${beforeHoldingState.quantity}, Requested: ${saleData.quantityToSell}`);
    }

    // 4. GET CURRENT MARKET PRICE
    const stock = await StockSymbol.findOne({ symbol: beforeHoldingState.symbol });
    let currentMarketPrice = beforeHoldingState.buyPrice; // fallback
    
    if (stock) {
      if (stock.currentPrice && stock.currentPrice > 0) {
        currentMarketPrice = stock.currentPrice;
      } else if (stock.todayClosingPrice && stock.todayClosingPrice > 0) {
        currentMarketPrice = stock.todayClosingPrice;
      }
    }

    portfolioTransactionLogger.logger.debug('📈 MARKET PRICE ANALYSIS FOR SALE', {
      step: '4_MARKET_PRICE_ANALYSIS',
      priceData: {
        currentMarketPrice,
        originalBuyPrice: beforeHoldingState.buyPrice,
        priceSource: stock?.currentPrice ? 'current' : (stock?.todayClosingPrice ? 'closing' : 'fallback'),
        pricePerShareGain: (currentMarketPrice - beforeHoldingState.buyPrice).toFixed(2),
        pricePerShareGainPercent: (((currentMarketPrice - beforeHoldingState.buyPrice) / beforeHoldingState.buyPrice) * 100).toFixed(2) + '%'
      }
    });

    // 5. CALCULATE SALE DETAILS
    const actualQuantityToSell = saleData.saleType === 'complete' ? beforeHoldingState.quantity : saleData.quantityToSell;
    const grossSaleValue = actualQuantityToSell * currentMarketPrice;
    const transactionFee = 0; // Add fee logic if needed
    const netSaleProceeds = grossSaleValue - transactionFee;
    const originalInvestment = actualQuantityToSell * beforeHoldingState.buyPrice;
    const realizedProfitLoss = netSaleProceeds - originalInvestment;
    const realizedProfitLossPercent = (realizedProfitLoss / originalInvestment) * 100;

    const calculationProcess = {
      quantityToSell: actualQuantityToSell,
      salePrice: currentMarketPrice,
      grossSaleValue,
      transactionFee,
      netSaleProceeds,
      originalInvestment,
      realizedProfitLoss,
      realizedProfitLossPercent: realizedProfitLossPercent.toFixed(2) + '%',
      newCashBalance: portfolio.cashBalance + netSaleProceeds
    };

    portfolioTransactionLogger.logger.debug('🧮 SALE CALCULATION BREAKDOWN', {
      step: '5_SALE_CALCULATIONS',
      calculations: calculationProcess,
      profitLossAnalysis: {
        totalGain: realizedProfitLoss.toFixed(2),
        gainPerShare: ((currentMarketPrice - beforeHoldingState.buyPrice)).toFixed(2),
        gainPercentage: realizedProfitLossPercent.toFixed(2) + '%',
        isProfit: realizedProfitLoss > 0,
        originalInvestmentValue: originalInvestment.toFixed(2),
        saleValue: netSaleProceeds.toFixed(2)
      }
    });

    // 6. UPDATE PORTFOLIO
    const beforePortfolioState = {
      currentValue: portfolio.currentValue,
      cashBalance: portfolio.cashBalance,
      totalHoldings: portfolio.holdings.length
    };

    portfolio.cashBalance = calculationProcess.newCashBalance;

    let afterHoldingState = null;
    
    if (actualQuantityToSell >= beforeHoldingState.quantity) {
      // Complete sale - remove holding
      portfolio.holdings.splice(holdingIndex, 1);
      
      portfolioTransactionLogger.logger.debug('📤 COMPLETE SALE - HOLDING REMOVED', {
        step: '6_COMPLETE_SALE',
        symbol: saleData.symbol,
        soldQuantity: actualQuantityToSell,
        saleValue: netSaleProceeds,
        profitLoss: realizedProfitLoss
      });
    } else {
      // Partial sale - update holding
      const remainingQuantity = beforeHoldingState.quantity - actualQuantityToSell;
      const remainingInvestment = remainingQuantity * beforeHoldingState.buyPrice;
      
      afterHoldingState = {
        ...beforeHoldingState,
        quantity: remainingQuantity,
        minimumInvestmentValueStock: remainingInvestment,
        lastUpdated: new Date().toISOString()
      };
      
      portfolio.holdings[holdingIndex] = afterHoldingState;
      
      portfolioTransactionLogger.logger.debug('🔄 PARTIAL SALE - HOLDING UPDATED', {
        step: '6_PARTIAL_SALE',
        symbol: saleData.symbol,
        soldQuantity: actualQuantityToSell,
        remainingQuantity,
        remainingInvestment,
        saleValue: netSaleProceeds,
        profitLoss: realizedProfitLoss
      });
    }

    // 7. SAVE TO DATABASE
    const dbSaveStart = Date.now();
    await portfolio.save();
    const dbSaveTime = Date.now() - dbSaveStart;

    // 8. AFTER STATE ANALYSIS
    const afterPortfolioState = {
      currentValue: await exports.calculatePortfolioValue(portfolio, false),
      cashBalance: portfolio.cashBalance,
      totalHoldings: portfolio.holdings.length
    };

    portfolioTransactionLogger.logger.debug('📊 PORTFOLIO STATE AFTER SALE', {
      step: '8_AFTER_STATE',
      changes: {
        portfolioValueChange: afterPortfolioState.currentValue - beforePortfolioState.currentValue,
        cashIncrease: calculationProcess.netSaleProceeds,
        holdingsReduction: beforePortfolioState.totalHoldings - afterPortfolioState.totalHoldings
      }
    });

    // 9. LOG COMPLETE TRANSACTION
    await portfolioTransactionLogger.logSellTransactionFlow({
      frontendData: saleData,
      portfolioId,
      portfolioName: portfolio.name,
      userEmail,
      stockSymbol: saleData.symbol,
      beforePortfolioState,
      beforeHoldingState,
      stockMarketData: stock || { symbol: saleData.symbol },
      calculationProcess,
      afterHoldingState,
      afterPortfolioState,
      validationResults: {
        portfolioValidation: { success: true },
        holdingValidation: { success: true }
      },
      dbOperationResults: {
        operations: ['portfolio_update', 'holding_update'],
        portfolioSave: { success: true, executionTime: dbSaveTime },
        errors: []
      },
      profitLossAnalysis: {
        realizedProfitLoss,
        realizedProfitLossPercent,
        holdingPeriod: 'N/A', // Could calculate from purchase date
        isLongTerm: false
      }
    });

    const totalExecutionTime = Date.now() - startTime;

    portfolioTransactionLogger.logger.info('✅ STOCK SALE COMPLETED SUCCESSFULLY', {
      transactionSummary: {
        portfolioId,
        portfolioName: portfolio.name,
        symbol: saleData.symbol,
        quantitySold: actualQuantityToSell,
        salePrice: currentMarketPrice,
        netProceeds: netSaleProceeds,
        realizedProfitLoss,
        finalPortfolioValue: afterPortfolioState.currentValue,
        finalCashBalance: afterPortfolioState.cashBalance,
        executionTime: totalExecutionTime + 'ms',
        timestamp: new Date().toISOString()
      }
    });

    return {
      success: true,
      portfolio,
      transaction: {
        type: 'SELL',
        symbol: saleData.symbol,
        quantity: actualQuantityToSell,
        price: currentMarketPrice,
        netProceeds,
        profitLoss: realizedProfitLoss,
        executionTime: totalExecutionTime
      }
    };

  } catch (error) {
    const totalExecutionTime = Date.now() - startTime;
    
    await portfolioTransactionLogger.logError(
      'STOCK_SALE_ERROR',
      error.message,
      {
        portfolioId,
        saleData,
        userEmail,
        executionTime: totalExecutionTime
      },
      error.stack
    );

    throw error;
  }
};

// Cleanup sold stocks older than 10 days
exports.cleanupOldSoldStocks = async () => {
  try {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    logger.info('🧹 Starting cleanup of sold stocks older than 10 days');

    const portfolios = await Portfolio.find({});
    let totalCleaned = 0;

    for (const portfolio of portfolios) {
      const originalHoldingsCount = portfolio.holdings.length;
      
      // Filter out sold stocks older than 10 days
      portfolio.holdings = portfolio.holdings.filter(holding => {
        if (holding.status === 'Sell' && holding.soldDate) {
          const soldDate = new Date(holding.soldDate);
          const shouldRemove = soldDate < tenDaysAgo;
          
          if (shouldRemove) {
            logger.debug(`🗑️ Removing old sold stock: ${holding.symbol} from portfolio ${portfolio.name}`, {
              soldDate: holding.soldDate,
              daysSinceSold: Math.floor((new Date() - soldDate) / (1000 * 60 * 60 * 24))
            });
            totalCleaned++;
          }
          
          return !shouldRemove;
        }
        return true;
      });

      // Save only if holdings were actually removed
      if (portfolio.holdings.length < originalHoldingsCount) {
        await portfolio.save();
        logger.info(`📊 Cleaned ${originalHoldingsCount - portfolio.holdings.length} sold stocks from portfolio ${portfolio.name}`);
      }
    }

    logger.info(`✅ Sold stocks cleanup completed. Total stocks removed: ${totalCleaned}`);
    return { success: true, totalCleaned };

  } catch (error) {
    logger.error(`Sold stocks cleanup failed: ${error.message}`);
    throw error;
  }
};