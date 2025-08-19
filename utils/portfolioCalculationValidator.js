const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.resolve(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
  console.log(`Created logs directory at: ${logsDir}`);
}

// Configure logger for portfolio calculations
const calcLogger = winston.createLogger({
  level: 'debug', // Set to debug level to capture all transaction details
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.printf(({ timestamp, level, message, ...rest }) => {
      let logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
      if (Object.keys(rest).length > 0) {
        logMessage += `\n${JSON.stringify(rest, null, 2)}`;
      }
      return logMessage;
    })
  ),
  transports: [
    new winston.transports.Console({
      level: 'info',
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ 
      filename: path.join(logsDir, 'portfolio-calculations.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
      tailable: true
    })
  ]
});

/**
 * Production-level portfolio calculation validation service
 * 
 * This service validates all frontend calculations on the backend to prevent:
 * 1. Manipulation attacks on portfolio values
 * 2. Calculation errors in frontend
 * 3. Data integrity issues
 * 4. Weight allocation attacks
 */
class PortfolioCalculationValidator {
  
  /**
   * Calculate investment details with integer share logic
   * @param {number} weightPercent - Target weight percentage
   * @param {number} buyPrice - Price per share
   * @param {number} totalInvestment - Total portfolio investment amount
   * @param {object} options - Additional calculation options
   * @returns {object} Validated calculation results
   */
  static calculateInvestmentDetails(weightPercent, buyPrice, totalInvestment, options = {}) {
    // Input validation
    if (typeof weightPercent !== 'number' || weightPercent < 0 || weightPercent > 100) {
      throw new Error(`Invalid weight percentage: ${weightPercent}. Must be between 0 and 100.`);
    }
    
    if (typeof buyPrice !== 'number' || buyPrice <= 0) {
      throw new Error(`Invalid buy price: ${buyPrice}. Must be greater than 0.`);
    }
    
    if (typeof totalInvestment !== 'number' || totalInvestment <= 0) {
      throw new Error(`Invalid total investment: ${totalInvestment}. Must be greater than 0.`);
    }

    const allocatedAmount = (weightPercent / 100) * totalInvestment;
    let quantity = Math.floor(allocatedAmount / buyPrice);
    let actualInvestmentAmount = quantity * buyPrice;
    let leftoverAmount = allocatedAmount - actualInvestmentAmount;

    // 10% tolerance rule for buying one extra share
    if (buyPrice > 0 && leftoverAmount >= 0) {
      const gapToNextShare = buyPrice - leftoverAmount;
      if (gapToNextShare <= buyPrice * 0.1) {
        quantity = quantity + 1;
        actualInvestmentAmount = quantity * buyPrice;
        leftoverAmount = allocatedAmount - actualInvestmentAmount;
      }
    }

    // Recalculate accurate weight based on actual investment
    const accurateWeight = totalInvestment > 0 ? 
      ((actualInvestmentAmount / totalInvestment) * 100) : 0;

    const result = {
      allocatedAmount: Number(allocatedAmount.toFixed(2)),
      quantity: Number(quantity),
      actualInvestmentAmount: Number(actualInvestmentAmount.toFixed(2)),
      leftoverAmount: Number(leftoverAmount.toFixed(2)),
      accurateWeight: Number(accurateWeight.toFixed(4)),
      originalWeight: Number(weightPercent),
      buyPrice: Number(buyPrice),
      totalInvestment: Number(totalInvestment)
    };

    calcLogger.info('Investment calculation completed', {
      input: { weightPercent, buyPrice, totalInvestment, options },
      result
    });

    return result;
  }

  /**
   * Validate portfolio weights and detect manipulation
   * @param {Array} holdings - Array of holdings with weights
   * @param {number} maxAllowedWeight - Maximum allowed total weight (default 100%)
   * @returns {object} Validation result
   */
  static validatePortfolioWeights(holdings, maxAllowedWeight = 100) {
    if (!Array.isArray(holdings)) {
      throw new Error('Holdings must be an array');
    }

    let totalWeight = 0;
    const soldStocks = [];
    const activeStocks = [];
    
    holdings.forEach((holding, index) => {
      // Validate holding structure
      if (typeof holding.weight !== 'number') {
        throw new Error(`Invalid weight for holding at index ${index}: ${holding.weight}`);
      }
      
      if (holding.status === 'Sell') {
        soldStocks.push({ ...holding, index });
        // Sold stocks should have 0 weight
        if (holding.weight !== 0) {
          calcLogger.warn('Sold stock has non-zero weight', { 
            symbol: holding.symbol, 
            weight: holding.weight,
            status: holding.status 
          });
        }
      } else {
        activeStocks.push({ ...holding, index });
        totalWeight += holding.weight;
      }
    });

    const isValid = totalWeight <= maxAllowedWeight;
    const remainingWeight = maxAllowedWeight - totalWeight;

    const validation = {
      isValid,
      totalWeight: Number(totalWeight.toFixed(4)),
      remainingWeight: Number(remainingWeight.toFixed(4)),
      maxAllowedWeight,
      activeStocksCount: activeStocks.length,
      soldStocksCount: soldStocks.length,
      totalHoldings: holdings.length,
      activeStocks,
      soldStocks,
      errors: []
    };

    if (!isValid) {
      validation.errors.push(`Total weight ${totalWeight.toFixed(2)}% exceeds maximum allowed ${maxAllowedWeight}%`);
    }

    // Check for negative weights
    activeStocks.forEach(holding => {
      if (holding.weight < 0) {
        validation.errors.push(`Negative weight detected for ${holding.symbol}: ${holding.weight}%`);
      }
    });

    calcLogger.info('Portfolio weight validation completed', validation);
    return validation;
  }

