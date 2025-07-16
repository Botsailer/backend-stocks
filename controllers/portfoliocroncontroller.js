// controllers/cronController.js
const cron = require('node-cron');
const winston = require('winston');
const stockSymbolController = require('./stocksymbolcontroller');
const portfolioService = require('../services/portfolioservice');

// Create logger instance
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
        winston.format.printf(({ timestamp, level, message, stack }) => {
          return `${timestamp} [${level}]: ${message}${stack ? `\n${stack}` : ''}`;
        })
      )
    }),
    new winston.transports.File({ 
      filename: 'logs/cron.log',
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 7 // Keep 7 days of logs
    })
  ]
});

// Initialize cron job
exports.initScheduledJobs = () => {
  logger.info('⏰ Scheduling daily portfolio valuation job at 10:20 UTC (3:50 PM IST)');
  
  // Run at 3:50 PM IST (10:20 UTC)
  cron.schedule('20 10 * * *', async () => {
    const jobStart = new Date();
    logger.info(`🚀 Starting daily portfolio valuation at ${jobStart.toISOString()}`);
    
    try {
      // 1. Update all stock prices first
      logger.info('🔄 Updating stock prices...');
      const stockUpdateResult = await stockSymbolController.updateStockPrices({}, {
        json: (data) => logger.info(
          `📊 Stocks updated: ${data.updated} success, ${data.failed} failed` + 
          (data.failed > 0 ? ` | Failed: ${data.failedSymbols.join(', ')}` : '')
        )
      });
      
      // 2. Log all portfolio values
      logger.info('📝 Logging portfolio values...');
      const portfolioResults = await portfolioService.logAllPortfoliosDaily();
      
      // Analyze results
      const successCount = portfolioResults.filter(r => r.status === 'success').length;
      const failedCount = portfolioResults.filter(r => r.status === 'failed').length;
      
      logger.info(`✅ Portfolio logging complete: ${successCount} successful, ${failedCount} failed`);
      
      // Log detailed failures
      portfolioResults
        .filter(r => r.status === 'failed')
        .forEach(failure => {
          logger.error(`❌ Failed portfolio "${failure.portfolio}": ${failure.error}`);
        });
      
      // 3. Send notifications (optional)
      if (failedCount > 0) {
        logger.warn(`📢 ${failedCount} portfolio(s) failed valuation. Notifications would be sent here.`);
      }
      
      const jobDuration = (new Date() - jobStart) / 1000;
      logger.info(`🏁 Daily valuation completed in ${jobDuration.toFixed(2)} seconds`);
      
    } catch (error) {
      logger.error(`🔥 CRITICAL: Cron job failed: ${error.message}\n${error.stack}`);
      // Implement emergency notification
      // sendAlert(`Portfolio valuation failed: ${error.message}`);
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });
};

// Manual trigger for testing
exports.triggerDailyValuation = async () => {
  const jobStart = new Date();
  logger.info('🔔 MANUAL TRIGGER: Starting daily valuation');
  
  try {
    // 1. Update stock prices
    logger.info('🔄 Updating stock prices (manual)...');
    const stockUpdateResult = await stockSymbolController.updateStockPrices({}, {
      json: (data) => logger.info(
        `📊 Stocks updated: ${data.updated} success, ${data.failed} failed` + 
        (data.failed > 0 ? ` | Failed: ${data.failedSymbols.join(', ')}` : '')
      )
    });
    
    // 2. Log portfolio values
    logger.info('📝 Logging portfolio values (manual)...');
    const portfolioResults = await portfolioService.logAllPortfoliosDaily();
    

portfolioResults
  .filter(r => r.status === 'success')
  .forEach(success => {
    logger.info(`✅ Portfolio "${success.portfolio}" valued at ${success.value}`);
  });
    return portfolioResults;
  } catch (error) {
    logger.error(`🔥 MANUAL TRIGGER FAILED: ${error.message}\n${error.stack}`);
    throw error;
  }
};