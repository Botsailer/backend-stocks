#!/usr/bin/env node

/**
 * Script to clean up duplicate price logs
 * This can be run manually when needed
 * 
 * Usage: node scripts/cleanup-price-logs.js
 */

const { cleanupDuplicatePriceLogs, verifyPriceLogIntegrity } = require('../utils/priceLogCleanup');
const mongoose = require('mongoose');
const config = require('../config/config');

async function runCleanup() {
  console.log('🚀 Starting price log cleanup script');
  
  try {
    // Connect to database
    console.log('Connecting to database...');
    await mongoose.connect(config.db.url, config.db.options);
    console.log('✅ Database connected');
    
    // Verify initial state
    console.log('Checking for duplicate price logs...');
    const initialCheck = await verifyPriceLogIntegrity();
    
    if (initialCheck) {
      console.log('✅ No duplicate price logs found. Nothing to clean up.');
      await mongoose.connection.close();
      return;
    }
    
    // Run cleanup
    console.log('🧹 Running duplicate cleanup...');
    const results = await cleanupDuplicatePriceLogs();
    
    console.log('\n📊 Cleanup Results:');
    console.log(`- Duplicates found: ${results.duplicatesFound}`);
    console.log(`- Duplicates removed: ${results.duplicatesRemoved}`);
    console.log(`- Errors encountered: ${results.errors.length}`);
    
    if (results.errors.length > 0) {
      console.log('\n⚠️ Errors encountered during cleanup:');
      results.errors.forEach((err, i) => {
        console.log(`  ${i+1}. Portfolio ${err.portfolio} on ${err.dateOnly}: ${err.error}`);
      });
    }
    
    // Verify final state
    console.log('\nVerifying final state...');
    const finalCheck = await verifyPriceLogIntegrity();
    
    if (finalCheck) {
      console.log('✅ All duplicates removed successfully!');
    } else {
      console.log('⚠️ Some duplicates remain. You may need to run the script again.');
    }
    
    // Close database connection
    await mongoose.connection.close();
    console.log('Database connection closed');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('Database connection closed');
    }
    
    process.exit(1);
  }
}

runCleanup();
