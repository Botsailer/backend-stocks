const cron = require('node-cron');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const emailService = require('../services/emailServices');
const config = require('../config/config'); // Make sure this is properly configured

// Import models
const StockSymbol = require('../models/stockSymbol');

// Configure logging
const LOGS_DIR = path.resolve(__dirname, '../logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Enhanced logging utility
class CronLogger {
  static log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [CRON-${type}] ${message}`;
    console.log(logMessage);
    
    // Write to daily log file
    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(LOGS_DIR, `cron-${date}.log`);
    fs.appendFileSync(logFile, logMessage + '\n');
  }

  static error(message, error = null) {
    const errorMessage = error ? `${message}: ${error.message}` : message;
    this.log(errorMessage, 'ERROR');
    
    // Send email for critical errors
    if (config.mail && config.mail.reportTo) {
      const subject = `CRON Error: ${message.substring(0, 50)}...`;
      let content = `<p><strong>Time:</strong> ${new Date().toLocaleString()}</p>`;
      content += `<p><strong>Message:</strong> ${message}</p>`;
      
      if (error) {
        content += `<p><strong>Error:</strong> ${error.message}</p>`;
        content += `<pre>${error.stack}</pre>`;
      }
      
      emailService.sendEmail(
        config.mail.reportTo,
        subject,
        content
      ).catch(err => {
        console.error('Failed to send error email:', err);
      });
    }
  }

  static info(message) {
    this.log(message, 'INFO');
  }

  static success(message) {
    this.log(message, 'SUCCESS');
  }
}

// TradingView service class
const { TradingViewAPI } = require("tradingview-scraper");

class TradingViewService {
  constructor() {
    this.client = null;
    this.batchSize = 50;
    this.batchDelay = 1500;
    this.maxRetries = 3;
    this.retryDelay = 2000;
  }

  async initialize() {
    if (!this.client) {
      this.client = new TradingViewAPI();
      await this.client.setup();
    }
    return this;
  }

  async fetchPriceWithRetry(stock) {
    const symbolKey = `${stock.exchange}:${stock.symbol}`;
    let retries = 0;
    
    while (retries < this.maxRetries) {
      try {
        const ticker = await this.client.getTicker(symbolKey);
        const data = await ticker.fetch();
        if (data.lp) {
          return {
            price: data.lp.toString(),
            error: null
          };
        }
      } catch (error) {
        if (retries === this.maxRetries - 1) {
          return {
            price: null,
            error: error.message || 'API error'
          };
        }
      }
      
      retries++;
      await new Promise(r => setTimeout(r, this.retryDelay));
    }
    
    return {
      price: null,
      error: 'Max retries reached'
    };
  }

  async fetchBatchPrices(symbols) {
    const results = [];
    
    for (const stock of symbols) {
      const { price, error } = await this.fetchPriceWithRetry(stock);
      results.push({
        stock,
        price,
        error
      });
    }
    return results;
  }

  cleanup() {
    this.client = null;
  }
}

class PriceUpdater {
  constructor() {
    this.tvService = new TradingViewService();
  }

  async executeUpdate(updateType = 'regular') {
    const start = Date.now();
    let updateQueue = [];
    
    try {
      // Check database connection
      if (mongoose.connection.readyState !== 1) {
        throw new Error('Database not connected');
      }

      await this.tvService.initialize();
      const stocks = await StockSymbol.find({ isActive: true }, '_id symbol exchange currentPrice todayClosingPrice');
      
      if (!stocks.length) {
        CronLogger.info('No active stocks found for update');
        return {
          success: false,
          message: 'No active stocks found',
          total: 0,
          updatedCount: 0,
          failed: []
        };
      }

      CronLogger.info(`Found ${stocks.length} stocks to update (${updateType})`);
      
      const batchCount = Math.ceil(stocks.length / this.tvService.batchSize);
      let updatedCount = 0;
      const failedUpdates = [];

      for (let i = 0; i < batchCount; i++) {
        const startIdx = i * this.tvService.batchSize;
        const endIdx = Math.min(startIdx + this.tvService.batchSize, stocks.length);
        const batch = stocks.slice(startIdx, endIdx);

        CronLogger.info(`Processing batch ${i+1}/${batchCount} with ${batch.length} stocks`);
        
        const batchResults = await this.tvService.fetchBatchPrices(batch);
        
        for (const result of batchResults) {
          const { stock, price, error } = result;
          
          if (price) {
            const update = {
              $set: {
                lastUpdated: new Date()
              }
            };

            // Update prices only if they changed
            if (price !== stock.currentPrice) {
              update.$set.currentPrice = price;
              update.$set.previousPrice = stock.currentPrice;
              CronLogger.info(`Price changed for ${stock.symbol}: ${stock.currentPrice} → ${price}`);
            }

            // Always set todayClosingPrice for closing updates
            if (updateType === 'closing') {
              update.$set.todayClosingPrice = price;
              CronLogger.info(`Setting todayClosingPrice for ${stock.symbol}: ${price}`);
            }
            
            // Only push update if we have something to change
            if (Object.keys(update.$set).length > 1) { // More than just lastUpdated
              updateQueue.push({
                updateOne: {
                  filter: { _id: stock._id },
                  update
                }
              });
              updatedCount++;
            }
          } else if (error) {
            CronLogger.error(`Failed to fetch price for ${stock.symbol}: ${error}`);
            failedUpdates.push({
              symbol: stock.symbol,
              exchange: stock.exchange,
              error
            });
          }
        }

        if (updateQueue.length > 0) {
          CronLogger.info(`Writing ${updateQueue.length} updates to database...`);
          await StockSymbol.bulkWrite(updateQueue);
          updateQueue = [];
        }

        if (i < batchCount - 1) {
          await new Promise(r => setTimeout(r, this.tvService.batchDelay));
        }
      }

      const result = {
        success: true,
        total: stocks.length,
        updatedCount,
        failed: failedUpdates,
        message: `Processed ${stocks.length} symbols (${updatedCount} updated)`,
        updateType,
        duration: Date.now() - start
      };

      // Log results and send email if needed
      if (result.failed.length > 0 && config.mail && config.mail.reportTo) {
        const failureRate = (result.failed.length / result.total * 100).toFixed(2);
        const subject = `Stock Price Update Report (${updateType}) - ${failureRate}% Failed`;
        
        let htmlContent = `
          <h1>Stock Price Update Report (${updateType})</h1>
          <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
          <p><strong>Duration:</strong> ${result.duration}ms</p>
          <p><strong>Total Symbols:</strong> ${result.total}</p>
          <p><strong>Updated:</strong> ${result.updatedCount}</p>
          <p><strong>Failed:</strong> ${result.failed.length} (${failureRate}%)</p>
        `;
        
        if (result.failed.length > 0) {
          htmlContent += `<h2>Failure Details:</h2><ul>`;
          result.failed.forEach(failure => {
            htmlContent += `<li>${failure.symbol} (${failure.exchange}): ${failure.error}</li>`;
          });
          htmlContent += `</ul>`;
        }
        
        emailService.sendEmail(
          config.mail.reportTo,
          subject,
          htmlContent
        ).catch(err => {
          CronLogger.error('Failed to send update report email', err);
        });
      }

      return result;

    } catch (error) {
      CronLogger.error('Update failed', error);
      return {
        success: false,
        message: 'Update failed',
        error: error.message,
        total: 0,
        updatedCount: 0,
        failed: [],
        updateType,
        duration: Date.now() - start
      };
    } finally {
      this.tvService.cleanup();
    }
  }
}

// Create updater instance
const priceUpdater = new PriceUpdater();

// Cron job wrapper with error handling and logging
async function runPriceUpdate(jobName, updateType = 'regular') {
  CronLogger.info(`🚀 Starting ${jobName} stock price update (${updateType})`);
  
  try {
    // Check if database is connected
    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database connection not ready');
    }

    const result = await priceUpdater.executeUpdate(updateType);
    
    if (result.success) {
      CronLogger.success(`✅ ${jobName} update completed: ${result.message} (${result.duration}ms)`);
      
      // Log detailed results
      if (result.failed.length > 0) {
        CronLogger.error(`${jobName} update had ${result.failed.length} failures`);
      }
      
    } else {
      CronLogger.error(`❌ ${jobName} update failed: ${result.message}`, { message: result.error });
    }
    
  } catch (error) {
    CronLogger.error(`❌ ${jobName} update crashed`, error);
  }
}

// Cron Jobs Configuration
class CronScheduler {
  constructor() {
    this.jobs = [];
  }

  // Initialize all cron jobs
  initialize() {
    try {
      // Morning update - 8:00 AM IST (2:30 AM UTC)
      const morningJob = cron.schedule('30 2 * * *', () => {
        runPriceUpdate('Morning', 'regular');
      }, {
        scheduled: false,
        timezone: "UTC"
      });
const hourlyJob = cron.schedule('0 * * * *', () => {
  runPriceUpdate('Hourly', 'regular');
}, {
  scheduled: false,
  timezone: "UTC"
});
      // Afternoon update - 4:00 PM IST (10:30 AM UTC)
      const afternoonJob = cron.schedule('30 10 * * *', () => {
        runPriceUpdate('Afternoon', 'regular');
      }, {
        scheduled: false,
        timezone: "UTC"
      });

      // Closing price update - 3:45 PM IST (10:15 UTC)
      const closingJob = cron.schedule('15 10 * * *', () => {
        runPriceUpdate('Closing Price', 'closing');
      }, {
        scheduled: false,
        timezone: "UTC"
      });

      this.jobs = [
        {name:'Hourly Update', job: hourlyJob, type: 'hourly'},
        { name: 'Morning Update', job: morningJob, type: 'morning' },
        { name: 'Afternoon Update', job: afternoonJob, type: 'afternoon' },
        { name: 'Closing Price Update', job: closingJob, type: 'closing' }
        
      ];

      CronLogger.info('📅 Cron scheduler initialized with 4 jobs');
      
    } catch (error) {
      CronLogger.error('Failed to initialize cron scheduler', error);
    }
  }

  // Start all cron jobs
  start() {
    try {
      // Wait for database connection before starting cron jobs
      if (mongoose.connection.readyState === 1) {
        this.jobs.forEach(({ name, job }) => {
          job.start();
          CronLogger.info(`🟢 Started: ${name}`);
        });
        CronLogger.success('✅ All cron jobs started successfully');
      } else {
        CronLogger.info('⏳ Waiting for database connection...');
        mongoose.connection.once('connected', () => {
          this.jobs.forEach(({ name, job }) => {
            job.start();
            CronLogger.info(`🟢 Started: ${name}`);
          });
          CronLogger.success('✅ All cron jobs started successfully after DB connection');
        });
      }
    } catch (error) {
      CronLogger.error('Failed to start cron jobs', error);
    }
  }

  // Stop all cron jobs
  stop() {
    try {
      this.jobs.forEach(({ name, job }) => {
        job.stop();
        CronLogger.info(`🔴 Stopped: ${name}`);
      });
      CronLogger.info('🛑 All cron jobs stopped');
    } catch (error) {
      CronLogger.error('Failed to stop cron jobs', error);
    }
  }

  // Get status of all jobs
  getStatus() {
    return this.jobs.map(({ name, job, type }) => ({
      name,
      type,
      running: job.running || false
    }));
  }

  // Manual trigger for testing
  async triggerManualUpdate(updateType = 'regular') {
    CronLogger.info(`🔧 Manual ${updateType} update triggered`);
    await runPriceUpdate('Manual', updateType);
  }
}

// Export the scheduler
const cronScheduler = new CronScheduler();

module.exports = {
  cronScheduler,
  CronLogger,
  PriceUpdater,
  runPriceUpdate
};

// Auto-initialize if this file is run directly
if (require.main === module) {
  cronScheduler.initialize();
  cronScheduler.start();
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    CronLogger.info('Received SIGTERM, stopping cron jobs...');
    cronScheduler.stop();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    CronLogger.info('Received SIGINT, stopping cron jobs...');
    cronScheduler.stop();
    process.exit(0);
  });
}