  /**
   * Calculate average price when buying the same stock multiple times
   * @param {object} existingHolding - Current holding data
   * @param {object} newPurchase - New purchase data
   * @returns {object} Updated holding with averaged price
   */
  static calculateAveragePrice(existingHolding, newPurchase) {
    const {
      quantity: existingQty,
      buyPrice: existingPrice,
      minimumInvestmentValueStock: existingInvestment
    } = existingHolding;

    const {
      quantity: newQty,
      buyPrice: newPrice,
      minimumInvestmentValueStock: newInvestment
    } = newPurchase;

    // Validation
    if (typeof existingQty !== 'number' || existingQty < 0) {
      throw new Error(`Invalid existing quantity: ${existingQty}`);
    }
    
    if (typeof newQty !== 'number' || newQty <= 0) {
      throw new Error(`Invalid new quantity: ${newQty}`);
    }
    
    if (typeof existingPrice !== 'number' || existingPrice <= 0) {
      throw new Error(`Invalid existing price: ${existingPrice}`);
    }
    
    if (typeof newPrice !== 'number' || newPrice <= 0) {
      throw new Error(`Invalid new price: ${newPrice}`);
    }

    // Calculate totals
    const totalQuantity = existingQty + newQty;
    const totalInvestment = existingInvestment + newInvestment;
    const averagePrice = totalInvestment / totalQuantity;

    const result = {
      symbol: existingHolding.symbol,
      originalBuyPrice: existingHolding.originalBuyPrice || existingPrice, // Preserve first buy price
      buyPrice: Number(averagePrice.toFixed(4)), // New averaged price
      quantity: Number(totalQuantity),
      minimumInvestmentValueStock: Number(totalInvestment.toFixed(2)),
      priceHistory: [
        ...(existingHolding.priceHistory || []),
        {
          date: new Date().toISOString(),
          price: newPrice,
          quantity: newQty,
          investment: newInvestment,
          action: 'buy'
        }
      ],
      averagingData: {
        previousPrice: existingPrice,
        newPrice: newPrice,
        averagePrice: Number(averagePrice.toFixed(4)),
        previousQty: existingQty,
        newQty: newQty,
        totalQty: totalQuantity,
        calculatedAt: new Date().toISOString()
      }
    };

    calcLogger.info('Average price calculation completed', {
      symbol: existingHolding.symbol,
      previousPrice: existingPrice,
      newPrice: newPrice,
      averagePrice: result.buyPrice,
      totalQuantity: totalQuantity
    });

    return result;
  }

  /**
   * Calculate P&L for sell operations with SIMPLE pricing - USER REQUIREMENT
   * SIMPLE LOGIC: saleValue = currentMarketPrice * quantityToSell
   * @param {object} sellData - Sell operation data
   * @returns {object} P&L calculation with validation
   */
  static calculateSellPnL(sellData) {
    const {
      currentQuantity,
      averagedBuyPrice, 
      currentMarketPrice,
      quantityToSell,
      symbol,
      originalBuyPrice
    } = sellData;

    // Validation
    if (typeof currentQuantity !== 'number' || currentQuantity <= 0) {
      throw new Error(`Invalid current quantity: ${currentQuantity}`);
    }
    
    if (typeof currentMarketPrice !== 'number' || currentMarketPrice <= 0) {
      throw new Error(`Invalid current market price: ${currentMarketPrice}`);
    }
    
    if (typeof quantityToSell !== 'number' || quantityToSell <= 0 || quantityToSell > currentQuantity) {
      throw new Error(`Invalid quantity to sell: ${quantityToSell}. Must be between 1 and ${currentQuantity}`);
    }

    // SIMPLE CALCULATION AS PER USER REQUIREMENT
    // Sale value = current price * quantity (that's it!)
    const saleValue = quantityToSell * currentMarketPrice;
    
    // For tracking: calculate P&L vs buy price (but don't affect cash calculation)
    const averagedCost = quantityToSell * (averagedBuyPrice || currentMarketPrice);
    const profitLoss = saleValue - averagedCost;
    const profitLossPercent = averagedCost > 0 ? (profitLoss / averagedCost) * 100 : 0;
    
    // What remains after sale
    const remainingQuantity = currentQuantity - quantityToSell;

    // Log the sale calculation for debugging
    calcLogger.info('💰 Stock sale calculation', {
      symbol,
      quantityToSell,
      currentMarketPrice,
      averagedBuyPrice,
      saleValue,
      averagedCost,
      profitLoss,
      cashEffect: 'Adding full sale value to cash balance regardless of profit/loss'
    });

    const result = {
      symbol,
      quantitySold: Number(quantityToSell),
      saleValue: Number(saleValue.toFixed(2)), // SIMPLE: currentPrice * quantity
      
      // P&L tracking (for display only)
      averagedCost: Number(averagedCost.toFixed(2)),
      profitLoss: Number(profitLoss.toFixed(2)),
      profitLossPercent: Number(profitLossPercent.toFixed(2)),
      
      // Remaining position
      remainingQuantity: Number(remainingQuantity),
      
      // Prices used
      averagedBuyPrice: Number(averagedBuyPrice || currentMarketPrice),
      originalBuyPrice: Number(originalBuyPrice || averagedBuyPrice || currentMarketPrice),
      currentMarketPrice: Number(currentMarketPrice),
      
      // CASH IMPACT: WALLET BEHAVIOR - Simply add the full sale value to cash
      // This works like a real wallet - you get back exactly what you sell for
      cashIncrease: Number(saleValue.toFixed(2)), // Full sale proceeds added to cash
      realizedPnL: Number(profitLoss.toFixed(2)), // This is for tracking only, NOT for cash calculation
      
      calculatedAt: new Date().toISOString()
    };

    return result;
  }

