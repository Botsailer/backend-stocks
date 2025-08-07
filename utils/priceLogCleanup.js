/**
 * utils/priceLogCleanup.js
 * 
 * Utility script to clean up duplicate price log entries and ensure data integrity.
 * This can be run manually to fix any existing issues with duplicate entries.
 */
const mongoose = require('mongoose');
const PriceLog = require('../models/PriceLog');
const config = require('../config/config');
const winston = require('winston');

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
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} [${level}]: ${message}`;
        })
      )
    }),
    new winston.transports.File({ 
      filename: 'logs/price-log-cleanup.log'
    })
  ]
});

/**
 * Connects to the database
 */
async function connectDB() {
  logger.info('Connecting to database...');
  
  try {
    await mongoose.connect(config.db.url, config.db.options);
    logger.info('Database connected successfully');
    return true;
  } catch (error) {
    logger.error(`Database connection failed: ${error.message}`);
    return false;
  }
}

/**
 * Cleans up duplicate price logs by identifying entries with the same portfolio and dateOnly
 */
async function cleanupDuplicatePriceLogs() {
  logger.info('Starting duplicate price log cleanup');
  
  try {
    // Get all portfolios with duplicate entries
    const duplicateCandidates = await PriceLog.aggregate([
      {
        $group: {
          _id: { portfolio: "$portfolio", dateOnly: "$dateOnly" },
          count: { $sum: 1 },
          docs: { $push: { id: "$_id", date: "$date", updateCount: "$updateCount", value: "$portfolioValue" } }
        }
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { "_id.dateOnly": -1 } }
    ]);

    logger.info(`Found ${duplicateCandidates.length} portfolio-days with duplicate entries`);

    const results = {
      duplicatesFound: duplicateCandidates.length,
      duplicatesRemoved: 0,
      errors: []
    };

    // Process each duplicate set
    for (const duplicate of duplicateCandidates) {
      try {
        logger.info(`Processing portfolio ${duplicate._id.portfolio} for date ${duplicate._id.dateOnly}`);
        
        // Sort by updateCount descending, then by date descending
        const sortedDocs = duplicate.docs.sort((a, b) => {
          if (b.updateCount !== a.updateCount) return b.updateCount - a.updateCount;
          return new Date(b.date) - new Date(a.date);
        });
        
        // Keep the first one (highest updateCount or most recent)
        const keepId = sortedDocs[0].id;
        const removeIds = sortedDocs.slice(1).map(doc => doc.id);
        
        logger.info(`Keeping record ${keepId} (value: ${sortedDocs[0].value}, updateCount: ${sortedDocs[0].updateCount})`);
        logger.info(`Removing ${removeIds.length} duplicate records`);
        
        if (removeIds.length > 0) {
          const deleteResult = await PriceLog.deleteMany({ _id: { $in: removeIds } });
          results.duplicatesRemoved += deleteResult.deletedCount;
          logger.info(`Deleted ${deleteResult.deletedCount} records`);
        }
      } catch (error) {
        logger.error(`Error processing portfolio ${duplicate._id.portfolio}: ${error.message}`);
        results.errors.push({
          portfolio: duplicate._id.portfolio,
          dateOnly: duplicate._id.dateOnly,
          error: error.message
        });
      }
    }
    
    return results;
  } catch (error) {
    logger.error(`Cleanup failed: ${error.message}`);
    throw error;
  }
}

/**
 * Verifies that all portfolios have unique price logs for each day
 */
async function verifyPriceLogIntegrity() {
  logger.info('Verifying price log integrity');
  
  try {
    const duplicateCheck = await PriceLog.aggregate([
      {
        $group: {
          _id: { portfolio: "$portfolio", dateOnly: "$dateOnly" },
          count: { $sum: 1 }
        }
      },
      { $match: { count: { $gt: 1 } } },
      { $count: "duplicateCount" }
    ]);
    
    const duplicateCount = duplicateCheck.length > 0 ? duplicateCheck[0].duplicateCount : 0;
    
    if (duplicateCount === 0) {
      logger.info('✅ Price log integrity verified - no duplicates found');
      return true;
    } else {
      logger.warn(`⚠️ Found ${duplicateCount} portfolio-days with duplicate entries`);
      return false;
    }
  } catch (error) {
    logger.error(`Verification failed: ${error.message}`);
    throw error;
  }
}

/**
 * Main function to run the cleanup process
 */
async function main() {
  if (!(await connectDB())) {
    process.exit(1);
  }
  
  try {
    // First verify if we have any duplicates
    const initialCheck = await verifyPriceLogIntegrity();
    
    if (initialCheck) {
      logger.info('No duplicate price logs found. Nothing to clean up.');
    } else {
      // Run the cleanup
      const results = await cleanupDuplicatePriceLogs();
      
      logger.info('Cleanup completed with the following results:');
      logger.info(`- Duplicates found: ${results.duplicatesFound}`);
      logger.info(`- Duplicates removed: ${results.duplicatesRemoved}`);
      logger.info(`- Errors encountered: ${results.errors.length}`);
      
      // Verify that cleanup worked
      const finalCheck = await verifyPriceLogIntegrity();
      
      if (finalCheck) {
        logger.info('✅ Final verification passed - all duplicates have been removed');
      } else {
        logger.warn('⚠️ Final verification failed - some duplicates remain');
      }
    }
    
    // Close connection
    await mongoose.connection.close();
    logger.info('Database connection closed');
    
  } catch (error) {
    logger.error(`An error occurred during the cleanup process: ${error.message}`);
    if (error.stack) {
      logger.error(error.stack);
    }
    
    try {
      await mongoose.connection.close();
    } catch (closeError) {
      logger.error(`Error closing database connection: ${closeError.message}`);
    }
    
    process.exit(1);
  }
}

// If this script is run directly (not required by another module)
if (require.main === module) {
  main();
}

module.exports = {
  cleanupDuplicatePriceLogs,
  verifyPriceLogIntegrity
};
