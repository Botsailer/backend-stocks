const cron = require('node-cron');
const winston = require('winston');
const stockSymbolController = require('./stocksymbolcontroller');
const portfolioService = require('../services/portfolioservice');
const emailService = require('../services/emailServices');
const { runPriceUpdate, updateClosingPrices } = require('../utils/cornscheduler');
const config = require('../config/config');

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
      maxsize: 5 * 1024 * 1024,
      maxFiles: 7
    })
  ]
});

// Initialize cron job
exports.initScheduledJobs = () => {
  logger.info('⏰ Scheduling daily portfolio valuation job at 3:50 PM IST (Indian market close + 5 minutes)');
  
  // Run at 3:50 PM IST
  cron.schedule('50 15 * * *', async () => {
    const jobStart = new Date();
    logger.info(`🚀 Starting daily portfolio valuation at ${jobStart.toISOString()}`);
    
    try {
      // 1. Update stock prices with closing prices
      logger.info('🔄 Updating stock prices with closing prices...');
      await updateClosingPrices();
      
      // 2. Log all portfolio values using closing prices
      logger.info('📝 Logging portfolio values using closing prices...');
      const portfolioResults = await portfolioService.logAllPortfoliosDaily(true);
      
      // Analyze results
      const successCount = portfolioResults.filter(r => r.status === 'success').length;
      const failedCount = portfolioResults.filter(r => r.status === 'failed').length;
      const failedPortfolios = portfolioResults
        .filter(r => r.status === 'failed')
        .map(f => f.portfolio);
      
      logger.info(`✅ Portfolio logging complete: ${successCount} successful, ${failedCount} failed`);
      
      // 3. Send failure report email
      if (failedCount > 0 && config.mail.reportTo) {
        const subject = `Portfolio Valuation Failed for ${failedCount} Portfolio(s)`;
        let html = `<h1>Portfolio Valuation Report</h1>
          <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
          <p><strong>Total Portfolios:</strong> ${successCount + failedCount}</p>
          <p><strong>Successful:</strong> ${successCount}</p>
          <p><strong>Failed:</strong> ${failedCount}</p>`;
        
        if (failedCount > 0) {
          html += `<h2>Failed Portfolios:</h2><ul>`;
          portfolioResults
            .filter(r => r.status === 'failed')
            .forEach(failure => {
              html += `<li><strong>${failure.portfolio}</strong>: ${failure.error}</li>`;
            });
          html += `</ul>`;
        }
        
        await emailService.sendEmail(
          config.mail.reportTo,
          subject,
          html
        );
        logger.info(`📧 Sent failure report to ${config.mail.reportTo}`);
      }
      
      const jobDuration = (new Date() - jobStart) / 1000;
      logger.info(`🏁 Daily valuation completed in ${jobDuration.toFixed(2)} seconds`);
      
    } catch (error) {
      logger.error(`🔥 CRITICAL: Cron job failed: ${error.message}\n${error.stack}`);
      
      // Send critical failure email
      if (config.mail.reportTo) {
        const subject = 'CRITICAL: Portfolio Valuation Job Failed';
        const html = `<h1>Portfolio Valuation Job Failed</h1>
          <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
          <p><strong>Error:</strong> ${error.message}</p>
          <pre>${error.stack}</pre>`;
        
        emailService.sendEmail(
          config.mail.reportTo,
          subject,
          html
        ).catch(emailErr => {
          logger.error('Failed to send critical failure email:', emailErr);
        });
      }
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });
};

// Manual trigger with retry logic
exports.triggerDailyValuation = async (useClosingPrices = true) => {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 5000; // 5 seconds
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const jobStart = new Date();
      logger.info(`🔔 MANUAL TRIGGER (Attempt ${attempt}/${MAX_RETRIES}): Starting daily valuation`);
      
      // 1. Update stock prices
      if (useClosingPrices) {
        logger.info('🔄 Updating stock prices with closing prices...');
        await updateClosingPrices();
      } else {
        logger.info('🔄 Updating stock prices with regular prices...');
        await runPriceUpdate('Manual', 'regular');
      }
      
      // 2. Log portfolio values
      logger.info('📝 Logging portfolio values...');
      const portfolioResults = await portfolioService.logAllPortfoliosDaily(useClosingPrices);
      
      // Log results
      portfolioResults
        .filter(r => r.status === 'success')
        .forEach(success => {
          logger.info(`✅ Portfolio "${success.portfolio}" valued at ${success.value}`);
        });
      
      portfolioResults
        .filter(r => r.status === 'failed')
        .forEach(failure => {
          logger.error(`❌ Portfolio "${failure.portfolio}" failed: ${failure.error}`);
        });
      
      logger.info(`🏁 Manual valuation completed in ${((new Date() - jobStart) / 1000).toFixed(2)} seconds`);
      return portfolioResults;
      
    } catch (error) {
      logger.error(`🔥 Attempt ${attempt} failed: ${error.message}`);
      
      if (attempt < MAX_RETRIES) {
        logger.info(`⏳ Retrying in ${RETRY_DELAY / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      } else {
        logger.error(`🔥 MANUAL TRIGGER FAILED after ${MAX_RETRIES} attempts`);
        throw error;
      }
    }
  }
};