  /**
   * Validate cash balance for new stock purchases
   * @param {number} currentCashBalance - Available cash balance
   * @param {number} purchaseAmount - Amount trying to purchase
   * @param {string} symbol - Stock symbol
   * @returns {object} Validation result
   */
  static validateCashBalance(currentCashBalance, purchaseAmount, symbol) {
    if (typeof currentCashBalance !== 'number') {
      throw new Error(`Invalid cash balance: ${currentCashBalance}`);
    }
    
    if (typeof purchaseAmount !== 'number' || purchaseAmount <= 0) {
      throw new Error(`Invalid purchase amount: ${purchaseAmount}`);
    }

    const isValid = currentCashBalance >= purchaseAmount;
    const shortfall = isValid ? 0 : purchaseAmount - currentCashBalance;

    const validation = {
      isValid,
      currentCashBalance: Number(currentCashBalance.toFixed(2)),
      purchaseAmount: Number(purchaseAmount.toFixed(2)),
      shortfall: Number(shortfall.toFixed(2)),
      remainingAfterPurchase: isValid ? Number((currentCashBalance - purchaseAmount).toFixed(2)) : currentCashBalance,
      symbol: symbol || 'Unknown',
      error: isValid ? null : `Insufficient cash balance. Available: ₹${currentCashBalance.toLocaleString()}, Required: ₹${purchaseAmount.toLocaleString()}, Shortfall: ₹${shortfall.toLocaleString()}`
    };

    if (!isValid) {
      calcLogger.warn('Cash balance validation failed', validation);
    }

    return validation;
  }

  /**
   * Validate minimum investment against holdings
   * @param {number} minInvestment - Proposed minimum investment
   * @param {Array} holdings - Portfolio holdings
   * @param {number} bufferPercent - Safety buffer percentage (default 10%)
   * @returns {object} Validation result with recommendations
   */
  static validateMinimumInvestment(minInvestment, holdings, bufferPercent = 10) {
    if (typeof minInvestment !== 'number' || minInvestment <= 0) {
      throw new Error(`Invalid minimum investment: ${minInvestment}`);
    }

    if (!Array.isArray(holdings)) {
      throw new Error('Holdings must be an array');
    }

    // Calculate total actual investment from active holdings
    const totalActualInvestment = holdings.reduce((sum, holding) => {
      if (holding.status === 'Sell') return sum;
      return sum + (holding.minimumInvestmentValueStock || 0);
    }, 0);

    const requiredWithBuffer = totalActualInvestment * (1 + bufferPercent / 100);
    const cashBalance = minInvestment - totalActualInvestment;
    const isValid = minInvestment >= totalActualInvestment;
    const needsAdjustment = minInvestment < requiredWithBuffer;

    const validation = {
      isValid,
      needsAdjustment,
      currentMinInvestment: Number(minInvestment),
      totalActualInvestment: Number(totalActualInvestment.toFixed(2)),
      requiredMinimum: Number(totalActualInvestment.toFixed(2)),
      recommendedMinimum: Number(requiredWithBuffer.toFixed(2)),
      cashBalance: Number(cashBalance.toFixed(2)),
      bufferPercent,
      shortfall: isValid ? 0 : Number((totalActualInvestment - minInvestment).toFixed(2)),
      errors: []
    };

    if (!isValid) {
      validation.errors.push(
        `Minimum investment ₹${minInvestment.toLocaleString()} is insufficient. ` +
        `Required: ₹${totalActualInvestment.toLocaleString()}, ` +
        `Shortfall: ₹${validation.shortfall.toLocaleString()}`
      );
    }

    if (needsAdjustment) {
      validation.warnings = [
        `Consider increasing minimum investment to ₹${requiredWithBuffer.toLocaleString()} ` +
        `for ${bufferPercent}% safety buffer`
      ];
    }

    calcLogger.info('Minimum investment validation completed', validation);
    return validation;
  }

