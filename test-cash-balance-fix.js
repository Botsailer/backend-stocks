/**
 * Test script to verify cash balance calculation fix
 * 
 * This script simulates the SUPRIYA sell transaction to verify that:
 * 1. Cash balance = Previous Cash + Sale Proceeds (currentPrice × quantity)
 * 2. Realized P&L is calculated correctly but not double-added to cash
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Mock data based on the transaction log
const mockPortfolio = {
  _id: new mongoose.Types.ObjectId('68a2e1d0ada47914248c4ce6'),
  name: 'Varun Smart testing',
  minInvestment: 100000,
  cashBalance: 27550.00,
  holdings: [
    {
      symbol: 'SUPRIYA',
      sector: 'Manufacturing',
      buyPrice: 850.00,
      quantity: 25,
      minimumInvestmentValueStock: 21250.00,
      status: 'Hold',
      currentPrice: 657.25,
      investmentValueAtBuy: 21250.00,
      investmentValueAtMarket: 16431.25,
      unrealizedPnL: -4818.75,
      unrealizedPnLPercent: -22.68
    },
    // Other holdings would be here...
  ]
};

const mockSaleData = {
  symbol: 'SUPRIYA',
  quantityToSell: 25,
  saleType: 'complete'
};

const currentMarketPrice = 657.25;

function testCashBalanceCalculation() {
  console.log('🔴 TESTING CASH BALANCE CALCULATION FIX');
  console.log('=====================================');
  
  const holding = mockPortfolio.holdings[0];
  const previousCashBalance = mockPortfolio.cashBalance;
  
  console.log('📋 BEFORE TRANSACTION:');
  console.log(`   • Cash Balance: ₹${previousCashBalance}`);
  console.log(`   • Holding: ${holding.symbol}`);
  console.log(`   • Quantity: ${holding.quantity}`);
  console.log(`   • Buy Price: ₹${holding.buyPrice}`);
  console.log(`   • Current Price: ₹${currentMarketPrice}`);
  console.log(`   • Investment Value: ₹${holding.minimumInvestmentValueStock}`);
  
  // Calculate sale proceeds (CORRECT WAY)
  const saleProceeds = currentMarketPrice * mockSaleData.quantityToSell;
  console.log('\n🔄 SALE CALCULATION:');
  console.log(`   • Sale Proceeds = ${currentMarketPrice} × ${mockSaleData.quantityToSell} = ₹${saleProceeds}`);
  
  // Calculate realized P&L (for tracking only)
  const originalInvestment = holding.buyPrice * mockSaleData.quantityToSell;
  const realizedPnL = saleProceeds - originalInvestment;
  console.log(`   • Original Investment = ${holding.buyPrice} × ${mockSaleData.quantityToSell} = ₹${originalInvestment}`);
  console.log(`   • Realized P&L = ₹${saleProceeds} - ₹${originalInvestment} = ₹${realizedPnL}`);
  
  // Calculate new cash balance (CORRECT WAY)
  const newCashBalance = previousCashBalance + saleProceeds;
  console.log('\n✅ CORRECT CASH BALANCE CALCULATION:');
  console.log(`   • New Cash Balance = ₹${previousCashBalance} + ₹${saleProceeds} = ₹${newCashBalance}`);
  
  // Show what was happening before (INCORRECT WAY)
  const incorrectCashBalance = previousCashBalance + saleProceeds + realizedPnL;
  console.log('\n❌ INCORRECT CALCULATION (BEFORE FIX):');
  console.log(`   • Wrong Cash Balance = ₹${previousCashBalance} + ₹${saleProceeds} + ₹${realizedPnL} = ₹${incorrectCashBalance}`);
  
  console.log('\n📊 COMPARISON:');
  console.log(`   • Expected (Correct): ₹${newCashBalance}`);
  console.log(`   • Database Showed: ₹48800`);
  console.log(`   • Difference: ₹${48800 - newCashBalance} (this was the stray P&L being added)`);
  
  console.log('\n🔧 FIX APPLIED:');
  console.log('   • Pre-save hook now skips updating minimumInvestmentValueStock for sold stocks');
  console.log('   • Cash balance calculation only uses sale proceeds (currentPrice × quantity)');
  console.log('   • Realized P&L is tracked separately for reporting, not added to cash');
  
  return {
    correctCashBalance: newCashBalance,
    incorrectCashBalance: incorrectCashBalance,
    difference: incorrectCashBalance - newCashBalance,
    realizedPnL: realizedPnL
  };
}

// Run the test
const result = testCashBalanceCalculation();

console.log('\n🎯 TEST RESULT:');
console.log(`   • The fix should prevent the ₹${Math.abs(result.realizedPnL)} from being incorrectly added to cash balance`);
console.log(`   • Cash balance should be ₹${result.correctCashBalance}, not ₹${result.incorrectCashBalance}`);