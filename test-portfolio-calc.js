#!/usr/bin/env node

/**
 * Test script to validate portfolio calculations and comparison data
 */

const mongoose = require('mongoose');
const config = require('./config/config.js');

async function testPortfolioCalculations() {
  try {
    // Connect to database
    await mongoose.connect(config.database.mongodb.uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to database');

    const Portfolio = require('./models/modelPortFolio');
    const PriceLog = require('./models/PriceLog');
    const StockSymbol = require('./models/stockSymbol');
    const portfolioService = require('./services/portfolioservice');

    // Find the portfolio from the user's example
    const portfolioId = '6884711b6e5afe24c9224e02';
    const portfolio = await Portfolio.findById(portfolioId);
    
    if (!portfolio) {
      console.log('❌ Portfolio not found');
      process.exit(1);
    }

    console.log('\n📊 Portfolio Info:');
    console.log(`Name: ${portfolio.name}`);
    console.log(`Cash Balance: ₹${portfolio.cashBalance}`);
    console.log(`Compare With: ${portfolio.compareWith}`);
    console.log(`Holdings Count: ${portfolio.holdings.length}`);

    // Check if compareWith stock exists
    if (portfolio.compareWith) {
      let compareStock;
      if (/^[0-9a-fA-F]{24}$/.test(portfolio.compareWith)) {
        compareStock = await StockSymbol.findById(portfolio.compareWith);
      } else {
        compareStock = await StockSymbol.findOne({ symbol: portfolio.compareWith });
      }

      console.log('\n🔍 Comparison Stock Info:');
      if (compareStock) {
        console.log(`✅ Found: ${compareStock.symbol}`);
        console.log(`Current Price: ${compareStock.currentPrice}`);
        console.log(`Today Closing Price: ${compareStock.todayClosingPrice}`);
        console.log(`Last Updated: ${compareStock.lastUpdated}`);
      } else {
        console.log(`❌ Not found: ${portfolio.compareWith}`);
      }
    }

    // Check recent logs
    const recentLogs = await PriceLog.find({ portfolio: portfolioId })
      .sort({ date: -1 })
      .limit(5);

    console.log('\n📈 Recent Price Logs:');
    recentLogs.forEach((log, i) => {
      console.log(`${i + 1}. ${log.date.toISOString()}`);
      console.log(`   Portfolio Value: ₹${log.portfolioValue}`);
      console.log(`   Compare Index Value: ${log.compareIndexValue || 'null'}`);
      console.log(`   Compare Index Source: ${log.compareIndexPriceSource || 'null'}`);
      console.log(`   Used Closing Prices: ${log.usedClosingPrices}`);
      console.log('');
    });

    // Test manual calculation
    console.log('\n🧮 Manual Portfolio Calculation:');
    const calculatedValue = await portfolioService.calculatePortfolioValue(portfolio, false);
    console.log(`Calculated Value: ₹${calculatedValue}`);

    // Test history retrieval
    console.log('\n📊 Testing History Retrieval:');
    const history = await portfolioService.getPortfolioHistory(portfolioId, '1m');
    console.log(`Data Points: ${history.dataPoints}`);
    console.log(`Compare Data Points: ${history.compareDataPoints}`);
    console.log(`Compare Symbol: ${history.compareSymbol}`);

    if (history.compareDataPoints === 0) {
      console.log('\n❌ No comparison data found. Possible issues:');
      console.log('1. compareWith stock not found in database');
      console.log('2. compareIndexValue not being stored in logs');
      console.log('3. compareIndexValue is null/zero in existing logs');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

// Run the test
testPortfolioCalculations();