  /**
   * Calculate portfolio financial summary with enhanced cash balance logic
   * @param {object} portfolioData - Portfolio data including holdings and minInvestment
   * @returns {object} Complete financial summary
   */
  static calculatePortfolioSummary(portfolioData) {
    // Log start of calculation
    calcLogger.debug('Starting portfolio summary calculation', {
      timestamp: new Date().toISOString(),
      inputData: {
        holdingsCount: portfolioData.holdings?.length || 0,
        minInvestment: portfolioData.minInvestment,
        hasMarketPrices: Object.keys(portfolioData.currentMarketPrices || {}).length > 0,
        existingCashBalance: portfolioData.existingCashBalance !== null ? 
          `${portfolioData.existingCashBalance}` : 'null'
      }
    });

    const { 
      holdings = [], 
      minInvestment = 0, 
      currentMarketPrices = {},
      existingCashBalance = null // Allow passing existing cash balance for updates
    } = portfolioData;

    // Validate inputs
    if (!Array.isArray(holdings)) {
      throw new Error('Holdings must be an array');
    }

    if (typeof minInvestment !== 'number' || minInvestment < 0) {
      throw new Error(`Invalid minimum investment: ${minInvestment}`);
    }

    // Calculate holdings values
    let holdingsValueAtBuy = 0;
    let holdingsValueAtMarket = 0;
    let totalActualInvestment = 0;
    let totalAllocatedAmount = 0;
    let totalLeftoverAmount = 0;
    let totalRealizedPnL = 0;
    let totalUnrealizedPnL = 0;

    const activeHoldings = [];
    const soldHoldings = [];

    holdings.forEach((holding, index) => {
      try {
        // Validate holding structure
        if (!holding.symbol || typeof holding.symbol !== 'string') {
          throw new Error(`Invalid symbol at index ${index}: ${holding.symbol}`);
        }

        if (holding.status === 'Sell') {
          soldHoldings.push(holding);
          totalRealizedPnL += (holding.realizedPnL || 0);
          return;
        }

        activeHoldings.push(holding);

        // Validate required fields
        const requiredFields = ['buyPrice', 'quantity', 'weight', 'minimumInvestmentValueStock'];
        requiredFields.forEach(field => {
          if (typeof holding[field] !== 'number' || holding[field] < 0) {
            throw new Error(`Invalid ${field} for ${holding.symbol}: ${holding[field]}`);
          }
        });

        // Calculate buy price value (averaged price)
        const buyValue = holding.buyPrice * holding.quantity;
        holdingsValueAtBuy += buyValue;

        // Calculate market value if available
        const marketPrice = currentMarketPrices[holding.symbol] || holding.buyPrice;
        const marketValue = marketPrice * holding.quantity;
        holdingsValueAtMarket += marketValue;

        // Calculate unrealized P&L using averaged buy price
        const unrealizedPnL = marketValue - buyValue;
        totalUnrealizedPnL += unrealizedPnL;

        // Accumulate investment amounts
        totalActualInvestment += holding.minimumInvestmentValueStock;
        
        // Calculate allocation details (for weight validation)
        const allocatedAmount = (holding.weight / 100) * minInvestment;
        totalAllocatedAmount += allocatedAmount;
        
        const leftoverAmount = allocatedAmount - holding.minimumInvestmentValueStock;
        totalLeftoverAmount += leftoverAmount;

      } catch (error) {
        calcLogger.error('Error processing holding', { 
          symbol: holding.symbol, 
          index, 
          error: error.message 
        });
        throw error;
      }
    });

    // Enhanced cash balance calculation
    let cashBalance;
    if (existingCashBalance !== null && existingCashBalance !== undefined) {
      // Use existing cash balance (for updates where profits may have accumulated)
      // This ensures cash balance functions as a wallet rather than being reset
      cashBalance = existingCashBalance;
    } else {
      // Calculate from minimum investment (for new portfolios only)
      cashBalance = minInvestment - totalActualInvestment;
    }

    // Calculate derived values - use market value for the current portfolio value
    // Market value is based on current/closing prices, not buy prices
    const totalPortfolioValue = holdingsValueAtMarket + Math.max(0, cashBalance);
    const totalPortfolioValueAtMarket = holdingsValueAtMarket + Math.max(0, cashBalance);
    // Calculate total portfolio value at buy price (original investment)
    const totalPortfolioValueAtBuy = holdingsValueAtBuy + Math.max(0, cashBalance);

    // Enhanced validation with profit consideration
    const canExceedMinInvestment = totalRealizedPnL > 0 || existingCashBalance !== null;
    const effectiveMinInvestment = canExceedMinInvestment ? 
      Math.max(minInvestment, minInvestment + totalRealizedPnL) : 
      minInvestment;

    // Validate weight allocation
    const weightValidation = this.validatePortfolioWeights(holdings);
    
    // Validate minimum investment with profit consideration
    const minInvestmentValidation = this.validateMinimumInvestmentWithProfits(
      minInvestment, 
      activeHoldings,
      totalRealizedPnL,
      cashBalance
    );

    // Cash flow analysis
    const profitFromSales = Math.max(0, totalRealizedPnL);
    const totalAvailableCash = cashBalance;
    const negativeBalance = cashBalance < 0;

    const summary = {
      // Core financial metrics
      minInvestment: Number(minInvestment),
      totalActualInvestment: Number(totalActualInvestment.toFixed(2)),
      cashBalance: Number(cashBalance.toFixed(2)),
      effectiveMinInvestment: Number(effectiveMinInvestment.toFixed(2)),
      
      // Holdings values
      holdingsValueAtBuy: Number(holdingsValueAtBuy.toFixed(2)),
      holdingsValueAtMarket: Number(holdingsValueAtMarket.toFixed(2)),
      
      // Portfolio totals
      totalPortfolioValueAtBuy: Number(totalPortfolioValueAtBuy.toFixed(2)),
      totalPortfolioValueAtMarket: Number(totalPortfolioValueAtMarket.toFixed(2)),
      
      // P&L metrics
      totalRealizedPnL: Number(totalRealizedPnL.toFixed(2)),
      totalUnrealizedPnL: Number(totalUnrealizedPnL.toFixed(2)),
      totalPnL: Number((totalRealizedPnL + totalUnrealizedPnL).toFixed(2)),
      
      // Cash flow analysis
      profitFromSales: Number(profitFromSales.toFixed(2)),
      totalAvailableCash: Number(totalAvailableCash.toFixed(2)),
      hasNegativeBalance: negativeBalance,
      canExceedMinInvestment,
      
      // Allocation metrics
      totalAllocatedAmount: Number(totalAllocatedAmount.toFixed(2)),
      totalLeftoverAmount: Number(totalLeftoverAmount.toFixed(2)),
      
      // Holdings counts
      totalHoldings: holdings.length,
      activeHoldings: activeHoldings.length,
      soldHoldings: soldHoldings.length,
      
      // Validations
      weightValidation,
      minInvestmentValidation,
      
      // Enhanced integrity checks
      isFinanciallyValid: !negativeBalance && weightValidation.isValid && minInvestmentValidation.isValid,
      canMakeNewPurchases: totalAvailableCash > 0,
      
      // Purchase limits
      maxPurchaseAmount: Math.max(0, totalAvailableCash),
      
      // Calculation metadata
      calculatedAt: new Date().toISOString(),
      marketPricesUsed: Object.keys(currentMarketPrices).length > 0,
      calculationMode: existingCashBalance !== null ? 'update' : 'create'
    };

    calcLogger.info('Enhanced portfolio summary calculation completed', {
      portfolioId: portfolioData.id || 'new',
      summary: {
        totalHoldings: summary.totalHoldings,
        totalInvestment: summary.totalActualInvestment,
        cashBalance: summary.cashBalance,
        realizedPnL: summary.totalRealizedPnL,
        maxPurchase: summary.maxPurchaseAmount,
        isValid: summary.isFinanciallyValid
      }
    });

    // Enhanced debug logging for comprehensive transaction tracking
    calcLogger.debug('Portfolio calculation details', {
      timestamp: new Date().toISOString(),
      calculationId: `calc-${Date.now()}`,
      financialMetrics: {
        minInvestment: summary.minInvestment,
        totalActualInvestment: summary.totalActualInvestment,
        cashBalance: summary.cashBalance,
        holdingsValueAtBuy: summary.holdingsValueAtBuy,
        holdingsValueAtMarket: summary.holdingsValueAtMarket,
        totalPortfolioValueAtBuy: summary.totalPortfolioValueAtBuy,
        totalPortfolioValueAtMarket: summary.totalPortfolioValueAtMarket,
      },
      profitAndLoss: {
        totalRealizedPnL: summary.totalRealizedPnL,
        totalUnrealizedPnL: summary.totalUnrealizedPnL,
        totalPnL: summary.totalPnL,
      },
      holdings: {
        totalCount: summary.totalHoldings,
        activeCount: summary.activeHoldings,
        soldCount: summary.soldHoldings,
        detailedHoldings: activeHoldings.map(h => ({
          symbol: h.symbol,
          quantity: h.quantity,
          buyPrice: h.buyPrice,
          marketPrice: h.currentPrice || h.buyPrice,
          valueAtBuy: h.buyPrice * h.quantity,
          valueAtMarket: (h.currentPrice || h.buyPrice) * h.quantity,
          unrealizedPnL: ((h.currentPrice || h.buyPrice) - h.buyPrice) * h.quantity
        }))
      },
      validations: {
        weightValidationPassed: weightValidation.isValid,
        minInvestmentValidationPassed: minInvestmentValidation.isValid,
        totalWeight: weightValidation.totalWeight,
        remainingWeight: weightValidation.remainingWeight
      }
    });

    return summary;
  }

