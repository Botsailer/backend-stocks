const winston = require('winston');
const fs = require('fs');
const path = require('path');

// Enhanced Portfolio Transaction Logger with comprehensive debugging
class PortfolioTransactionLogger {
  constructor() {
    this.logsDir = path.resolve(__dirname, '../mainlog');
    this.ensureLogDirectory();
    this.initializeLogger();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
      console.log(`📁 Created mainlog directory at: ${this.logsDir}`);
    }
  }

  initializeLogger() {
    // Get today's date for daily log files
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const logFileName = `portfolio-transactions-${today}.log`;
    const logFilePath = path.join(this.logsDir, logFileName);

    // Custom format for detailed transaction logging
    const detailedFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        
        // Add metadata if present
        if (Object.keys(meta).length > 0) {
          logMessage += '\n' + JSON.stringify(meta, null, 2);
        }
        
        return logMessage + '\n' + '─'.repeat(120) + '\n';
      })
    );

    this.logger = winston.createLogger({
      level: 'debug',
      format: detailedFormat,
      transports: [
        // Daily file in mainlog directory (protected from cleanup)
        new winston.transports.File({ 
          filename: logFilePath,
          maxsize: 50 * 1024 * 1024, // 50MB per file
          maxFiles: 365, // Keep 1 year of logs
          tailable: true
        }),
        // Console output for development
        new winston.transports.Console({
          level: 'info',
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ]
    });

    this.logger.info('🚀 Portfolio Transaction Logger initialized', {
      logFile: logFilePath,
      date: today,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });
  }

  // Log the complete buy transaction flow
  async logBuyTransactionFlow(data) {
    const {
      frontendData,
      portfolioId,
      portfolioName,
      userEmail,
      stockSymbol,
      beforePortfolioState,
      beforeHoldingState,
      stockMarketData,
      calculationProcess,
      afterHoldingState,
      afterPortfolioState,
      validationResults,
      dbOperationResults
    } = data;

    this.logger.info('🛒 BUY TRANSACTION INITIATED', {
      transactionType: 'BUY',
      portfolioId,
      portfolioName,
      userEmail,
      stockSymbol,
      timestamp: new Date().toISOString()
    });

    // 1. Frontend Data Analysis
    this.logger.debug('📥 FRONTEND REQUEST DATA', {
      step: '1_FRONTEND_INPUT',
      receivedData: frontendData,
      dataValidation: {
        hasSymbol: !!frontendData.symbol,
        hasQuantity: !!frontendData.quantity,
        hasPrice: !!frontendData.price,
        quantityType: typeof frontendData.quantity,
        priceType: typeof frontendData.price,
        additionalFields: Object.keys(frontendData).filter(key => 
          !['symbol', 'quantity', 'price'].includes(key)
        )
      }
    });

    // 2. Portfolio State Before Transaction
    this.logger.debug('📊 PORTFOLIO STATE BEFORE TRANSACTION', {
      step: '2_BEFORE_STATE',
      portfolioData: {
        currentValue: beforePortfolioState.currentValue,
        cashBalance: beforePortfolioState.cashBalance,
        totalHoldings: beforePortfolioState.totalHoldings,
        activeHoldings: beforePortfolioState.activeHoldings,
        investedAmount: beforePortfolioState.investedAmount,
        totalMarketValue: beforePortfolioState.totalMarketValue
      },
      holdingData: beforeHoldingState ? {
        existingHolding: true,
        currentQuantity: beforeHoldingState.quantity,
        currentBuyPrice: beforeHoldingState.buyPrice,
        currentInvestment: beforeHoldingState.minimumInvestmentValueStock,
        currentWeight: beforeHoldingState.weight,
        status: beforeHoldingState.status,
        sector: beforeHoldingState.sector
      } : {
        existingHolding: false,
        message: 'New stock addition to portfolio'
      }
    });

    // 3. Stock Market Data
    this.logger.debug('📈 STOCK MARKET DATA ANALYSIS', {
      step: '3_MARKET_DATA',
      stockData: {
        symbol: stockMarketData.symbol,
        currentPrice: stockMarketData.currentPrice,
        todayClosingPrice: stockMarketData.todayClosingPrice,
        previousPrice: stockMarketData.previousPrice,
        priceSource: stockMarketData.priceSource,
        sector: stockMarketData.sector,
        marketCap: stockMarketData.marketCap,
        lastUpdated: stockMarketData.lastUpdated
      },
      priceComparison: {
        buyPriceVsCurrent: frontendData.price - stockMarketData.currentPrice,
        buyPriceVsClosing: stockMarketData.todayClosingPrice ? 
          frontendData.price - stockMarketData.todayClosingPrice : null,
        priceDeviationPercent: stockMarketData.currentPrice ? 
          ((frontendData.price - stockMarketData.currentPrice) / stockMarketData.currentPrice * 100).toFixed(2) + '%' : 'N/A'
      }
    });

    // 4. Calculation Process Details
    this.logger.debug('🧮 TRANSACTION CALCULATION PROCESS', {
      step: '4_CALCULATIONS',
      transactionDetails: {
        quantity: frontendData.quantity,
        buyPrice: frontendData.price,
        totalInvestment: frontendData.quantity * frontendData.price,
        transactionFee: calculationProcess.transactionFee || 0,
        netAmount: calculationProcess.netAmount
      },
      portfolioImpact: {
        cashReduction: calculationProcess.cashReduction,
        newCashBalance: calculationProcess.newCashBalance,
        portfolioValueChange: calculationProcess.portfolioValueChange,
        weightCalculation: calculationProcess.weightCalculation
      },
      holdingCalculation: beforeHoldingState ? {
        type: 'EXISTING_HOLDING_UPDATE',
        oldQuantity: beforeHoldingState.quantity,
        additionalQuantity: frontendData.quantity,
        newTotalQuantity: beforeHoldingState.quantity + frontendData.quantity,
        oldInvestment: beforeHoldingState.minimumInvestmentValueStock,
        additionalInvestment: frontendData.quantity * frontendData.price,
        newTotalInvestment: beforeHoldingState.minimumInvestmentValueStock + (frontendData.quantity * frontendData.price),
        averagePriceCalculation: {
          oldAvgPrice: beforeHoldingState.buyPrice,
          newAvgPrice: calculationProcess.newAveragePrice,
          priceChange: calculationProcess.newAveragePrice - beforeHoldingState.buyPrice
        }
      } : {
        type: 'NEW_HOLDING_CREATION',
        initialQuantity: frontendData.quantity,
        initialInvestment: frontendData.quantity * frontendData.price,
        initialBuyPrice: frontendData.price
      }
    });

    // 5. Database Validation Results
    this.logger.debug('✅ VALIDATION RESULTS', {
      step: '5_VALIDATION',
      portfolioValidation: validationResults.portfolioValidation,
      holdingValidation: validationResults.holdingValidation,
      cashValidation: {
        hasSufficientCash: validationResults.hasSufficientCash,
        requiredCash: calculationProcess.netAmount,
        availableCash: beforePortfolioState.cashBalance,
        cashAfterTransaction: calculationProcess.newCashBalance
      },
      dataIntegrity: validationResults.dataIntegrity
    });

    // 6. After Transaction State
    this.logger.debug('📊 PORTFOLIO STATE AFTER TRANSACTION', {
      step: '6_AFTER_STATE',
      portfolioData: {
        newCurrentValue: afterPortfolioState.currentValue,
        newCashBalance: afterPortfolioState.cashBalance,
        newTotalHoldings: afterPortfolioState.totalHoldings,
        valueChange: afterPortfolioState.currentValue - beforePortfolioState.currentValue,
        cashChange: afterPortfolioState.cashBalance - beforePortfolioState.cashBalance
      },
      holdingData: {
        finalQuantity: afterHoldingState.quantity,
        finalBuyPrice: afterHoldingState.buyPrice,
        finalInvestment: afterHoldingState.minimumInvestmentValueStock,
        finalWeight: afterHoldingState.weight,
        finalStatus: afterHoldingState.status,
        quantityChange: afterHoldingState.quantity - (beforeHoldingState?.quantity || 0),
        investmentChange: afterHoldingState.minimumInvestmentValueStock - (beforeHoldingState?.minimumInvestmentValueStock || 0)
      }
    });

    // 7. Database Operation Results
    this.logger.debug('💾 DATABASE OPERATIONS', {
      step: '7_DB_OPERATIONS',
      operations: dbOperationResults.operations,
      portfolioSave: dbOperationResults.portfolioSave,
      indexUpdates: dbOperationResults.indexUpdates,
      errors: dbOperationResults.errors || []
    });

    this.logger.info('✅ BUY TRANSACTION COMPLETED SUCCESSFULLY', {
      transactionSummary: {
        symbol: stockSymbol,
        quantityPurchased: frontendData.quantity,
        pricePerShare: frontendData.price,
        totalInvestment: frontendData.quantity * frontendData.price,
        finalPortfolioValue: afterPortfolioState.currentValue,
        finalCashBalance: afterPortfolioState.cashBalance,
        executionTime: new Date().toISOString()
      }
    });
  }

  // Log the complete sell transaction flow
  async logSellTransactionFlow(data) {
    const {
      frontendData,
      portfolioId,
      portfolioName,
      userEmail,
      stockSymbol,
      beforePortfolioState,
      beforeHoldingState,
      stockMarketData,
      calculationProcess,
      afterHoldingState,
      afterPortfolioState,
      validationResults,
      dbOperationResults,
      profitLossAnalysis
    } = data;

    this.logger.info('💰 SELL TRANSACTION INITIATED', {
      transactionType: 'SELL',
      portfolioId,
      portfolioName,
      userEmail,
      stockSymbol,
      timestamp: new Date().toISOString()
    });

    // 1. Frontend Data Analysis
    this.logger.debug('📥 FRONTEND SELL REQUEST DATA', {
      step: '1_FRONTEND_INPUT',
      receivedData: frontendData,
      sellType: frontendData.saleType || 'partial',
      dataValidation: {
        hasSymbol: !!frontendData.symbol,
        hasQuantity: !!frontendData.quantityToSell,
        hasSaleType: !!frontendData.saleType,
        quantityType: typeof frontendData.quantityToSell,
        sellInstruction: frontendData.saleType === 'complete' ? 'SELL ALL SHARES' : `SELL ${frontendData.quantityToSell} SHARES`
      }
    });

    // 2. Current Holding Analysis
    this.logger.debug('📊 HOLDING STATE BEFORE SALE', {
      step: '2_BEFORE_HOLDING_STATE',
      holdingData: {
        currentQuantity: beforeHoldingState.quantity,
        quantityToSell: frontendData.quantityToSell,
        remainingAfterSale: Math.max(0, beforeHoldingState.quantity - frontendData.quantityToSell),
        originalBuyPrice: beforeHoldingState.buyPrice,
        currentInvestment: beforeHoldingState.minimumInvestmentValueStock,
        currentWeight: beforeHoldingState.weight,
        currentStatus: beforeHoldingState.status,
        sector: beforeHoldingState.sector,
        investmentToRealize: (frontendData.quantityToSell * beforeHoldingState.buyPrice).toFixed(2)
      },
      saleValidation: {
        hasSufficientQuantity: beforeHoldingState.quantity >= frontendData.quantityToSell,
        quantityDeficit: Math.max(0, frontendData.quantityToSell - beforeHoldingState.quantity),
        isCompleteSale: frontendData.quantityToSell >= beforeHoldingState.quantity || frontendData.saleType === 'complete'
      }
    });

    // 3. Market Price Analysis for Sale
    this.logger.debug('📈 MARKET PRICE ANALYSIS FOR SALE', {
      step: '3_MARKET_ANALYSIS',
      marketData: {
        currentMarketPrice: stockMarketData.currentPrice,
        todayClosingPrice: stockMarketData.todayClosingPrice,
        originalBuyPrice: beforeHoldingState.buyPrice,
        priceUsedForSale: calculationProcess.salePrice
      },
      profitLossPreview: {
        pricePerShareGain: (calculationProcess.salePrice - beforeHoldingState.buyPrice).toFixed(2),
        pricePerShareGainPercent: (((calculationProcess.salePrice - beforeHoldingState.buyPrice) / beforeHoldingState.buyPrice) * 100).toFixed(2) + '%',
        totalGainOnSale: ((calculationProcess.salePrice - beforeHoldingState.buyPrice) * frontendData.quantityToSell).toFixed(2),
        grossSaleValue: (calculationProcess.salePrice * frontendData.quantityToSell).toFixed(2)
      }
    });

    // 4. Detailed Sale Calculations
    this.logger.debug('🧮 SALE CALCULATION BREAKDOWN', {
      step: '4_SALE_CALCULATIONS',
      saleDetails: {
        quantitySold: frontendData.quantityToSell,
        salePrice: calculationProcess.salePrice,
        grossSaleValue: calculationProcess.grossSaleValue,
        transactionFee: calculationProcess.transactionFee || 0,
        netSaleProceeds: calculationProcess.netSaleProceeds,
        originalInvestment: frontendData.quantityToSell * beforeHoldingState.buyPrice,
        realizedProfitLoss: calculationProcess.realizedProfitLoss,
        realizedProfitLossPercent: calculationProcess.realizedProfitLossPercent
      },
      portfolioImpact: {
        cashIncrease: calculationProcess.netSaleProceeds,
        newCashBalance: calculationProcess.newCashBalance,
        portfolioValueChange: calculationProcess.portfolioValueChange,
        investmentReduction: frontendData.quantityToSell * beforeHoldingState.buyPrice
      },
      remainingHolding: frontendData.quantityToSell < beforeHoldingState.quantity ? {
        remainingQuantity: beforeHoldingState.quantity - frontendData.quantityToSell,
        remainingInvestment: (beforeHoldingState.quantity - frontendData.quantityToSell) * beforeHoldingState.buyPrice,
        remainingMarketValue: (beforeHoldingState.quantity - frontendData.quantityToSell) * calculationProcess.salePrice,
        unrealizedPnL: ((beforeHoldingState.quantity - frontendData.quantityToSell) * (calculationProcess.salePrice - beforeHoldingState.buyPrice)).toFixed(2)
      } : {
        remainingQuantity: 0,
        message: 'COMPLETE SALE - No remaining holding'
      }
    });

    // 5. Profit/Loss Deep Analysis
    this.logger.debug('💹 PROFIT/LOSS ANALYSIS', {
      step: '5_PNL_ANALYSIS',
      analysis: profitLossAnalysis,
      taxImplications: {
        note: 'Consult tax advisor for capital gains implications',
        holdingPeriod: profitLossAnalysis.holdingPeriod,
        isLongTerm: profitLossAnalysis.isLongTerm,
        gainType: profitLossAnalysis.realizedProfitLoss > 0 ? 'CAPITAL_GAIN' : 'CAPITAL_LOSS'
      }
    });

    // 6. After Transaction State
    this.logger.debug('📊 PORTFOLIO STATE AFTER SALE', {
      step: '6_AFTER_STATE',
      portfolioData: {
        newCurrentValue: afterPortfolioState.currentValue,
        newCashBalance: afterPortfolioState.cashBalance,
        newTotalHoldings: afterPortfolioState.totalHoldings,
        valueChange: afterPortfolioState.currentValue - beforePortfolioState.currentValue,
        cashChange: afterPortfolioState.cashBalance - beforePortfolioState.cashBalance,
        liquidityIncrease: calculationProcess.netSaleProceeds
      },
      holdingData: afterHoldingState ? {
        finalQuantity: afterHoldingState.quantity,
        finalInvestment: afterHoldingState.minimumInvestmentValueStock,
        finalStatus: afterHoldingState.status,
        finalWeight: afterHoldingState.weight
      } : {
        holdingStatus: 'COMPLETELY_SOLD',
        message: 'Holding removed from portfolio'
      }
    });

    // 7. Database Operations
    this.logger.debug('💾 DATABASE OPERATIONS FOR SALE', {
      step: '7_DB_OPERATIONS',
      operations: dbOperationResults.operations,
      portfolioSave: dbOperationResults.portfolioSave,
      holdingUpdate: dbOperationResults.holdingUpdate,
      saleHistory: dbOperationResults.saleHistory,
      errors: dbOperationResults.errors || []
    });

    this.logger.info('✅ SELL TRANSACTION COMPLETED SUCCESSFULLY', {
      transactionSummary: {
        symbol: stockSymbol,
        quantitySold: frontendData.quantityToSell,
        salePrice: calculationProcess.salePrice,
        grossSaleValue: calculationProcess.grossSaleValue,
        netProceeds: calculationProcess.netSaleProceeds,
        realizedProfitLoss: calculationProcess.realizedProfitLoss,
        finalPortfolioValue: afterPortfolioState.currentValue,
        finalCashBalance: afterPortfolioState.cashBalance,
        executionTime: new Date().toISOString()
      }
    });
  }

  // Log portfolio calculation insights
  async logPortfolioCalculationInsights(data) {
    const {
      portfolioId,
      portfolioName,
      calculationType,
      triggerSource,
      beforeState,
      afterState,
      priceSourceAnalysis,
      performanceMetrics,
      benchmarkComparison
    } = data;

    this.logger.info('📊 PORTFOLIO CALCULATION INSIGHTS', {
      calculationType,
      portfolioId,
      portfolioName,
      triggerSource,
      timestamp: new Date().toISOString()
    });

    this.logger.debug('🔍 PORTFOLIO CALCULATION DETAILED ANALYSIS', {
      step: 'CALCULATION_INSIGHTS',
      beforeCalculation: beforeState,
      afterCalculation: afterState,
      priceSourceBreakdown: priceSourceAnalysis,
      performanceMetrics: performanceMetrics,
      benchmarkComparison: benchmarkComparison,
      calculationAccuracy: {
        totalHoldings: afterState.totalHoldings,
        calculatedValue: afterState.totalValue,
        cashBalance: afterState.cashBalance,
        marketValue: afterState.marketValue,
        unrealizedPnL: afterState.unrealizedPnL
      }
    });
  }

  // Log database query insights
  async logDatabaseQueryInsights(queryType, queryData, results, performance) {
    this.logger.debug('💾 DATABASE QUERY INSIGHTS', {
      step: 'DB_QUERY',
      queryType,
      queryData,
      results: {
        recordsFound: results.recordsFound,
        recordsModified: results.recordsModified,
        success: results.success
      },
      performance: {
        executionTime: performance.executionTime,
        memoryUsage: performance.memoryUsage,
        queryComplexity: performance.queryComplexity
      }
    });
  }

  // Log errors with full context
  async logError(errorType, errorMessage, context, stackTrace) {
    this.logger.error('❌ TRANSACTION ERROR', {
      errorType,
      errorMessage,
      context,
      stackTrace,
      timestamp: new Date().toISOString(),
      severity: 'HIGH'
    });
  }

  // Log system performance metrics
  async logSystemPerformance(metrics) {
    this.logger.debug('⚡ SYSTEM PERFORMANCE METRICS', {
      step: 'PERFORMANCE',
      metrics,
      timestamp: new Date().toISOString()
    });
  }
}

// Export singleton instance
const portfolioTransactionLogger = new PortfolioTransactionLogger();
module.exports = portfolioTransactionLogger;
