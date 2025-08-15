// NOTE: Scheduling logic migrated to utils/cornscheduler.js (runClosingSequence + CronScheduler)
// This controller now only exposes manual / on-demand valuation helpers.
// (Previous internal cron at 3:45 PM removed to avoid duplicate runs.)
const cron = require('node-cron');
const winston = require('winston');
const portfolioService = require('../services/portfolioservice');
const emailService = require('../services/emailServices');
const { runPriceUpdate, updateClosingPrices } = require('../utils/cornscheduler');
const config = require('../config/config');
const PriceLog = require('../models/PriceLog'); // Import at top level
const modelPortFolio = require('../models/modelPortFolio');
const CRON_SCHEDULE = '45 15 * * *';  // 3:45 PM IST daily
// Enhanced logger configuration
const logger = winston.createLogger({
  level: config.env === 'development' ? 'debug' : 'info',
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
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 14 // Keep 2 weeks of logs
    })
  ]
});

// Centralized daily valuation runner
const runDailyValuation = async (triggerType = 'Scheduled', useClosingPrices = true) => {
  const jobStart = new Date();
  logger.info(`🚀 ${triggerType} run started at ${jobStart.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  
  try {
    // 1. Update stock prices
    const priceUpdateType = useClosingPrices ? 'closing' : 'regular';
    logger.info(`🔄 Updating stock prices (${priceUpdateType})...`);
    
    if (useClosingPrices) {
      await updateClosingPrices();
    } else {
      await runPriceUpdate(triggerType, 'regular');
    }

    // 2. Log portfolio values
    logger.info('📝 Logging portfolio values...');
    const portfolioResults = await portfolioService.logAllPortfoliosDaily(useClosingPrices);
    
    // 3. Cleanup duplicates
    logger.info('🧹 Running duplicate cleanup...');
    const cleanupResults = await PriceLog.cleanupDuplicates();
    
    // 4. Analyze results
    const successCount = portfolioResults.filter(r => r.status === 'success').length;
    const failedCount = portfolioResults.filter(r => r.status === 'failed').length;
    const jobDurationSec = ((new Date() - jobStart) / 1000).toFixed(2);
    
    logger.info(`📊 Results: ${successCount} successful, ${failedCount} failed`);
    logger.info(`🏁 ${triggerType} run completed in ${jobDurationSec} seconds`);
    
    return {
      success: true,
      portfolioResults,
      cleanupResults,
      duration: jobDurationSec,
      startTime: jobStart,
      endTime: new Date()
    };
    
  } catch (error) {
    const errorDuration = ((new Date() - jobStart) / 1000).toFixed(2);
    logger.error(`🔥 ${triggerType} run FAILED after ${errorDuration}s: ${error.message}`);
    return {
      success: false,
      error: error.message,
      duration: errorDuration
    };
  }
};

// Email notification functions
const sendFailureReport = async (portfolioResults) => {
  const failedResults = portfolioResults.filter(r => r.status === 'failed');
  
  if (!failedResults.length || !config.mail.reportTo) return;
  
  const subject = `Portfolio Valuation Failed for ${failedResults.length} Portfolio(s)`;
  let html = `<h1>Portfolio Valuation Report</h1>
    <p><strong>Date:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST)</p>
    <p><strong>Total Portfolios:</strong> ${portfolioResults.length}</p>
    <p><strong>Successful:</strong> ${portfolioResults.length - failedResults.length}</p>
    <p><strong>Failed:</strong> ${failedResults.length}</p>`;
  
  html += `<h2>Failed Portfolios:</h2><ul>`;
  failedResults.forEach(failure => {
    html += `<li><strong>${failure.portfolio}</strong>: ${failure.error}</li>`;
  });
  html += `</ul>`;
  
  await emailService.sendEmail(config.mail.reportTo, subject, html);
  logger.info(`📧 Sent failure report to ${config.mail.reportTo}`);
};

const sendCriticalAlert = async (error) => {
  if (!config.mail.reportTo) return;
  
  const subject = 'CRITICAL: Portfolio Valuation Job Failed';
  const html = `<h1>Portfolio Valuation Job Failed</h1>
    <p><strong>Time:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST)</p>
    <p><strong>Error:</strong> ${error.message}</p>
    <pre>${error.stack}</pre>`;
  
  await emailService.sendEmail(config.mail.reportTo, subject, html);
  logger.info('📧 Sent critical alert');
};

// Deprecated: initScheduledJobs (left as no-op for backward compatibility)
exports.initScheduledJobs = () => {
  logger.warn('initScheduledJobs deprecated: scheduling handled by CronScheduler in utils/cornscheduler.js');
};

// Manual trigger with enhanced retry
exports.triggerDailyValuation = async (useClosingPrices = true) => {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 5000; // 5 seconds
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info(`🔔 MANUAL TRIGGER (Attempt ${attempt}/${MAX_RETRIES})`);
      const result = await runDailyValuation('Manual', useClosingPrices);
      
      if (!result.success) throw new Error(result.error);
      
      // Log individual results
      if (result.portfolioResults) {
        result.portfolioResults.forEach(res => {
          if (res.status === 'success') {
            logger.info(`✅ ${res.portfolio}: ₹${res.value.toFixed(2)}`);
          } else {
            logger.error(`❌ ${res.portfolio}: ${res.error}`);
          }
        });
      }
      
      return result;
      
    } catch (error) {
      logger.error(`Attempt ${attempt} failed: ${error.message}`);
      
      if (attempt < MAX_RETRIES) {
        logger.info(`⌛ Retrying in ${RETRY_DELAY / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      } else {
        logger.error(`🔥 MANUAL TRIGGER FAILED after ${MAX_RETRIES} attempts`);
        throw error;
      }
    }
  }
};