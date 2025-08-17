const fs = require('fs').promises;
const path = require('path');

class TransactionLogger {
  constructor() {
    this.logDir = path.join(__dirname, '../');
    this.logFilePath = path.join(this.logDir, 'transaction-logs.txt');
  }

  async ensureLogFile() {
    try {
      await fs.access(this.logFilePath);
    } catch (error) {
      // File doesn't exist, create it
      await fs.writeFile(this.logFilePath, '=== PORTFOLIO TRANSACTION LOGS ===\n\n');
    }
  }

  formatCurrency(amount) {
    return `₹${parseFloat(amount).toFixed(2)}`;
  }

  formatPercentage(value) {
    return `${parseFloat(value).toFixed(2)}%`;
  }

  getCurrentTimestamp() {
    return new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  async logBuyTransaction(data) {
    await this.ensureLogFile();
    
    const {
      portfolioId,
      portfolioName,
      stockSymbol,
      action, // 'Fresh-Buy' or 'addon-buy'
      beforeState,
      stockData,
      transactionData,
      afterState,
      portfolioBefore,
      portfolioAfter,
      userEmail
    } = data;

    const logEntry = `
${'='.repeat(80)}
🔵 BUY TRANSACTION - ${action.toUpperCase()}
${'='.repeat(80)}
📅 Timestamp: ${this.getCurrentTimestamp()}
👤 User: ${userEmail}
📊 Portfolio: ${portfolioName} (ID: ${portfolioId})
🏷️  Stock Symbol: ${stockSymbol}

📈 STOCK MARKET DATA (from StockSymbol Collection):
   • Current Market Price: ${this.formatCurrency(stockData.currentPrice)}
   • Today Opening Price: ${this.formatCurrency(stockData.todayOpeningPrice || 'N/A')}
   • Today Closing Price: ${this.formatCurrency(stockData.todayClosingPrice || 'N/A')}
   • Previous Close: ${this.formatCurrency(stockData.previousClose || 'N/A')}
   • 52 Week High: ${this.formatCurrency(stockData.weekHigh52 || 'N/A')}
   • 52 Week Low: ${this.formatCurrency(stockData.weekLow52 || 'N/A')}
   • Market Cap: ${stockData.marketCap || 'N/A'}
   • Sector: ${stockData.sector || 'N/A'}

🔄 TRANSACTION DETAILS:
   • Action Type: ${action}
   • Buy Price: ${this.formatCurrency(transactionData.buyPrice)}
   • Quantity Purchased: ${transactionData.quantity}
   • Total Investment: ${this.formatCurrency(transactionData.totalInvestment)}
   • Transaction Fee: ${this.formatCurrency(transactionData.transactionFee || 0)}
   • Net Amount Deducted: ${this.formatCurrency(transactionData.netAmount)}

📋 BEFORE TRANSACTION STATE:
   Portfolio Level:
   • Total Value: ${this.formatCurrency(portfolioBefore.totalValue)}
   • Cash Balance: ${this.formatCurrency(portfolioBefore.cashBalance)}
   • Total Investment: ${this.formatCurrency(portfolioBefore.totalInvestment)}
   • Minimum Investment: ${this.formatCurrency(portfolioBefore.minInvestment)}
   • Holdings Count: ${portfolioBefore.holdingsCount}
   
   Stock Level (${stockSymbol}):
   ${beforeState.exists ? `
   • Existing Position: YES
   • Previous Quantity: ${beforeState.quantity}
   • Previous Buy Price: ${this.formatCurrency(beforeState.buyPrice)}
   • Previous Investment Value: ${this.formatCurrency(beforeState.investmentValue)}
   • Previous Weight: ${this.formatPercentage(beforeState.weight)}
   • Previous Unrealized P&L: ${this.formatCurrency(beforeState.unrealizedPnL)}` : `
   • Existing Position: NO - This is a fresh purchase`}

🔄 CALCULATION PROCESS:
   Step 1 - Price Validation:
   • Market Price: ${this.formatCurrency(stockData.currentPrice)}
   • Buy Price Used: ${this.formatCurrency(transactionData.buyPrice)}
   • Price Difference: ${this.formatCurrency(transactionData.buyPrice - stockData.currentPrice)} (${transactionData.buyPrice > stockData.currentPrice ? 'Premium' : 'Discount'})
   
   Step 2 - Investment Calculation:
   • Quantity × Buy Price = ${transactionData.quantity} × ${this.formatCurrency(transactionData.buyPrice)} = ${this.formatCurrency(transactionData.totalInvestment)}
   
   ${beforeState.exists ? `
   Step 3 - Weighted Average Calculation (for addon-buy):
   • Previous Total Investment: ${this.formatCurrency(beforeState.totalInvestment)}
   • New Investment: ${this.formatCurrency(transactionData.totalInvestment)}
   • Combined Investment: ${this.formatCurrency(beforeState.totalInvestment + transactionData.totalInvestment)}
   • Previous Total Quantity: ${beforeState.quantity}
   • New Quantity: ${transactionData.quantity}
   • Combined Quantity: ${beforeState.quantity + transactionData.quantity}
   • New Weighted Avg Price: ${this.formatCurrency((beforeState.totalInvestment + transactionData.totalInvestment) / (beforeState.quantity + transactionData.quantity))}` : ''}
   
   Step 4 - Cash Balance Update:
   • Previous Cash: ${this.formatCurrency(portfolioBefore.cashBalance)}
   • Amount Deducted: ${this.formatCurrency(transactionData.netAmount)}
   • New Cash Balance: ${this.formatCurrency(portfolioBefore.cashBalance - transactionData.netAmount)}

✅ AFTER TRANSACTION STATE:
   Portfolio Level:
   • Total Value: ${this.formatCurrency(portfolioAfter.totalValue)}
   • Cash Balance: ${this.formatCurrency(portfolioAfter.cashBalance)}
   • Total Investment: ${this.formatCurrency(portfolioAfter.totalInvestment)}
   • Holdings Count: ${portfolioAfter.holdingsCount}
   • Value Change: ${this.formatCurrency(portfolioAfter.totalValue - portfolioBefore.totalValue)}
   
   Stock Level (${stockSymbol}):
   • Final Quantity: ${afterState.quantity}
   • Final Buy Price (Weighted Avg): ${this.formatCurrency(afterState.buyPrice)}
   • Total Investment Value: ${this.formatCurrency(afterState.investmentValueAtBuy)}
   • Current Market Value: ${this.formatCurrency(afterState.investmentValueAtMarket)}
   • Current Weight: ${this.formatPercentage(afterState.weight)}
   • Unrealized P&L: ${this.formatCurrency(afterState.unrealizedPnL)} (${this.formatPercentage(afterState.unrealizedPnLPercent)})
   • Status: ${afterState.status}

💰 FINANCIAL SUMMARY:
   • Amount Invested: ${this.formatCurrency(transactionData.totalInvestment)}
   • Cash Remaining: ${this.formatCurrency(portfolioAfter.cashBalance)}
   • Portfolio Growth: ${this.formatCurrency(portfolioAfter.totalValue - portfolioBefore.totalValue)}
   • Transaction Impact: ${portfolioAfter.totalValue > portfolioBefore.totalValue ? '✅ Positive' : '⚠️ Negative'}

${'='.repeat(80)}

`;

    try {
      await fs.appendFile(this.logFilePath, logEntry);
    } catch (error) {
      console.error('Failed to write buy transaction log:', error);
    }
  }

  async logSellTransaction(data) {
    await this.ensureLogFile();
    
    const {
      portfolioId,
      portfolioName,
      stockSymbol,
      action, // 'partial-sell' or 'Sell'
      beforeState,
      stockData,
      transactionData,
      afterState,
      portfolioBefore,
      portfolioAfter,
      userEmail,
      sellCalculation
    } = data;

    const logEntry = `
${'='.repeat(80)}
🔴 SELL TRANSACTION - ${action.toUpperCase()}
${'='.repeat(80)}
📅 Timestamp: ${this.getCurrentTimestamp()}
👤 User: ${userEmail}
📊 Portfolio: ${portfolioName} (ID: ${portfolioId})
🏷️  Stock Symbol: ${stockSymbol}

📈 STOCK MARKET DATA (from StockSymbol Collection):
   • Current Market Price: ${this.formatCurrency(stockData.currentPrice)}
   • Today Opening Price: ${this.formatCurrency(stockData.todayOpeningPrice || 'N/A')}
   • Today Closing Price: ${this.formatCurrency(stockData.todayClosingPrice || 'N/A')}
   • Previous Close: ${this.formatCurrency(stockData.previousClose || 'N/A')}
   • 52 Week High: ${this.formatCurrency(stockData.weekHigh52 || 'N/A')}
   • 52 Week Low: ${this.formatCurrency(stockData.weekLow52 || 'N/A')}

🔄 TRANSACTION DETAILS:
   • Action Type: ${action}
   • Sell Price (Market): ${this.formatCurrency(transactionData.sellPrice)}
   • Quantity to Sell: ${transactionData.quantity}
   • Total Sale Value: ${this.formatCurrency(transactionData.totalSaleValue)}
   • Transaction Fee: ${this.formatCurrency(transactionData.transactionFee || 0)}
   • Net Amount Received: ${this.formatCurrency(transactionData.netAmount)}

📋 BEFORE TRANSACTION STATE:
   Portfolio Level:
   • Total Value: ${this.formatCurrency(portfolioBefore.totalValue)}
   • Cash Balance: ${this.formatCurrency(portfolioBefore.cashBalance)}
   • Total Investment: ${this.formatCurrency(portfolioBefore.totalInvestment)}
   • Holdings Count: ${portfolioBefore.holdingsCount}
   
   Stock Level (${stockSymbol}):
   • Held Quantity: ${beforeState.quantity}
   • Buy Price (Weighted Avg): ${this.formatCurrency(beforeState.buyPrice)}
   • Total Investment Value: ${this.formatCurrency(beforeState.investmentValueAtBuy)}
   • Current Market Value: ${this.formatCurrency(beforeState.investmentValueAtMarket)}
   • Weight: ${this.formatPercentage(beforeState.weight)}
   • Unrealized P&L: ${this.formatCurrency(beforeState.unrealizedPnL)} (${this.formatPercentage(beforeState.unrealizedPnLPercent)})

🔄 SELL CALCULATION PROCESS:
   Step 1 - Quantity Validation:
   • Available Quantity: ${beforeState.quantity}
   • Requested Sell Quantity: ${transactionData.quantity}
   • Validation: ${transactionData.quantity <= beforeState.quantity ? '✅ Valid' : '❌ Insufficient'}
   
   Step 2 - Sale Value Calculation:
   • Market Price: ${this.formatCurrency(stockData.currentPrice)}
   • Sell Quantity: ${transactionData.quantity}
   • Gross Sale Value: ${transactionData.quantity} × ${this.formatCurrency(stockData.currentPrice)} = ${this.formatCurrency(transactionData.totalSaleValue)}
   
   Step 3 - P&L Calculation:
   • Original Investment (for sold quantity): ${this.formatCurrency(sellCalculation.originalInvestment)}
   • Sale Value: ${this.formatCurrency(transactionData.totalSaleValue)}
   • Realized P&L: ${this.formatCurrency(sellCalculation.realizedPnL)}
   • P&L Percentage: ${this.formatPercentage(sellCalculation.realizedPnLPercent)}
   
   Step 4 - Remaining Position Calculation:
   • Remaining Quantity: ${beforeState.quantity} - ${transactionData.quantity} = ${beforeState.quantity - transactionData.quantity}
   ${action !== 'Sell' ? `• Remaining Investment Value: ${this.formatCurrency(sellCalculation.remainingInvestment)}
   • Remaining Market Value: ${this.formatCurrency(sellCalculation.remainingMarketValue)}` : '• Position: COMPLETELY SOLD'}
   
   Step 5 - Cash Balance Update:
   • Previous Cash: ${this.formatCurrency(portfolioBefore.cashBalance)}
   • Amount Received: ${this.formatCurrency(transactionData.netAmount)}
   • New Cash Balance: ${this.formatCurrency(portfolioBefore.cashBalance + transactionData.netAmount)}

✅ AFTER TRANSACTION STATE:
   Portfolio Level:
   • Total Value: ${this.formatCurrency(portfolioAfter.totalValue)}
   • Cash Balance: ${this.formatCurrency(portfolioAfter.cashBalance)}
   • Total Investment: ${this.formatCurrency(portfolioAfter.totalInvestment)}
   • Holdings Count: ${portfolioAfter.holdingsCount}
   • Value Change: ${this.formatCurrency(portfolioAfter.totalValue - portfolioBefore.totalValue)}
   
   Stock Level (${stockSymbol}):
   ${afterState ? `
   • Final Quantity: ${afterState.quantity}
   • Buy Price (Weighted Avg): ${this.formatCurrency(afterState.buyPrice)}
   • Total Investment Value: ${this.formatCurrency(afterState.investmentValueAtBuy)}
   • Current Market Value: ${this.formatCurrency(afterState.investmentValueAtMarket)}
   • Current Weight: ${this.formatPercentage(afterState.weight)}
   • Unrealized P&L: ${this.formatCurrency(afterState.unrealizedPnL)} (${this.formatPercentage(afterState.unrealizedPnLPercent)})
   • Status: ${afterState.status}` : `
   • Position Status: COMPLETELY SOLD
   • Final Sale Date: ${new Date().toLocaleDateString('en-IN')}
   • Final Sale Price: ${this.formatCurrency(stockData.currentPrice)}`}

💰 FINANCIAL SUMMARY:
   • Gross Sale Amount: ${this.formatCurrency(transactionData.totalSaleValue)}
   • Net Amount Received: ${this.formatCurrency(transactionData.netAmount)}
   • Realized P&L: ${this.formatCurrency(sellCalculation.realizedPnL)} (${this.formatPercentage(sellCalculation.realizedPnLPercent)})
   • Cash Balance Change: +${this.formatCurrency(transactionData.netAmount)}
   • Transaction Result: ${sellCalculation.realizedPnL >= 0 ? '✅ Profit' : '❌ Loss'}

${'='.repeat(80)}

`;

    try {
      await fs.appendFile(this.logFilePath, logEntry);
    } catch (error) {
      console.error('Failed to write sell transaction log:', error);
    }
  }

  async logPortfolioSnapshot(portfolioData, reason = 'Portfolio Update') {
    await this.ensureLogFile();
    
    const logEntry = `
${'='.repeat(80)}
📊 PORTFOLIO SNAPSHOT - ${reason.toUpperCase()}
${'='.repeat(80)}
📅 Timestamp: ${this.getCurrentTimestamp()}
📊 Portfolio: ${portfolioData.name} (ID: ${portfolioData._id})

💼 PORTFOLIO OVERVIEW:
   • Total Value: ${this.formatCurrency(portfolioData.totalValue)}
   • Cash Balance: ${this.formatCurrency(portfolioData.cashBalance)}
   • Total Investment: ${this.formatCurrency(portfolioData.totalInvestment)}
   • Minimum Investment: ${this.formatCurrency(portfolioData.minInvestment)}
   • Holdings Count: ${portfolioData.holdings.length}
   • Overall P&L: ${this.formatCurrency(portfolioData.totalValue - portfolioData.minInvestment)}

📈 INDIVIDUAL HOLDINGS:
${portfolioData.holdings.map((holding, index) => `
   ${index + 1}. ${holding.symbol}:
      • Quantity: ${holding.quantity}
      • Buy Price: ${this.formatCurrency(holding.buyPrice)}
      • Current Price: ${this.formatCurrency(holding.currentPrice)}
      • Investment Value: ${this.formatCurrency(holding.investmentValueAtBuy)}
      • Market Value: ${this.formatCurrency(holding.investmentValueAtMarket)}
      • Weight: ${this.formatPercentage(holding.weight)}
      • Unrealized P&L: ${this.formatCurrency(holding.unrealizedPnL)} (${this.formatPercentage(holding.unrealizedPnLPercent)})
      • Status: ${holding.status}`).join('')}

${'='.repeat(80)}

`;

    try {
      await fs.appendFile(this.logFilePath, logEntry);
    } catch (error) {
      console.error('Failed to write portfolio snapshot log:', error);
    }
  }

  async logError(error, context = 'Unknown') {
    await this.ensureLogFile();
    
    const logEntry = `
${'='.repeat(80)}
❌ ERROR LOG
${'='.repeat(80)}
📅 Timestamp: ${this.getCurrentTimestamp()}
🔴 Context: ${context}
🔴 Error: ${error.message}
🔴 Stack: ${error.stack}
${'='.repeat(80)}

`;

    try {
      await fs.appendFile(this.logFilePath, logEntry);
    } catch (writeError) {
      console.error('Failed to write error log:', writeError);
    }
  }
}

module.exports = new TransactionLogger();