  /**
   * Validate minimum investment with profit consideration
   * @param {number} minInvestment - Original minimum investment
   * @param {Array} activeHoldings - Active portfolio holdings
   * @param {number} totalRealizedPnL - Total realized profit/loss
   * @param {number} cashBalance - Current cash balance
   * @returns {object} Enhanced validation result
   */
  static validateMinimumInvestmentWithProfits(minInvestment, activeHoldings, totalRealizedPnL, cashBalance) {
    if (typeof minInvestment !== 'number' || minInvestment <= 0) {
      throw new Error(`Invalid minimum investment: ${minInvestment}`);
    }

    if (!Array.isArray(activeHoldings)) {
      throw new Error('Holdings must be an array');
    }

    // Calculate total actual investment from active holdings
    const totalActualInvestment = activeHoldings.reduce((sum, holding) => {
      return sum + (holding.minimumInvestmentValueStock || 0);
    }, 0);

    // Enhanced validation with profit consideration
    const profitFromSales = Math.max(0, totalRealizedPnL);
    const effectiveMinInvestment = minInvestment + profitFromSales;
    const totalPortfolioValue = totalActualInvestment + cashBalance;
    
    const isValid = totalActualInvestment <= effectiveMinInvestment;
    const hasProfit = profitFromSales > 0;
    const canExceedOriginal = hasProfit;

    const validation = {
      isValid,
      hasProfit,
      canExceedOriginal,
      originalMinInvestment: Number(minInvestment),
      effectiveMinInvestment: Number(effectiveMinInvestment.toFixed(2)),
      totalActualInvestment: Number(totalActualInvestment.toFixed(2)),
      profitFromSales: Number(profitFromSales.toFixed(2)),
      cashBalance: Number(cashBalance.toFixed(2)),
      totalPortfolioValue: Number(totalPortfolioValue.toFixed(2)),
      utilizationPercent: effectiveMinInvestment > 0 ? 
        Number(((totalActualInvestment / effectiveMinInvestment) * 100).toFixed(2)) : 0,
      errors: [],
      warnings: []
    };

    if (!isValid) {
      validation.errors.push(
        `Total investment ₹${totalActualInvestment.toLocaleString()} exceeds ` +
        `effective minimum investment ₹${effectiveMinInvestment.toLocaleString()}`
      );
    }

    if (cashBalance < 0) {
      validation.errors.push(
        `Negative cash balance: ₹${cashBalance.toLocaleString()}`
      );
    }

    if (hasProfit) {
      validation.warnings.push(
        `Portfolio includes ₹${profitFromSales.toLocaleString()} profit from sales. ` +
        `Effective minimum investment increased to ₹${effectiveMinInvestment.toLocaleString()}`
      );
    }

    calcLogger.info('Enhanced minimum investment validation completed', validation);
    return validation;
  }

