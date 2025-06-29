import { NseIndia } from 'stock-nse-india';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import mongoose from 'mongoose';
import { createRequire } from 'module';

// Create require function to import CommonJS modules
const require = createRequire(import.meta.url);
const StockSymbol = require('./models/stockSymbol.js');

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect('mongodb+srv://anupm8992:Nahipata%401@cluster0.vlpsxm1.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// Add delay function to avoid rate limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchNseStocks() {
  try {
    // Connect to database
    await connectDB();
    
    const nse = new NseIndia();
    
    // First, get all stock symbols
    console.log('Fetching all stock symbols...');
    const symbols = await nse.getAllStockSymbols();
    
    console.log(`Found ${symbols.length} stock symbols`);
    console.log('First 10 symbols:', symbols.slice(0, 10));

    if (!symbols || symbols.length === 0) {
      console.error('No symbols found');
      return;
    }

    let allStocks = [];
    let successCount = 0;
    let errorCount = 0;

    // Process symbols in batches to avoid overwhelming the API
    const batchSize = 150; // Process 50 symbols at a time
    const delayBetweenRequests = 100; // 100ms delay between requests

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(symbols.length/batchSize)} (${batch.length} symbols)`);

      for (const symbol of batch) {
        try {
          // Get equity trade info for each symbol
          const tradeInfo = await nse.getEquityDetails(symbol);
          
          console.log(`Fetched data for ${symbol}:`, tradeInfo.info);
          if (tradeInfo && tradeInfo.info) {
            const stockData = {
              symbol: symbol.toUpperCase(),
              name: tradeInfo.info.companyName || tradeInfo.info.symbol || 'N/A',
              currentPrice: tradeInfo.priceInfo?.lastPrice ? 
                tradeInfo.priceInfo.lastPrice.toString() : '1',
              previousPrice: tradeInfo.priceInfo?.previousClose ? 
                tradeInfo.priceInfo.previousClose.toString() : 
                (tradeInfo.priceInfo?.lastPrice ? tradeInfo.priceInfo.lastPrice.toString() : '1'),
              exchange: 'NSE'
            };
            
            allStocks.push(stockData);
            successCount++;
          } else {
            // If no trade info, create basic entry
            allStocks.push({
              symbol: symbol.toUpperCase(),
              name: 'N/A',
              currentPrice: '1',
              previousPrice: '1',
              exchange: 'NSE'
            });
            successCount++;
          }
          
          // Add delay between requests
          await delay(delayBetweenRequests);
          
        } catch (error) {
          errorCount++;
          console.error(`Error fetching data for ${symbol}:`, error.message);
          
          // Create basic entry even if API call fails
          allStocks.push({
            symbol: symbol.toUpperCase(),
            name: 'N/A',
            currentPrice: '1',
            previousPrice: '1',
            exchange: 'NSE'
          });
        }
      }

      // Progress update
      console.log(`Progress: ${i + batch.length}/${symbols.length} - Success: ${successCount}, Errors: ${errorCount}`);
    }

    console.log(`\nFinal results: ${allStocks.length} stocks processed`);
    console.log(`Success: ${successCount}, Errors: ${errorCount}`);
    console.log('Sample stocks:', allStocks.slice(0, 5));
    
    // Save to JSON file
    const filePath = path.join(__dirname, 'nse_all_stocks.json');
    fs.writeFile(filePath, JSON.stringify(allStocks, null, 2), (err) => {
      if (err) {
        console.error('Error writing to file:', err);
      } else {
        console.log('All NSE stocks have been written to nse_all_stocks.json');
      }
    });

    // Save to MongoDB
    console.log('Saving stocks to MongoDB...');
    
    // Clear existing NSE stocks
    await StockSymbol.deleteMany({ exchange: 'NSE' });
    console.log('Cleared existing NSE stock data');
    
    // Insert new data in batches
    const dbBatchSize = 100;
    let totalSaved = 0;
    
    for (let i = 0; i < allStocks.length; i += dbBatchSize) {
      const batch = allStocks.slice(i, i + dbBatchSize);
      try {
        const result = await StockSymbol.insertMany(batch, { ordered: false });
        totalSaved += result.length;
        console.log(`Inserted batch ${Math.floor(i/dbBatchSize) + 1}/${Math.ceil(allStocks.length/dbBatchSize)} - ${result.length} stocks`);
      } catch (error) {
        console.error(`Error inserting batch ${Math.floor(i/dbBatchSize) + 1}:`, error.message);
        // Count successful insertions even if some fail
        if (error.insertedDocs) {
          totalSaved += error.insertedDocs.length;
        }
      }
    }
    
    console.log(`Successfully saved ${totalSaved} NSE stocks to MongoDB`);
    
  } catch (error) {
    console.error('Error fetching NSE stocks:', error);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Execute the function
fetchNseStocks();