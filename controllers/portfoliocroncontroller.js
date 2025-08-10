const cron = require('node-cron');
const winston = require('winston');
const portfolioService = require('../services/portfolioservice');
const emailService = require('../services/emailServices');
const { runPriceUpdate, updateClosingPrices } = require('../utils/cornscheduler');
const config = require('../config/config');
const PriceLog = require('../models/PriceLog'); // Import at top level
const modelPortFolio = require('../models/modelPortFolio');
const CRON_SCHEDULE = '45 15 * * *';  // 3:45 PM IST daily

// Production constants
const PRODUCTION_CONFIG = {
  MAX_RETRIES: 3,
  RETRY_DELAY: 30000, // 30 seconds
  TIMEOUT_MS: 300000, // 5 minutes timeout for valuation
  CIRCUIT_BREAKER_THRESHOLD: 5, // Fail after 5 consecutive errors
  HEALTH_CHECK_INTERVAL: 60000 // 1 minute
};

// Circuit breaker state
let circuitBreakerState = {
  consecutiveFailures: 0,
  lastFailureTime: null,
  isOpen: false
};

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

// Circuit breaker functions
const resetCircuitBreaker = () => {
  circuitBreakerState.consecutiveFailures = 0;
  circuitBreakerState.lastFailureTime = null;
  circuitBreakerState.isOpen = false;
  logger.info('🔧 Circuit breaker reset');
};

const recordFailure = () => {
  circuitBreakerState.consecutiveFailures++;
  circuitBreakerState.lastFailureTime = new Date();
  
  if (circuitBreakerState.consecutiveFailures >= PRODUCTION_CONFIG.CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreakerState.isOpen = true;
    logger.error(`⚡ Circuit breaker OPENED after ${PRODUCTION_CONFIG.CIRCUIT_BREAKER_THRESHOLD} consecutive failures`);
  }
};

const isCircuitBreakerOpen = () => {
  if (!circuitBreakerState.isOpen) return false;
  
  // Auto-reset circuit breaker after 10 minutes
  const timeSinceLastFailure = Date.now() - circuitBreakerState.lastFailureTime;
  if (timeSinceLastFailure > 600000) { // 10 minutes
    resetCircuitBreaker();
    return false;
  }
  
  return true;
};

// Timeout wrapper for operations
const withTimeout = (promise, timeoutMs = PRODUCTION_CONFIG.TIMEOUT_MS) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
};

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

// Cron job scheduler with enhanced error handling and retry logic
exports.initScheduledJobs = () => {
  // Schedule at 3:45 PM IST
  cron.schedule(CRON_SCHEDULE, async () => {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 30000; // 30 seconds between retries
    const now = new Date();
    
    logger.info(`⌚ Daily portfolio valuation started at ${now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        logger.info(`🔄 Attempt ${attempt}/${MAX_RETRIES} for daily portfolio valuation`);
        
        // Use the robust runDailyValuation function
        const result = await runDailyValuation('Scheduled', true); // Use closing prices for daily run
        
        if (result.success) {
          logger.info(`✅ Daily portfolio valuation completed successfully on attempt ${attempt}`);
          
          // Log summary
          const portfolioResults = result.portfolioResults || [];
          const successCount = portfolioResults.filter(r => r.status === 'success').length;
          const failedCount = portfolioResults.filter(r => r.status === 'failed').length;
          
          logger.info(`📊 Summary: ${successCount} successful, ${failedCount} failed out of ${portfolioResults.length} portfolios`);
          
          // Send failure report if there are failures
          if (failedCount > 0) {
            await sendFailureReport(portfolioResults);
          }
          
          break; // Success, exit retry loop
        } else {
          throw new Error(result.error || 'Unknown error in daily valuation');
        }
        
      } catch (error) {
        logger.error(`💥 Attempt ${attempt} failed: ${error.message}`);
        
        if (attempt < MAX_RETRIES) {
          logger.info(`⌛ Retrying in ${RETRY_DELAY / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        } else {
          // All retries exhausted
          logger.error(`🔥 CRITICAL: Daily portfolio valuation FAILED after ${MAX_RETRIES} attempts`);
          
          // Send critical failure alert
          try {
            await sendCriticalAlert(error);
          } catch (alertError) {
            logger.error(`� Failed to send critical alert: ${alertError.message}`);
          }
        }
      }
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata' // Force IST timezone
  });
  
  logger.info(`📅 Scheduled daily portfolio valuation at ${CRON_SCHEDULE} IST`);
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