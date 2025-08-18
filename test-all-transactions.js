/**
 * Test all transaction types to verify cash balance calculations
 */

function testAllTransactions() {
  console.log('🧪 TESTING ALL TRANSACTION TYPES');
  console.log('=================================\n');

  // Initial state
  let cashBalance = 50000;
  let minInvestment = 100000;
  
  console.log('📊 INITIAL STATE:');
  console.log(`   Cash Balance: ₹${cashBalance}`);
  console.log(`   Min Investment: ₹${minInvestment}\n`);

  // 1. FRESH BUY
  console.log('1️⃣ FRESH BUY (ABC @ ₹100, qty: 50)');
  const buyPrice1 = 100;
  const qty1 = 50;
  const investment1 = buyPrice1 * qty1; // ₹5000
  cashBalance -= investment1;
  console.log(`   Cash Balance: ₹${cashBalance} (reduced by investment cost)`);
  console.log(`   Holdings: ABC - ${qty1} @ ₹${buyPrice1} = ₹${investment1}\n`);

  // 2. ADDON BUY (same stock)
  console.log('2️⃣ ADDON BUY (ABC @ ₹120, qty: 25)');
  const buyPrice2 = 120;
  const qty2 = 25;
  const investment2 = buyPrice2 * qty2; // ₹3000
  cashBalance -= investment2;
  const totalQty = qty1 + qty2; // 75
  const avgPrice = (investment1 + investment2) / totalQty; // ₹106.67
  console.log(`   Cash Balance: ₹${cashBalance} (reduced by additional investment)`);
  console.log(`   Holdings: ABC - ${totalQty} @ ₹${avgPrice.toFixed(2)} avg = ₹${investment1 + investment2}\n`);

  // 3. PARTIAL SELL
  console.log('3️⃣ PARTIAL SELL (ABC @ ₹130, qty: 25)');
  const sellPrice1 = 130;
  const sellQty1 = 25;
  const saleProceeds1 = sellPrice1 * sellQty1; // ₹3250
  const remainingQty = totalQty - sellQty1; // 50
  const realizedPnL1 = saleProceeds1 - (avgPrice * sellQty1); // ₹583.25
  cashBalance += saleProceeds1; // ONLY sale proceeds added
  console.log(`   Sale Proceeds: ₹${saleProceeds1} (${sellPrice1} × ${sellQty1})`);
  console.log(`   Realized P&L: ₹${realizedPnL1.toFixed(2)} (for tracking only)`);
  console.log(`   Cash Balance: ₹${cashBalance} (increased by sale proceeds only)`);
  console.log(`   Holdings: ABC - ${remainingQty} @ ₹${avgPrice.toFixed(2)} avg\n`);

  // 4. COMPLETE SELL
  console.log('4️⃣ COMPLETE SELL (ABC @ ₹140, qty: 50)');
  const sellPrice2 = 140;
  const sellQty2 = remainingQty;
  const saleProceeds2 = sellPrice2 * sellQty2; // ₹7000
  const realizedPnL2 = saleProceeds2 - (avgPrice * sellQty2); // ₹1666.5
  cashBalance += saleProceeds2; // ONLY sale proceeds added
  console.log(`   Sale Proceeds: ₹${saleProceeds2} (${sellPrice2} × ${sellQty2})`);
  console.log(`   Realized P&L: ₹${realizedPnL2.toFixed(2)} (for tracking only)`);
  console.log(`   Cash Balance: ₹${cashBalance} (increased by sale proceeds only)`);
  console.log(`   Holdings: ABC - SOLD\n`);

  // 5. NEW STOCK BUY
  console.log('5️⃣ NEW STOCK BUY (XYZ @ ₹200, qty: 30)');
  const buyPrice3 = 200;
  const qty3 = 30;
  const investment3 = buyPrice3 * qty3; // ₹6000
  cashBalance -= investment3;
  console.log(`   Cash Balance: ₹${cashBalance} (reduced by investment cost)`);
  console.log(`   Holdings: XYZ - ${qty3} @ ₹${buyPrice3} = ₹${investment3}\n`);

  // VERIFICATION
  console.log('✅ VERIFICATION:');
  const totalRealizedPnL = realizedPnL1 + realizedPnL2;
  const totalInvested = investment3; // Only XYZ remaining
  const expectedCash = minInvestment - totalInvested + totalRealizedPnL;
  
  console.log(`   Total Realized P&L: ₹${totalRealizedPnL.toFixed(2)}`);
  console.log(`   Current Holdings Value: ₹${totalInvested}`);
  console.log(`   Expected Cash: ₹${minInvestment} - ₹${totalInvested} + ₹${totalRealizedPnL.toFixed(2)} = ₹${expectedCash.toFixed(2)}`);
  console.log(`   Actual Cash: ₹${cashBalance}`);
  console.log(`   Match: ${Math.abs(expectedCash - cashBalance) < 0.01 ? '✅ YES' : '❌ NO'}\n`);

  console.log('🔑 KEY PRINCIPLES:');
  console.log('   • BUY: Cash -= (buyPrice × quantity)');
  console.log('   • SELL: Cash += (currentPrice × quantity)');
  console.log('   • P&L: Tracked separately, not added to cash');
  console.log('   • minimumInvestmentValueStock: Only updated for active holdings');
}

testAllTransactions();