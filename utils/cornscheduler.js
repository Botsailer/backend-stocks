const cron = require('node-cron');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const emailService = require('../services/emailServices');
const config = require('../config/config'); // Make sure this is properly configured

// Import models
const StockSymbol = require('../models/stockSymbol');
const { getFmpApiKeys } = require('./configSettings');
const axios = require('axios');
const winston = require('winston');

// Configure logging
const LOGS_DIR = path.resolve(__dirname, '../logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/cornscheduler.log' })
    ]
});

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
    try {
      if (!this.client) {
        CronLogger.info('Initializing TradingView client...');
        this.client = new TradingViewAPI();
        await this.client.setup();
        CronLogger.success('TradingView client initialized successfully');
      }
      return this;
    } catch (error) {
      CronLogger.error('Failed to initialize TradingView client', error);
      this.client = null;
      throw error;
    }
  }

  async fetchPriceWithRetry(stock) {
    const symbolKey = `${stock.exchange}:${stock.symbol}`;
    let retries = 0;
    
    while (retries < this.maxRetries) {
      try {
        // Ensure client is initialized before each request in cron context
        if (!this.client) {
          CronLogger.info(`Reinitializing TradingView client for ${symbolKey}`);
          await this.initialize();
        }
        
        const ticker = await this.client.getTicker(symbolKey);
        
        // Add safety check for ticker and fetch method
        if (!ticker) {
          throw new Error(`No ticker returned for ${symbolKey}`);
        }
        
        if (typeof ticker.fetch !== 'function') {
          throw new Error(`ticker.fetch is not a function for ${symbolKey}`);
        }
        
        const data = await ticker.fetch();
        if (data && data.lp) {
          return {
            price: data.lp.toString(),
            error: null
          };
        } else {
          throw new Error(`No price data (lp) found for ${symbolKey}`);
        }
      } catch (error) {
        CronLogger.error(`Attempt ${retries + 1} failed for ${symbolKey}: ${error.message}`);
        
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

      // Reinitialize TradingView service for each cron run
      CronLogger.info('Reinitializing TradingView service for cron execution...');
      this.tvService = new TradingViewService();
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

// New function for robustly updating closing prices
async function updateClosingPrices() {
  const jobName = 'Daily Closing Price';
  CronLogger.info(`🚀 Starting ${jobName} update`);
  const start = Date.now();
  
  try {
    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database connection not ready');
    }

    const tvService = new TradingViewService();
    await tvService.initialize();
    CronLogger.info('TradingView service initialized for closing price update');

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    // First, dynamically determine which symbols are used as benchmarks in portfolios
    const Portfolio = require('../models/modelPortFolio');
    const portfolios = await Portfolio.find({ compareWith: { $exists: true, $ne: "" } })
                                    .select('compareWith');
    
    // Extract benchmark symbols or IDs
    const benchmarks = portfolios.map(p => p.compareWith);
    const benchmarkSymbols = [];
    const benchmarkIds = [];
    
    // Separate IDs from symbols
    benchmarks.forEach(benchmark => {
      if (/^[0-9a-fA-F]{24}$/.test(benchmark)) {
        benchmarkIds.push(mongoose.Types.ObjectId(benchmark));
      } else {
        benchmarkSymbols.push(benchmark);
      }
    });
    
    CronLogger.info(`Found ${benchmarks.length} unique benchmarks used in portfolios`);
    
    // First, get all benchmark stocks by either ID or symbol
    const idCriteria = benchmarkIds.length > 0 ? { _id: { $in: benchmarkIds } } : null;
    const symbolCriteria = benchmarkSymbols.length > 0 ? { symbol: { $in: benchmarkSymbols } } : null;
    
    let marketIndicesCriteria = { isActive: true };
    if (idCriteria && symbolCriteria) {
      marketIndicesCriteria.$or = [idCriteria, symbolCriteria];
    } else if (idCriteria) {
      marketIndicesCriteria = { ...marketIndicesCriteria, ...idCriteria };
    } else if (symbolCriteria) {
      marketIndicesCriteria = { ...marketIndicesCriteria, ...symbolCriteria };
    }
    
    const marketIndices = await StockSymbol.find(marketIndicesCriteria, '_id symbol exchange currentPrice');
    
    // Extract the IDs and symbols of the benchmark stocks we found
    const marketIndiceIds = marketIndices.map(index => index._id.toString());
    const marketIndiceSymbols = marketIndices.map(index => index.symbol);
    
    CronLogger.info(`Found ${marketIndices.length} benchmark stocks: ${marketIndiceSymbols.join(', ')}`);
    
    // Then get all other stocks that need updating (excluding the benchmarks we just fetched)
    const regularStocks = await StockSymbol.find({
      isActive: true,
      _id: { $nin: marketIndiceIds },
      $or: [
        { closingPriceUpdatedAt: { $lt: today } },
        { closingPriceUpdatedAt: { $exists: false } }
      ]
    }, '_id symbol exchange currentPrice');

    // Combine, placing indices first
    const stocksToUpdate = [...marketIndices, ...regularStocks];

    if (!stocksToUpdate.length) {
      CronLogger.info('All stock closing prices are already up-to-date for today.');
      tvService.cleanup();
      return {
        success: true,
        message: 'All stock closing prices are already up-to-date.',
        total: 0,
        updatedCount: 0,
        failed: []
      };
    }

    CronLogger.info(`Found ${stocksToUpdate.length} stocks needing closing price update.`);

    let updatedCount = 0;
    const failedUpdates = [];
    const updateQueue = [];

    const batchCount = Math.ceil(stocksToUpdate.length / tvService.batchSize);

    for (let i = 0; i < batchCount; i++) {
        const startIdx = i * tvService.batchSize;
        const endIdx = Math.min(startIdx + tvService.batchSize, stocksToUpdate.length);
        const batch = stocksToUpdate.slice(startIdx, endIdx);

        CronLogger.info(`Processing batch ${i+1}/${batchCount} with ${batch.length} stocks`);
        
        const batchResults = await tvService.fetchBatchPrices(batch);

        for (const result of batchResults) {
            const { stock, price, error } = result;

            if (price) {
                updateQueue.push({
                    updateOne: {
                        filter: { _id: stock._id },
                        update: {
                            $set: {
                                todayClosingPrice: price,
                                closingPriceUpdatedAt: new Date(),
                                lastUpdated: new Date()
                            }
                        }
                    }
                });
                updatedCount++;
            } else {
                CronLogger.error(`Failed to fetch closing price for ${stock.symbol}: ${error}`);
                failedUpdates.push({
                    symbol: stock.symbol,
                    exchange: stock.exchange,
                    error
                });
            }
        }
        
        if (i < batchCount - 1) {
            await new Promise(r => setTimeout(r, tvService.batchDelay));
        }
    }

    if (updateQueue.length > 0) {
        CronLogger.info(`Writing ${updateQueue.length} closing price updates to database...`);
        await StockSymbol.bulkWrite(updateQueue);
    }

    const result = {
        success: true,
        total: stocksToUpdate.length,
        updatedCount,
        failed: failedUpdates,
        message: `Processed ${stocksToUpdate.length} symbols (${updatedCount} updated)`,
        duration: Date.now() - start
    };
    
    CronLogger.success(`✅ ${jobName} update completed: ${result.message} (${result.duration}ms)`);

    if (failedUpdates.length > 0) {
        CronLogger.error(`${jobName} update had ${failedUpdates.length} failures`);
    }

    tvService.cleanup();
    return result;

  } catch (error) {
    CronLogger.error(`❌ ${jobName} update crashed`, error);
    return {
        success: false,
        message: 'Update failed',
        error: error.message,
        duration: Date.now() - start
    };
  }
}

// Cron job wrapper with error handling and logging
async function runPriceUpdate(jobName, updateType = 'regular') {
  CronLogger.info(`🚀 Starting ${jobName} stock price update (${updateType})`);
  
  try {
    // Check if database is connected
    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database connection not ready');
    }

    // Create a fresh PriceUpdater instance for each cron run
    const cronPriceUpdater = new PriceUpdater();
    const result = await cronPriceUpdater.executeUpdate(updateType);
    
    if (result.success) {
      CronLogger.success(`✅ ${jobName} update completed: ${result.message} (${result.duration}ms)`);
      
      // Log detailed results
      if (result.failed.length > 0) {
        CronLogger.error(`${jobName} update had ${result.failed.length} failures:`);
        result.failed.forEach(failure => {
          CronLogger.error(`  - ${failure.symbol} (${failure.exchange}): ${failure.error}`);
        });
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
    this.scheduledJobs = {};
  }

  // Initialize all cron jobs
  initialize() {
    try {
      // Morning update - 8:00 AM IST
      const morningJob = cron.schedule('30 2 * * *', () => {
        runPriceUpdate('Morning', 'regular');
      }, {
        scheduled: false,
        timezone: "Asia/Kolkata"
      });

      // Hourly job for regular updates
      const hourlyJob = cron.schedule('0 * * * *', () => {
        runPriceUpdate('Hourly', 'regular');
      }, {
        scheduled: false,
        timezone: "Asia/Kolkata"
      });

      // Afternoon update - 2:00 PM IST
      const afternoonJob = cron.schedule('0 14 * * *', () => {
        runPriceUpdate('Afternoon', 'regular');
      }, {
        scheduled: false,
        timezone: "Asia/Kolkata"
      });

      // Closing price update - 3:45 PM IST (Indian market close time)
      const closingJob = cron.schedule('45 15 * * *', () => {
        updateClosingPrices();
      }, {
        scheduled: false,
        timezone: "Asia/Kolkata"
      });

      this.jobs = [
        { name: 'Hourly Update', job: hourlyJob, type: 'hourly' },
        { name: 'Morning Update', job: morningJob, type: 'morning' },
        { name: 'Afternoon Update', job: afternoonJob, type: 'afternoon' },
        { name: 'Closing Price Update', job: closingJob, type: 'closing' }
      ];

      CronLogger.info('📅 Cron scheduler initialized with 4 jobs');
    } catch (error) {
      CronLogger.error('Failed to initialize cron scheduler', error);
      throw error; // Re-throw to allow caller to handle
    }
  }

  start() {
    try {
      // If jobs array is empty, initialize first
      if (this.jobs.length === 0) {
        this.initialize();
      }

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
      throw error;
    }
  }

  stop() {
    try {
      this.jobs.forEach(({ name, job }) => {
        job.stop();
        CronLogger.info(`🔴 Stopped: ${name}`);
      });
      CronLogger.info('🛑 All cron jobs stopped');

      // Also clear any scheduled jobs
      for (const job of Object.values(this.scheduledJobs)) {
        job.stop();
      }
      this.scheduledJobs = {};
    } catch (error) {
      CronLogger.error('Failed to stop cron jobs', error);
    }
  }

  scheduleDailyClosingPriceUpdate() {
    const jobName = 'Daily Closing Price Update';
    
    // Remove existing job if it exists
    if (this.scheduledJobs[jobName]) {
      this.scheduledJobs[jobName].stop();
      CronLogger.info(`Stopped existing job: ${jobName}`);
    }

    // Schedule new job
    const job = cron.schedule('45 15 * * *', async () => {
      await updateClosingPrices();
    }, {
      timezone: 'Asia/Kolkata',
      scheduled: true
    });

    this.scheduledJobs[jobName] = job;
    CronLogger.info(`Scheduled new job: ${jobName} (Daily at 3:45 PM IST - Indian market close time)`);
  }

  scheduleRegularPriceUpdates() {
    const jobName = 'Regular Price Update';
    
    // Remove existing job if it exists
    if (this.scheduledJobs[jobName]) {
      this.scheduledJobs[jobName].stop();
      CronLogger.info(`Stopped existing job: ${jobName}`);
    }

    // Schedule new job
    const job = cron.schedule('*/5 * * * *', async () => {
      await runPriceUpdate(jobName, 'regular');
    }, {
      timezone: 'Asia/Kolkata',
      scheduled: true
    });

    this.scheduledJobs[jobName] = job;
    CronLogger.info(`Scheduled new job: ${jobName} (Every 5 minutes)`);
  }

  // Get status of all jobs
  getStatus() {
    const status = this.jobs.map(({ name, job, type }) => ({
      name,
      type,
      running: job.running || false
    }));

    // Add scheduled jobs
    for (const [name, job] of Object.entries(this.scheduledJobs)) {
      status.push({
        name,
        type: 'scheduled',
        running: job.running || false
      });
    }

    return status;
  }

  // Manual trigger for testing
  async triggerManualUpdate(updateType = 'regular') {
    CronLogger.info(`🔧 Manual ${updateType} update triggered`);
    if (updateType === 'closing') {
      await updateClosingPrices();
    } else {
      await runPriceUpdate('Manual', updateType);
    }
  }
}

// Export the scheduler class and other utilities
module.exports = {
  CronScheduler,
  CronLogger,
  PriceUpdater,
  runPriceUpdate,
  updateClosingPrices
};