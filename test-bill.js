// Simple test script to verify bill generation
const mongoose = require('mongoose');
const { generateAndSendBill } = require('./services/billService');

// Test function
async function testBillGeneration() {
  try {
    console.log('Testing bill generation...');
    
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/your-db-name');
    console.log('Connected to database');
    
    // Find a test subscription
    const Subscription = require('./models/subscription');
    const testSubscription = await Subscription.findOne({ status: 'active' }).populate('user');
    
    if (!testSubscription) {
      console.log('No active subscription found for testing');
      return;
    }
    
    console.log('Found test subscription:', testSubscription._id);
    
    // Generate bill
    const bill = await generateAndSendBill(testSubscription._id, {
      paymentId: 'test_payment_' + Date.now(),
      orderId: 'test_order_' + Date.now()
    });
    
    console.log('Bill generated successfully:', {
      billId: bill._id,
      billNumber: bill.billNumber,
      totalAmount: bill.totalAmount,
      emailSent: bill.emailSent
    });
    
  } catch (error) {
    console.error('Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from database');
  }
}

// Run test if called directly
if (require.main === module) {
  testBillGeneration();
}

module.exports = { testBillGeneration };