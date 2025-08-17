const fs = require('fs').promises;
const path = require('path');
const StockSymbol = require('../models/stockSymbol');
const { PortfolioCalculationValidator } = require('../utils/portfolioCalculationValidator');

class PortfolioCalculationLogger {
  constructor() {
    this.logDir = path.join(__dirname, '..', 'temp-logs');
    this.logFileName = 'portfolio-calculation-detailed.log';
    this.logFilePath = path.join(this.logDir, this.logFileName);
    this.maxLogAge = 2 * 24 * 60 * 60 * 1000; // 2 days in milliseconds
    
    // Ensure log directory exists
    this.ensureLogDirectory();
    
    // Schedule auto-cleanup
    this.scheduleCleanup();
  }

  async ensureLogDirectory() {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
    } catch (error) {
      // Directory creation failed - fail silently in production
    }
  }

  scheduleCleanup() {
    // Clean up every 6 hours
    setInterval(() => {
      this.cleanupOldLogs();
    }, 6 * 60 * 60 * 1000);
    
    // Initial cleanup
    this.cleanupOldLogs();
  }

  async cleanupOldLogs() {
    try {
      const stats = await fs.stat(this.logFilePath);
      const now = new Date().getTime();
      const fileAge = now - stats.mtime.getTime();
      
      if (fileAge > this.maxLogAge) {
        await fs.unlink(this.logFilePath);
        // Old log file cleaned up
      }
    } catch (error) {
      // File doesn't exist or can't be accessed, ignore
    }
  }

  async logMessage(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data
    };
    
    const logLine = JSON.stringify(logEntry) + '\n';
    
    try {
      await fs.appendFile(this.logFilePath, logLine);
    } catch (error) {
      // Failed to write to log file - fail silently in production
    }
  }

  async logCalculationStart(portfolioId, portfolioName) {
    await this.logMessage('INFO', '🚀 PORTFOLIO CALCULATION STARTED', {
      portfolioId,
      portfolioName,
      step: 'INITIALIZATION'
    });
  }

  async logStep1_FetchRealTimePrices(portfolio) {
    await this.logMessage('INFO', '📊 STEP 1: Fetching Real-Time Market Prices', {
      step: 'STEP_1_PRICE_FETCH',
      portfolioId: portfolio._id,
      totalHoldings: portfolio.holdings.length
    });

    const priceDetails = [];
    let activeCount = 0;
    let soldCount = 0;
    
    for (const holding of portfolio.holdings) {
      let priceData = {
        symbol: holding.symbol,
        quantity: holding.quantity,
        buyPrice: holding.buyPrice,
        minimumInvestmentValueStock: holding.minimumInvestmentValueStock,
        status: holding.status
      };

      if (holding.status === 'Sell' || holding.quantity === 0) {
        priceData.marketPrice = 0;
        priceData.priceSource = 'not_applicable_sold';
        priceData.marketValue = 0;
        priceData.excludedFromPortfolio = true;
        soldCount++;
        
        await this.logMessage('DEBUG', `   💀 ${holding.symbol}: SOLD STOCK - Excluded from portfolio value`, {
          step: 'STEP_1_SOLD_STOCK',
          symbol: holding.symbol,
          soldDate: holding.soldDate,
          totalSaleValue: holding.totalSaleValue,
          totalProfitLoss: holding.totalProfitLoss
        });
      } else {
        activeCount++;
        try {
          const stock = await StockSymbol.findOne({ symbol: holding.symbol });
          
          if (stock) {
            // Price priority: todayClosingPrice → currentPrice → buyPrice
            if (stock.todayClosingPrice && stock.todayClosingPrice > 0) {
              priceData.marketPrice = stock.todayClosingPrice;
              priceData.priceSource = 'today_closing_price';
            } else if (stock.currentPrice && stock.currentPrice > 0) {
              priceData.marketPrice = stock.currentPrice;
              priceData.priceSource = 'current_live_price';
            } else {
              priceData.marketPrice = holding.buyPrice;
              priceData.priceSource = 'fallback_buy_price';
            }
            
            priceData.marketValue = priceData.marketPrice * holding.quantity;
            priceData.stockFound = true;
            priceData.excludedFromPortfolio = false;
          } else {
            priceData.marketPrice = holding.buyPrice;
            priceData.priceSource = 'stock_not_found_using_buy_price';
            priceData.marketValue = holding.buyPrice * holding.quantity;
            priceData.stockFound = false;
            priceData.excludedFromPortfolio = false;
          }
        } catch (error) {
          priceData.marketPrice = holding.buyPrice;
          priceData.priceSource = 'error_fallback_to_buy_price';
          priceData.marketValue = holding.buyPrice * holding.quantity;
          priceData.error = error.message;
          priceData.excludedFromPortfolio = false;
        }
        
        await this.logMessage('DEBUG', `   📈 ${holding.symbol}: ${priceData.priceSource} = ₹${priceData.marketPrice} × ${holding.quantity} = ₹${priceData.marketValue}`, {
          step: 'STEP_1_INDIVIDUAL_PRICE',
          ...priceData
        });
      }
      
      priceDetails.push(priceData);
    }

    await this.logMessage('INFO', '📊 Price Fetching Summary', {
      step: 'STEP_1_SUMMARY',
      activeHoldings: activeCount,
      soldHoldings: soldCount,
      totalHoldings: portfolio.holdings.length
    });

    return priceDetails;
  }

  async logStep2_MinimumInvestmentComparison(portfolio, priceDetails) {
    await this.logMessage('INFO', '💰 STEP 2: Minimum Investment Validation', {
      step: 'STEP_2_MIN_INVESTMENT',
      portfolioId: portfolio._id,
      minInvestment: portfolio.minInvestment
    });

    const totalActualInvestment = portfolio.holdings
      .filter(h => h.status !== 'Sell')
      .reduce((sum, h) => sum + (h.minimumInvestmentValueStock || 0), 0);

    const totalRealizedPnL = portfolio.holdings
      .filter(h => h.status === 'Sell')
      .reduce((sum, h) => sum + (h.realizedPnL || 0), 0);

    const effectiveMinInvestment = portfolio.minInvestment + Math.max(0, totalRealizedPnL);

    await this.logMessage('INFO', '📊 Formula: Effective Min Investment = Original Min Investment + Profits from Sales', {
      step: 'STEP_2_FORMULA',
      originalMinInvestment: portfolio.minInvestment,
      profitsFromSales: Math.max(0, totalRealizedPnL),
      effectiveMinInvestment: effectiveMinInvestment,
      formula: `${portfolio.minInvestment} + ${Math.max(0, totalRealizedPnL)} = ${effectiveMinInvestment}`
    });

    await this.logMessage('INFO', '💵 Actual Investment vs Effective Minimum', {
      step: 'STEP_2_COMPARISON',
      totalActualInvestment: totalActualInvestment,
      effectiveMinInvestment: effectiveMinInvestment,
      difference: effectiveMinInvestment - totalActualInvestment,
      isValid: totalActualInvestment <= effectiveMinInvestment
    });

    return {
      totalActualInvestment,
      totalRealizedPnL,
      effectiveMinInvestment
    };
  }

  async logStep3_CashBalanceCalculation(portfolio, validationData) {
    await this.logMessage('INFO', '💸 STEP 3: Cash Balance Calculation', {
      step: 'STEP_3_CASH_CALCULATION',
      portfolioId: portfolio._id
    });

    const { totalActualInvestment, effectiveMinInvestment } = validationData;
    
    let calculatedCashBalance;
    let calculationMethod;

    if (portfolio.cashBalance !== null && portfolio.cashBalance !== undefined) {
      calculatedCashBalance = portfolio.cashBalance;
      calculationMethod = 'existing_cash_balance';
      
      await this.logMessage('INFO', '💰 Using Existing Cash Balance', {
        step: 'STEP_3_EXISTING_CASH',
        existingCashBalance: portfolio.cashBalance,
        reason: 'Portfolio has existing cash balance from previous transactions'
      });
    } else {
      calculatedCashBalance = effectiveMinInvestment - totalActualInvestment;
      calculationMethod = 'calculated_from_min_investment';
      
      await this.logMessage('INFO', '🧮 Formula: Cash Balance = Effective Min Investment - Total Actual Investment', {
        step: 'STEP_3_CASH_FORMULA',
        effectiveMinInvestment: effectiveMinInvestment,
        totalActualInvestment: totalActualInvestment,
        calculatedCashBalance: calculatedCashBalance,
        formula: `${effectiveMinInvestment} - ${totalActualInvestment} = ${calculatedCashBalance}`
      });
    }

    await this.logMessage('INFO', '💳 Final Cash Balance Result', {
      step: 'STEP_3_FINAL_CASH',
      cashBalance: calculatedCashBalance,
      calculationMethod: calculationMethod,
      isNegative: calculatedCashBalance < 0
    });

    return {
      cashBalance: calculatedCashBalance,
      calculationMethod
    };
  }

  async logStep4_HoldingsValueCalculation(portfolio, priceDetails) {
    await this.logMessage('INFO', '📊 STEP 4: Holdings Value Calculation', {
      step: 'STEP_4_HOLDINGS_VALUE',
      portfolioId: portfolio._id
    });

    let holdingsValueAtBuy = 0;
    let holdingsValueAtMarket = 0;
    let totalUnrealizedPnL = 0;

    const activeHoldings = priceDetails.filter(p => p.status !== 'Sell' && p.quantity > 0 && !p.excludedFromPortfolio);
    const soldHoldings = priceDetails.filter(p => p.status === 'Sell' || p.excludedFromPortfolio);
    
    await this.logMessage('INFO', '📈 Processing Active Holdings (Contributing to Portfolio Value)', {
      step: 'STEP_4_ACTIVE_HOLDINGS',
      activeHoldingsCount: activeHoldings.length,
      soldHoldingsCount: soldHoldings.length
    });

    for (const priceDetail of activeHoldings) {
      const buyValue = priceDetail.buyPrice * priceDetail.quantity;
      const marketValue = priceDetail.marketValue;
      const unrealizedPnL = marketValue - buyValue;
      
      holdingsValueAtBuy += buyValue;
      holdingsValueAtMarket += marketValue;
      totalUnrealizedPnL += unrealizedPnL;

      await this.logMessage('DEBUG', `   📈 ${priceDetail.symbol} Value Calculation`, {
        step: 'STEP_4_INDIVIDUAL_HOLDING',
        symbol: priceDetail.symbol,
        buyPrice: priceDetail.buyPrice,
        marketPrice: priceDetail.marketPrice,
        quantity: priceDetail.quantity,
        buyValue: buyValue,
        marketValue: marketValue,
        unrealizedPnL: unrealizedPnL,
        pnlPercentage: buyValue > 0 ? ((unrealizedPnL / buyValue) * 100).toFixed(2) : 0
      });
    }

    // Log sold holdings (for reference, but not included in value)
    for (const soldDetail of soldHoldings) {
      await this.logMessage('DEBUG', `   💀 ${soldDetail.symbol} - SOLD (Not included in portfolio value)`, {
        step: 'STEP_4_SOLD_HOLDING',
        symbol: soldDetail.symbol,
        status: soldDetail.status,
        quantity: soldDetail.quantity,
        reason: 'Excluded from portfolio value calculation'
      });
    }

    await this.logMessage('INFO', '📊 Holdings Summary', {
      step: 'STEP_4_HOLDINGS_SUMMARY',
      holdingsValueAtBuy: holdingsValueAtBuy,
      holdingsValueAtMarket: holdingsValueAtMarket,
      totalUnrealizedPnL: totalUnrealizedPnL,
      pnlPercentage: holdingsValueAtBuy > 0 ? ((totalUnrealizedPnL / holdingsValueAtBuy) * 100).toFixed(2) : 0,
      activeHoldingsCount: activeHoldings.length,
      soldHoldingsCount: soldHoldings.length,
      note: 'Only active holdings contribute to portfolio value'
    });

    return {
      holdingsValueAtBuy,
      holdingsValueAtMarket,
      totalUnrealizedPnL
    };
  }

  async logStep5_TotalPortfolioValue(portfolio, cashData, holdingsData) {
    await this.logMessage('INFO', '💼 STEP 5: Total Portfolio Value Calculation', {
      step: 'STEP_5_TOTAL_VALUE',
      portfolioId: portfolio._id
    });

    const { cashBalance } = cashData;
    const { holdingsValueAtMarket } = holdingsData;
    
    const totalPortfolioValue = holdingsValueAtMarket + Math.max(0, cashBalance);
    
    await this.logMessage('INFO', '🧮 Formula: Total Portfolio Value = Holdings Market Value + Cash Balance', {
      step: 'STEP_5_FORMULA',
      holdingsValueAtMarket: holdingsValueAtMarket,
      cashBalance: cashBalance,
      cashBalanceUsed: Math.max(0, cashBalance),
      totalPortfolioValue: totalPortfolioValue,
      formula: `${holdingsValueAtMarket} + ${Math.max(0, cashBalance)} = ${totalPortfolioValue}`,
      note: cashBalance < 0 ? 'Negative cash balance not included in total value' : 'Cash balance included in total value'
    });

    return totalPortfolioValue;
  }

  async logStep6_ValidationAndSummary(portfolio, allCalculations) {
    await this.logMessage('INFO', '✅ STEP 6: Final Validation & Summary', {
      step: 'STEP_6_FINAL_SUMMARY',
      portfolioId: portfolio._id
    });

    const {
      priceDetails,
      validationData,
      cashData,
      holdingsData,
      totalPortfolioValue
    } = allCalculations;

    // Calculate portfolio summary using validator
    try {
      const portfolioSummary = PortfolioCalculationValidator.calculatePortfolioSummary({
        holdings: portfolio.holdings,
        minInvestment: portfolio.minInvestment,
        existingCashBalance: portfolio.cashBalance
      });

      await this.logMessage('INFO', '🔍 Validation Summary', {
        step: 'STEP_6_VALIDATION',
        calculatedTotalValue: totalPortfolioValue,
        validatorTotalValue: portfolioSummary.totalPortfolioValueAtMarket,
        valuesMatch: Math.abs(totalPortfolioValue - portfolioSummary.totalPortfolioValueAtMarket) < 0.01,
        validationPassed: portfolioSummary.validation.isValid,
        negativeBalance: portfolioSummary.hasNegativeBalance
      });

      await this.logMessage('SUCCESS', '🎉 PORTFOLIO CALCULATION COMPLETED SUCCESSFULLY', {
        step: 'COMPLETION',
        portfolioId: portfolio._id,
        portfolioName: portfolio.name,
        finalValues: {
          cashBalance: cashData.cashBalance,
          holdingsValueAtMarket: holdingsData.holdingsValueAtMarket,
          totalPortfolioValue: totalPortfolioValue,
          totalUnrealizedPnL: holdingsData.totalUnrealizedPnL,
          minInvestment: portfolio.minInvestment,
          effectiveMinInvestment: validationData.effectiveMinInvestment
        },
        priceSourceBreakdown: this.calculatePriceSourceBreakdown(priceDetails),
        calculationTime: new Date().toISOString()
      });

    } catch (error) {
      await this.logMessage('ERROR', '❌ VALIDATION FAILED', {
        step: 'STEP_6_ERROR',
        portfolioId: portfolio._id,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  calculatePriceSourceBreakdown(priceDetails) {
    const breakdown = {
      today_closing_price: 0,
      current_live_price: 0,
      fallback_buy_price: 0,
      not_applicable_sold: 0,
      stock_not_found: 0,
      error_fallback: 0
    };

    priceDetails.forEach(detail => {
      switch (detail.priceSource) {
        case 'today_closing_price':
          breakdown.today_closing_price++;
          break;
        case 'current_live_price':
          breakdown.current_live_price++;
          break;
        case 'fallback_buy_price':
          breakdown.fallback_buy_price++;
          break;
        case 'not_applicable_sold':
          breakdown.not_applicable_sold++;
          break;
        case 'stock_not_found_using_buy_price':
          breakdown.stock_not_found++;
          break;
        case 'error_fallback_to_buy_price':
          breakdown.error_fallback++;
          break;
      }
    });

    return breakdown;
  }

  async logCompleteCalculation(portfolio) {
    try {
      await this.logCalculationStart(portfolio._id, portfolio.name);
      
      // Step 1: Fetch real-time prices
      const priceDetails = await this.logStep1_FetchRealTimePrices(portfolio);
      
      // Step 2: Minimum investment validation
      const validationData = await this.logStep2_MinimumInvestmentComparison(portfolio, priceDetails);
      
      // Step 3: Cash balance calculation
      const cashData = await this.logStep3_CashBalanceCalculation(portfolio, validationData);
      
      // Step 4: Holdings value calculation
      const holdingsData = await this.logStep4_HoldingsValueCalculation(portfolio, priceDetails);
      
      // Step 5: Total portfolio value
      const totalPortfolioValue = await this.logStep5_TotalPortfolioValue(portfolio, cashData, holdingsData);
      
      // Step 6: Final validation and summary
      await this.logStep6_ValidationAndSummary(portfolio, {
        priceDetails,
        validationData,
        cashData,
        holdingsData,
        totalPortfolioValue
      });

      return {
        success: true,
        totalPortfolioValue,
        cashBalance: cashData.cashBalance,
        holdingsValueAtMarket: holdingsData.holdingsValueAtMarket
      };

    } catch (error) {
      await this.logMessage('ERROR', '💥 CALCULATION FAILED', {
        step: 'CRITICAL_ERROR',
        portfolioId: portfolio._id,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async getLogs() {
    try {
      const data = await fs.readFile(this.logFilePath, 'utf8');
      const logs = data.trim().split('\n').filter(line => line.trim() !== '').map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return { timestamp: new Date().toISOString(), level: 'ERROR', message: 'Invalid log entry', data: { rawLine: line } };
        }
      });
      
      return logs;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async clearLogs() {
    try {
      await fs.unlink(this.logFilePath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return true; // File doesn't exist, consider it cleared
      }
      throw error;
    }
  }
}

module.exports = new PortfolioCalculationLogger();
