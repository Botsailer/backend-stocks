/**
 * Test script to update portfolio prices
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Portfolio = require('./models/modelPortFolio');
const StockSymbol = require('./models/stockSymbol'); // Import StockSymbol model

async function testPortfolioUpdate() {
  try {
    // Connect to database
    console.log('🔗 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/your_db_name');
    console.log('✅ Database connected successfully');

    // First check if portfolios exist
    console.log('🔍 Checking if portfolios exist...');
    const portfolioCount = await Portfolio.countDocuments();
    console.log(`📊 Found ${portfolioCount} portfolios in database`);
    
    if (portfolioCount === 0) {
      console.log('❌ No portfolios found in database');
      return;
    }

    // Check if StockSymbol data exists
    console.log('🔍 Checking StockSymbol data...');
    const symbolCount = await StockSymbol.countDocuments();
    console.log(`📊 Found ${symbolCount} stock symbols in database`);
    
    // Check what symbols actually exist
    const allSymbols = await StockSymbol.find({}, 'symbol').limit(10);
    console.log('📋 Sample symbols in database:', allSymbols.map(s => s.symbol).join(', '));
    
    // Check specific NUVAMA stock
    const nuvamaSymbol = await StockSymbol.findOne({ symbol: 'NUVAMA' });
    if (nuvamaSymbol) {
      console.log(`📈 NUVAMA stock found:`);
      console.log(`   currentPrice: ₹${nuvamaSymbol.currentPrice}`);
      console.log(`   todayClosingPrice: ₹${nuvamaSymbol.todayClosingPrice || 'N/A'}`);
      console.log(`   closingPriceUpdatedAt: ${nuvamaSymbol.closingPriceUpdatedAt || 'N/A'}`);
      console.log(`   isActive: ${nuvamaSymbol.isActive}`);
      
      // Check if closingPriceUpdatedAt is recent
      if (nuvamaSymbol.closingPriceUpdatedAt) {
        const timeDiff = Date.now() - nuvamaSymbol.closingPriceUpdatedAt.getTime();
        const hoursAgo = timeDiff / (1000 * 60 * 60);
        console.log(`   closingPriceUpdatedAt was ${hoursAgo.toFixed(1)} hours ago`);
        console.log(`   Will use: ${hoursAgo < 24 ? 'todayClosingPrice' : 'currentPrice'}`);
      }
    } else {
      console.log('❌ NUVAMA stock not found in StockSymbol collection');
      // Let's try to find any stock with 'NUVAMA' in the name
      const nuvamaLike = await StockSymbol.find({ 
        $or: [
          { symbol: { $regex: 'NUVAMA', $options: 'i' } },
          { name: { $regex: 'NUVAMA', $options: 'i' } }
        ]
      }).select('symbol name');
      
      if (nuvamaLike.length > 0) {
        console.log('🔍 Found similar NUVAMA stocks:', nuvamaLike.map(s => `${s.symbol} (${s.name})`));
      }
    }

    // Also check how many stocks have isActive = true vs false vs undefined
    const activeCount = await StockSymbol.countDocuments({ isActive: true });
    const inactiveCount = await StockSymbol.countDocuments({ isActive: false });
    const undefinedCount = await StockSymbol.countDocuments({ isActive: { $exists: false } });
    console.log(`📊 Active status: ${activeCount} active, ${inactiveCount} inactive, ${undefinedCount} undefined`);

    // Also check the current portfolio NUVAMA holding
    const portfolioWithNuvama = await Portfolio.findOne({ 'holdings.symbol': 'NUVAMA' });
    if (portfolioWithNuvama) {
      const nuvamaHolding = portfolioWithNuvama.holdings.find(h => h.symbol === 'NUVAMA');
      const stocks = await StockSymbol.find({ 
        symbol: { $in: ['NUVAMA', 'BLUESTARCO'] },
        $or: [
          { isActive: true },
          { isActive: { $exists: false } } // Include symbols without isActive field
        ]
      }).select('_id symbol currentPrice todayClosingPrice closingPriceUpdatedAt isActive');
      
      console.log(`📊 Test query for NUVAMA & BLUESTARCO returned ${stocks.length} symbols:`);
      stocks.forEach(stock => {
        console.log(`   Symbol: ${stock.symbol}, currentPrice: ₹${stock.currentPrice}, isActive: ${stock.isActive}`);
      });
      console.log(`   stored currentPrice: ₹${nuvamaHolding.currentPrice}`);
      console.log(`   stockRef: ${nuvamaHolding.stockRef || 'Not set'}`);
    }

    // Test the static method we created
    console.log('\n🔄 Updating all portfolios with market prices...');
    const results = await Portfolio.updateAllWithMarketPrices();
    
    console.log('📊 Results:');
    console.log(JSON.stringify(results, null, 2));
    
    // Summary
    const summary = {
      updated: results.filter(r => r.status === 'updated').length,
      noChanges: results.filter(r => r.status === 'no_changes').length,
      noHoldings: results.filter(r => r.status === 'no_holdings').length,
      failed: results.filter(r => r.status === 'error').length,
      total: results.length
    };
    
    console.log('\n📈 Summary:');
    console.log(`  Updated: ${summary.updated} portfolios`);
    console.log(`  No changes: ${summary.noChanges} portfolios`);
    console.log(`  No holdings: ${summary.noHoldings} portfolios`);
    console.log(`  Failed: ${summary.failed} portfolios`);
    console.log(`  Total: ${summary.total} portfolios`);
    
    // Let's also check one specific portfolio to see the price change
    const samplePortfolio = await Portfolio.findOne({ 'holdings.symbol': 'NUVAMA' });
    if (samplePortfolio) {
      console.log('\n📋 Sample NUVAMA holding after update:');
      const nuvamaHolding = samplePortfolio.holdings.find(h => h.symbol === 'NUVAMA');
      if (nuvamaHolding) {
        console.log(`  Symbol: ${nuvamaHolding.symbol}`);
        console.log(`  Buy Price: ₹${nuvamaHolding.buyPrice}`);
        console.log(`  Current Price: ₹${nuvamaHolding.currentPrice}`);
        console.log(`  Investment at Buy: ₹${nuvamaHolding.investmentValueAtBuy}`);
        console.log(`  Investment at Market: ₹${nuvamaHolding.investmentValueAtMarket}`);
        console.log(`  Unrealized PnL: ₹${nuvamaHolding.unrealizedPnL} (${nuvamaHolding.unrealizedPnLPercent}%)`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    // Disconnect from database
    await mongoose.disconnect();
    console.log('🔐 Database disconnected');
    process.exit(0);
  }
}

// Run the test
testPortfolioUpdate();
