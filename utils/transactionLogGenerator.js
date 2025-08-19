/**
 * Utility to create sample transaction logs for testing
 * 
 * This script generates sample transaction logs in the mainlog directory
 * to test the transaction log endpoints.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const SAMPLE_DAYS = 5; // Number of days to generate logs for
const ENTRIES_PER_DAY = 15; // Number of log entries per day
const LOG_DIR = path.join(__dirname, '..', 'mainlog');

// Stock symbols for sample data
const STOCK_SYMBOLS = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 
  'HINDUNILVR', 'SBIN', 'BHARTIARTL', 'ITC', 'KOTAKBANK'
];

// Transaction types
const TRANSACTION_TYPES = ['BUY', 'SELL', 'HOLD', 'REBALANCE'];

// Create log directory if it doesn't exist
function ensureLogDirectory() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    console.log(`Created log directory at: ${LOG_DIR}`);
  }
}

// Generate a random ID
function generateRandomId(prefix = '', length = 8) {
  return `${prefix}${crypto.randomBytes(length).toString('hex').substring(0, length)}`;
}

// Generate a random portfolio ID
function generatePortfolioId() {
  return generateRandomId('portfolio_');
}

// Generate a random transaction
function generateTransaction(date) {
  const transactionType = TRANSACTION_TYPES[Math.floor(Math.random() * TRANSACTION_TYPES.length)];
  const symbol = STOCK_SYMBOLS[Math.floor(Math.random() * STOCK_SYMBOLS.length)];
  const portfolioId = generatePortfolioId();
  const quantity = Math.floor(Math.random() * 100) + 1;
  const price = (Math.random() * 1000 + 100).toFixed(2);
  
  let transaction = {
    transactionId: generateRandomId('txn_', 12),
    transactionType,
    portfolioId,
    stockSymbol: symbol,
    timestamp: new Date(date).toISOString(),
    status: 'COMPLETED'
  };
  
  if (transactionType === 'BUY' || transactionType === 'SELL') {
    transaction.quantity = quantity;
    transaction.price = price;
    transaction.total = (quantity * parseFloat(price)).toFixed(2);
  }
  
  if (transactionType === 'SELL') {
    const profitLoss = (Math.random() * 200 - 100).toFixed(2);
    transaction.profitLoss = profitLoss;
    transaction.profitLossPercent = ((profitLoss / (quantity * parseFloat(price))) * 100).toFixed(2);
  }
  
  return transaction;
}

// Create a formatted log entry
function createLogEntry(transaction, date) {
  const time = new Date(date);
  time.setHours(Math.floor(Math.random() * 8) + 9); // Between 9 AM and 5 PM
  time.setMinutes(Math.floor(Math.random() * 60));
  time.setSeconds(Math.floor(Math.random() * 60));
  
  const timestamp = time.toISOString().replace('T', ' ').substring(0, 19);
  let logLevel = 'INFO';
  
  if (Math.random() < 0.2) {
    logLevel = 'DEBUG';
  } else if (Math.random() < 0.1) {
    logLevel = 'WARN';
  }
  
  let emoji = '🛒';
  if (transaction.transactionType === 'SELL') emoji = '💰';
  else if (transaction.transactionType === 'HOLD') emoji = '⏳';
  else if (transaction.transactionType === 'REBALANCE') emoji = '⚖️';
  
  const header = `[${timestamp}] [${logLevel}] ${emoji} ${transaction.transactionType} TRANSACTION ${logLevel === 'WARN' ? 'WARNING' : 'INITIATED'}`;
  const body = JSON.stringify(transaction, null, 2);
  
  return `${header}\n${body}\n\n`;
}

// Generate log file for a specific date
function generateLogForDate(date) {
  const dateStr = date.toISOString().split('T')[0];
  const logFileName = `portfolio-transactions-${dateStr}.log`;
  const logFilePath = path.join(LOG_DIR, logFileName);
  
  let logContent = '';
  
  for (let i = 0; i < ENTRIES_PER_DAY; i++) {
    const transaction = generateTransaction(date);
    logContent += createLogEntry(transaction, date);
  }
  
  fs.writeFileSync(logFilePath, logContent);
  console.log(`Created sample log file: ${logFileName}`);
  
  return logFilePath;
}

// Generate sample logs for the past N days
function generateSampleLogs() {
  ensureLogDirectory();
  
  const today = new Date();
  const generatedFiles = [];
  
  for (let i = 0; i < SAMPLE_DAYS; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const logFilePath = generateLogForDate(date);
    generatedFiles.push(logFilePath);
  }
  
  return generatedFiles;
}

// If called directly, generate sample logs
if (require.main === module) {
  console.log('Generating sample transaction logs...');
  const generatedFiles = generateSampleLogs();
  console.log(`Successfully generated ${generatedFiles.length} sample log files in ${LOG_DIR}`);
}

module.exports = {
  generateSampleLogs
};
