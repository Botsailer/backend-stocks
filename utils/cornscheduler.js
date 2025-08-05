// utils/cron-scheduler.js
const cron = require('node-cron');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Import your stock symbol model
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
  }

  async initialize() {
    if (!this.client) {
      this.client = new TradingViewAPI();
      await this.client.setup();
    }
    return this;
  }

  async fetchBatchPrices(symbols) {
    const results = [];
    
    for (const stock of symbols) {
      const symbolKey = `${stock.exchange}:${stock.symbol}`;
      try {
        const ticker = await this.client.getTicker(symbolKey);
        const data = await ticker.fetch();
        results.push({
          stock,
          price: data.lp ? data.lp.toString() : null,
          error: data.lp ? null : 'No price data'
        });
      } catch (error) {
        results.push({
          stock,
          price: null,
          error: error.message || 'API error'
        });
      }
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

  async executeUpdate() {
    const start = Date.now();
    let updateQueue = [];
    
    try {
      // Check database connection
      if (mongoose.connection.readyState !== 1) {
        throw new Error('Database not connected');
      }

      await this.tvService.initialize();
      const stocks = await StockSymbol.find({}, '_id symbol exchange currentPrice');
      
      if (!stocks.length) {
        return {
          success: false,
          message: 'No stocks found',
          total: 0,
          updatedCount: 0,
          failed: []
        };
      }

      const batchCount = Math.ceil(stocks.length / this.tvService.batchSize);
      let updatedCount = 0;
      const failedUpdates = [];

      for (let i = 0; i < batchCount; i++) {
        const startIdx = i * this.tvService.batchSize;
        const endIdx = Math.min(startIdx + this.tvService.batchSize, stocks.length);
        const batch = stocks.slice(startIdx, endIdx);

        const batchResults = await this.tvService.fetchBatchPrices(batch);
        
        // Fixed: batchResults instead of batch Results
        for (const result of batchResults) {
          const { stock, price, error } = result;
          
          if (price && price !== stock.currentPrice) {
            updateQueue.push({
              updateOne: {
                filter: { _id: stock._id },
                update: {
                  $set: {
                    currentPrice: price,
                    previousPrice: stock.currentPrice,
                    lastUpdated: new Date()
                  }
                }
              }
            });
            updatedCount++;
          } else if (error) {
            failedUpdates.push({
              symbol: stock.symbol,
              exchange: stock.exchange,
              error
            });
          }
        }

        // Process batch updates if queue has items
        if (updateQueue.length > 0) {
          await StockSymbol.bulkWrite(updateQueue);
          updateQueue = []; // Reset queue
        }

        // Add delay between batches except last one
        if (i < batchCount - 1) {
          await new Promise(r => setTimeout(r, this.tvService.batchDelay));
        }
      }

      const result = {
        success: true,
        total: stocks.length,
        updatedCount,
        failed: failedUpdates,
        message: `Updated ${updatedCount}/${stocks.length} symbols`,
        duration: Date.now() - start
      };

      return result;

    } catch (error) {
      return {
        success: false,
        message: 'Update failed',
        error: error.message,
        total: 0,
        updatedCount: 0,
        failed: [],
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
async function runPriceUpdate(jobName) {
  CronLogger.info(`🚀 Starting ${jobName} stock price update`);
  
  try {
    // Check if database is connected
    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database connection not ready');
    }

    const result = await priceUpdater.executeUpdate();
    
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
        runPriceUpdate('Morning (8:00 AM IST)');
      }, {
        scheduled: false,
        timezone: "UTC"
      });

      // Afternoon update - 3:00 PM IST (9:30 AM UTC) - FIXED TIME
      const afternoonJob = cron.schedule('30 9 * * *', () => {
        runPriceUpdate('Afternoon (3:00 PM IST)');
      }, {
        scheduled: false,
        timezone: "UTC"
      });

      // Optional: Evening update - 8:00 PM IST (2:30 PM UTC)
      const eveningJob = cron.schedule('30 14 * * *', () => {
        runPriceUpdate('Evening (8:00 PM IST)');
      }, {
        scheduled: false,
        timezone: "UTC"
      });

      this.jobs = [
        { name: 'Morning Update', job: morningJob },
        { name: 'Afternoon Update', job: afternoonJob },
        { name: 'Evening Update', job: eveningJob }
      ];

      CronLogger.info('📅 Cron scheduler initialized with 3 jobs');
      
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
    return this.jobs.map(({ name, job }) => ({
      name,
      running: job.running || false
    }));
  }

  // Manual trigger for testing
  async triggerManualUpdate() {
    CronLogger.info('🔧 Manual update triggered');
    await runPriceUpdate('Manual');
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