  /**
   * Detect calculation tampering by comparing frontend and backend results
   * @param {object} frontendData - Data submitted from frontend
   * @param {object} portfolioData - Current portfolio data for validation
   * @returns {object} Tampering detection result
   */
  static detectCalculationTampering(frontendData, portfolioData) {
    try {
      // Recalculate everything on backend
      const backendCalculation = this.calculatePortfolioSummary({
        holdings: frontendData.holdings || [],
        minInvestment: frontendData.minInvestment || 0,
        currentMarketPrices: {} // Use buy prices for validation
      });

      // Compare key metrics with tolerance
      const tolerance = 0.01; // 1 cent tolerance for rounding differences
      const comparisons = {};
      
      // Extract frontend calculated values
      const frontendCashBalance = frontendData.cashBalance || 0;
      const frontendCurrentValue = frontendData.currentValue || 0;
      
      // Compare cash balance
      const cashDiff = Math.abs(backendCalculation.cashBalance - frontendCashBalance);
      comparisons.cashBalance = {
        backend: backendCalculation.cashBalance,
        frontend: frontendCashBalance,
        difference: Number(cashDiff.toFixed(2)),
        isValid: cashDiff <= tolerance
      };

      // Compare total portfolio value (using buy prices)
      const portfolioValueDiff = Math.abs(backendCalculation.totalPortfolioValueAtBuy - frontendCurrentValue);
      comparisons.portfolioValue = {
        backend: backendCalculation.totalPortfolioValueAtBuy,
        frontend: frontendCurrentValue,
        difference: Number(portfolioValueDiff.toFixed(2)),
        isValid: portfolioValueDiff <= tolerance
      };

      // Validate individual holdings
      const holdingValidations = [];
      (frontendData.holdings || []).forEach((frontendHolding, index) => {
        if (frontendHolding.status === 'Sell') return; // Skip sold stocks
        
        // Recalculate this holding
        try {
          const recalc = this.calculateInvestmentDetails(
            frontendHolding.weight,
            frontendHolding.buyPrice,
            frontendData.minInvestment || 0
          );

          const validation = {
            symbol: frontendHolding.symbol,
            index,
            quantityValid: recalc.quantity === frontendHolding.quantity,
            investmentValid: Math.abs(recalc.actualInvestmentAmount - frontendHolding.minimumInvestmentValueStock) <= tolerance,
            weightValid: Math.abs(recalc.accurateWeight - frontendHolding.weight) <= 0.01, // 0.01% tolerance
            backend: recalc,
            frontend: {
              quantity: frontendHolding.quantity,
              investment: frontendHolding.minimumInvestmentValueStock,
              weight: frontendHolding.weight
            }
          };

          validation.isValid = validation.quantityValid && validation.investmentValid && validation.weightValid;
          holdingValidations.push(validation);
        } catch (error) {
          holdingValidations.push({
            symbol: frontendHolding.symbol,
            index,
            isValid: false,
            error: error.message
          });
        }
      });

      const result = {
        isTampered: !comparisons.cashBalance.isValid || 
                   !comparisons.portfolioValue.isValid || 
                   holdingValidations.some(h => !h.isValid),
        comparisons,
        holdingValidations,
        backendCalculation,
        overallValid: comparisons.cashBalance.isValid && 
                     comparisons.portfolioValue.isValid && 
                     holdingValidations.every(h => h.isValid),
        detectedAt: new Date().toISOString()
      };

      if (result.isTampered) {
        calcLogger.warn('Potential calculation tampering detected', {
          portfolioId: portfolioData.id,
          result
        });
      }

      return result;
    } catch (error) {
      calcLogger.error('Error in tampering detection', { error: error.message });
      return {
        isTampered: true,
        error: error.message,
        detectedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Process stock purchase with averaging and cash validation
   * @param {object} purchaseData - Purchase operation data
   * @param {Array} existingHoldings - Current portfolio holdings
   * @param {number} availableCash - Available cash balance
   * @returns {object} Purchase processing result
   */
  static processStockPurchase(purchaseData, existingHoldings, availableCash) {
    const {
      symbol,
      buyPrice,
      quantity,
      sector,
      stockCapType,
      weight,
      minimumInvestmentValueStock
    } = purchaseData;

    // Validate inputs
    if (!symbol || typeof symbol !== 'string') {
      throw new Error(`Invalid symbol: ${symbol}`);
    }

    if (typeof buyPrice !== 'number' || buyPrice <= 0) {
      throw new Error(`Invalid buy price: ${buyPrice}`);
    }

    if (typeof quantity !== 'number' || quantity <= 0) {
      throw new Error(`Invalid quantity: ${quantity}`);
    }

    if (typeof minimumInvestmentValueStock !== 'number' || minimumInvestmentValueStock <= 0) {
      throw new Error(`Invalid investment amount: ${minimumInvestmentValueStock}`);
    }

    // Step 1: Validate cash balance
    const cashValidation = this.validateCashBalance(availableCash, minimumInvestmentValueStock, symbol);
    if (!cashValidation.isValid) {
      return {
        success: false,
        error: `Threshold exceeded! Cash balance remaining: ₹${availableCash.toLocaleString()}, but you are trying to add worth ₹${minimumInvestmentValueStock.toLocaleString()}`,
        cashValidation,
        availableCash: Number(availableCash.toFixed(2)),
        requiredAmount: Number(minimumInvestmentValueStock.toFixed(2)),
        shortfall: Number((minimumInvestmentValueStock - availableCash).toFixed(2))
      };
    }

    // Step 2: Check if stock already exists
    const existingIndex = existingHoldings.findIndex(
      h => h.symbol.toUpperCase() === symbol.toUpperCase() && h.status !== 'Sell'
    );

    let processedHolding;
    let operation;

    if (existingIndex >= 0) {
      // Step 3: Average with existing holding
      const existingHolding = existingHoldings[existingIndex];
      const averagingResult = this.calculateAveragePrice(existingHolding, {
        quantity,
        buyPrice,
        minimumInvestmentValueStock
      });

      processedHolding = {
        ...existingHolding,
        ...averagingResult,
        sector: sector || existingHolding.sector,
        stockCapType: stockCapType || existingHolding.stockCapType,
        weight: weight || existingHolding.weight,
        status: 'addon-buy', // Mark as additional purchase
        lastUpdated: new Date().toISOString()
      };

      operation = {
        type: 'averaged_purchase',
        existingIndex,
        previousPrice: existingHolding.buyPrice,
        newAveragePrice: averagingResult.buyPrice,
        totalQuantity: averagingResult.quantity,
        additionalInvestment: minimumInvestmentValueStock
      };

    } else {
      // Step 4: Create new holding
      processedHolding = {
        symbol: symbol.toUpperCase(),
        buyPrice: Number(buyPrice),
        originalBuyPrice: Number(buyPrice), // Preserve first purchase price
        quantity: Number(quantity),
        sector: sector || '',
        stockCapType: stockCapType || undefined,
        status: 'Fresh-Buy',
        weight: Number(weight || 0),
        minimumInvestmentValueStock: Number(minimumInvestmentValueStock),
        priceHistory: [{
          date: new Date().toISOString(),
          price: buyPrice,
          quantity: quantity,
          investment: minimumInvestmentValueStock,
          action: 'buy'
        }],
        createdAt: new Date().toISOString()
      };

      operation = {
        type: 'new_purchase',
        existingIndex: -1,
        firstPurchase: true
      };
    }

    // Step 5: Calculate new cash balance
    const newCashBalance = availableCash - minimumInvestmentValueStock;

    const result = {
      success: true,
      processedHolding,
      operation,
      cashImpact: {
        previousBalance: Number(availableCash.toFixed(2)),
        purchaseAmount: Number(minimumInvestmentValueStock.toFixed(2)),
        newBalance: Number(newCashBalance.toFixed(2)),
        remainingPurchasingPower: Number(newCashBalance.toFixed(2))
      },
      validation: {
        cashValidation,
        symbol: processedHolding.symbol,
        averagePriceCalculated: operation.type === 'averaged_purchase'
      },
      processedAt: new Date().toISOString()
    };

    calcLogger.info('Stock purchase processed successfully', {
      symbol: processedHolding.symbol,
      operation: operation.type,
      purchaseAmount: minimumInvestmentValueStock,
      newCashBalance: newCashBalance,
      averagePrice: processedHolding.buyPrice
    });

    return result;
  }

  /**
   * Process stock sale with real-time pricing and profit calculation
   * @param {object} saleData - Sale operation data
   * @param {object} existingHolding - Current holding data
   * @param {number} currentMarketPrice - Real-time market price
   * @param {number} currentCashBalance - Current cash balance
   * @returns {object} Sale processing result
   */
  static processStockSale(saleData, existingHolding, currentMarketPrice, currentCashBalance) {
    const { quantityToSell, saleType = 'partial' } = saleData; // 'partial' or 'complete'
    
    // Debug log at the start of stock sale processing
    calcLogger.debug('Starting stock sale processing', {
      symbol: existingHolding.symbol,
      quantityToSell,
      saleType,
      existingQuantity: existingHolding.quantity,
      buyPrice: existingHolding.buyPrice,
      currentMarketPrice,
      currentCashBalance,
      timestamp: new Date().toISOString(),
      transactionId: `sale-${Date.now()}`
    });

    // Validate inputs
    if (typeof quantityToSell !== 'number' || quantityToSell <= 0) {
      throw new Error(`Invalid quantity to sell: ${quantityToSell}`);
    }

    if (quantityToSell > existingHolding.quantity) {
      throw new Error(
        `Cannot sell ${quantityToSell} shares. Only ${existingHolding.quantity} shares available.`
      );
    }

    if (typeof currentMarketPrice !== 'number' || currentMarketPrice <= 0) {
      throw new Error(`Invalid market price: ${currentMarketPrice}`);
    }

    // Force complete sale if selling all available quantity
    const isCompleteSale = saleType === 'complete' || quantityToSell >= existingHolding.quantity;

    // Calculate P&L using real-time market price
    const pnlResult = this.calculateSellPnL({
      currentQuantity: existingHolding.quantity,
      averagedBuyPrice: existingHolding.buyPrice,
      currentMarketPrice: currentMarketPrice,
      quantityToSell: quantityToSell,
      symbol: existingHolding.symbol,
      originalBuyPrice: existingHolding.originalBuyPrice || existingHolding.buyPrice
    });

    // Calculate new cash balance (add sale proceeds)
    const newCashBalance = currentCashBalance + pnlResult.cashIncrease;

    let updatedHolding;
    let operation;

    if (!isCompleteSale && pnlResult.remainingQuantity > 0) {
      // Partial sale - update holding
      const newInvestment = pnlResult.remainingQuantity * existingHolding.buyPrice;
      
      updatedHolding = {
        ...existingHolding,
        quantity: pnlResult.remainingQuantity,
        minimumInvestmentValueStock: Number(newInvestment.toFixed(2)),
        realizedPnL: (existingHolding.realizedPnL || 0) + pnlResult.realizedPnL,
        status: 'Hold', // Reset to Hold after partial sale
        lastSaleDate: new Date().toISOString(),
        priceHistory: [
          ...(existingHolding.priceHistory || []),
          {
            date: new Date().toISOString(),
            price: currentMarketPrice,
            quantity: -quantityToSell, // Negative for sale
            saleValue: pnlResult.saleValue,
            profitLoss: pnlResult.profitLoss,
            action: 'partial_sell'
          }
        ]
      };

      operation = {
        type: 'partial_sale',
        quantitySold: pnlResult.quantitySold,
        remainingQuantity: pnlResult.remainingQuantity,
        saleValue: pnlResult.saleValue,
        profitLoss: pnlResult.profitLoss
      };

    } else {
      updatedHolding = {
        ...existingHolding,
        quantity: 0,
        minimumInvestmentValueStock: 0,
        weight: 0,
        status: 'Sell',
        realizedPnL: (existingHolding.realizedPnL || 0) + pnlResult.profitLoss,
        soldDate: new Date().toISOString(),
        finalSalePrice: currentMarketPrice,
        totalSaleValue: pnlResult.saleValue,
        totalProfitLoss: pnlResult.profitLoss,
        priceHistory: [
          ...(existingHolding.priceHistory || []),
          {
            date: new Date().toISOString(),
            price: currentMarketPrice,
            quantity: -quantityToSell, // Use actual quantity sold
            saleValue: pnlResult.saleValue,
            profitLoss: pnlResult.profitLoss,
            action: 'complete_sell'
          }
        ],
        lastUpdated: new Date().toISOString()
      };

      operation = {
        type: 'complete_sale',
        quantitySold: quantityToSell, // Use actual quantity sold
        saleValue: pnlResult.saleValue,
        profitLoss: pnlResult.profitLoss,
        positionClosed: true
      };
    }

    const result = {
      success: true,
      updatedHolding,
      operation,
      pnlResult,
      cashImpact: {
        previousBalance: Number(currentCashBalance.toFixed(2)),
        saleProceeds: Number(pnlResult.cashIncrease.toFixed(2)),
        newBalance: Number(newCashBalance.toFixed(2)),
        walletBehavior: true, // Indicates that full sale value is added to cash
        profitAdded: pnlResult.profitLoss > 0,
        profitAmount: Number(Math.max(0, pnlResult.profitLoss).toFixed(2))
      },
      marketData: {
        salePrice: Number(currentMarketPrice),
        averagedBuyPrice: Number(existingHolding.buyPrice),
        originalBuyPrice: Number(existingHolding.originalBuyPrice || existingHolding.buyPrice),
        priceAppreciation: Number(((currentMarketPrice - existingHolding.buyPrice) / existingHolding.buyPrice * 100).toFixed(2))
      },
      processedAt: new Date().toISOString()
    };

    calcLogger.info('Stock sale processed successfully', {
      symbol: existingHolding.symbol,
      operation: operation.type,
      quantitySold: operation.quantitySold,
      saleValue: operation.saleValue,
      profitLoss: operation.profitLoss,
      newCashBalance: newCashBalance,
      isCompleteSale: isCompleteSale
    });

    // Add detailed debug logging for comprehensive transaction tracking
    calcLogger.debug('Stock sale details', {
      timestamp: new Date().toISOString(),
      transactionId: `sale-${Date.now()}`,
      symbol: existingHolding.symbol,
      beforeSale: {
        quantity: existingHolding.quantity,
        buyPrice: existingHolding.buyPrice,
        totalValueAtBuy: existingHolding.quantity * existingHolding.buyPrice,
        cashBalance: currentCashBalance
      },
      sale: {
        quantitySold: operation.quantitySold,
        marketPrice: currentMarketPrice,
        saleValue: operation.saleValue,
        walletAddition: pnlResult.cashIncrease,
        profitLoss: operation.profitLoss,
        profitLossPercent: pnlResult.profitLossPercent
      },
      afterSale: {
        remainingQuantity: isCompleteSale ? 0 : pnlResult.remainingQuantity,
        newCashBalance: newCashBalance,
        totalProfitOrLoss: operation.profitLoss,
        status: isCompleteSale ? 'Sold' : 'Partial Sale'
      },
      walletBehavior: {
        addedToWallet: pnlResult.cashIncrease,
        explanation: 'Full sale amount added to cash balance regardless of profit/loss'
      }
    });

    return result;
  }
}

module.exports = {
  PortfolioCalculationValidator,
  calcLogger
};
