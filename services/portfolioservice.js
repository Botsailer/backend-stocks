// services/portfolioService.js
const Portfolio = require('../models/modelPortFolio');
const StockSymbol = require('../models/stockSymbol');
const PriceLog = require('../models/PriceLog');



exports.calculatePortfolioValue = async (portfolio) => {
  let totalValue = portfolio.cashBalance;
  
  for (const holding of portfolio.holdings) {
    const stock = await StockSymbol.findOne({
      symbol: holding.symbol,
      exchange: holding.exchange
    });
    
    if (stock) {
      const currentPrice = parseFloat(stock.currentPrice);
      totalValue += currentPrice * holding.quantity;
    } else {
      // Fallback to buy price if live price unavailable
      totalValue += holding.buyPrice * holding.quantity;
    }
  }
  
  return totalValue;
};

exports.logPortfolioValue = async (portfolio) => {
  const portfolioValue = await this.calculatePortfolioValue(portfolio);
  
  return PriceLog.create({
    portfolio: portfolio._id,
    date: new Date(),
    portfolioValue,
    cashRemaining: portfolio.cashBalance
  });
};

exports.logAllPortfoliosDaily = async () => {
  const portfolios = await Portfolio.find();
  const results = [];
  
  for (const portfolio of portfolios) {
    try {
      const log = await this.logPortfolioValue(portfolio);
      results.push({
        portfolio: portfolio.name,
        status: 'success',
        logId: log._id
      });
    } catch (error) {
      results.push({
        portfolio: portfolio.name,
        status: 'failed',
        error: error.message
      });
    }
  }
  
  return results;
};