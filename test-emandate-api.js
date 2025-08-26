/**
 * Test script for E-Mandate APIs
 * Run with: node test-emandate-api.js
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3012'; // Adjust port as needed
let authToken = '';

// Test data
const testUser = {
  name: "Test User",
  email: "test@example.com",
  phone: "9999999999",
  mandateAmount: 5000
};

async function testAPIs() {
  console.log('🧪 Testing E-Mandate APIs...\n');

  try {
    // 1. Test authentication (you'll need to implement this based on your auth system)
    console.log('1. Authentication Test');
    console.log('⚠️  Please set authToken manually or implement login test');
    console.log('   Example: authToken = "your_jwt_token_here";\n');

    if (!authToken) {
      console.log('❌ Skipping authenticated tests - no auth token provided\n');
      return;
    }

    const headers = {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    };

    // 2. Test e-mandate creation
    console.log('2. Testing E-Mandate Creation');
    try {
      const createResponse = await axios.post(`${BASE_URL}/digio/emandate/create`, testUser, { headers });
      console.log('✅ E-Mandate created:', createResponse.data);
      
      const sessionId = createResponse.data.data?.sessionId;
      if (sessionId) {
        
        // 3. Test status check
        console.log('\n3. Testing Status Check');
        const statusResponse = await axios.get(`${BASE_URL}/digio/status/${sessionId}`, { headers });
        console.log('✅ Status retrieved:', statusResponse.data);

        // 4. Test user e-mandates list
        console.log('\n4. Testing User E-Mandates List');
        const listResponse = await axios.get(`${BASE_URL}/digio/emandate`, { headers });
        console.log('✅ E-Mandates list:', listResponse.data);

        // 5. Test e-mandate check
        console.log('\n5. Testing E-Mandate Check');
        const checkResponse = await axios.get(`${BASE_URL}/digio/emandate/check`, { headers });
        console.log('✅ E-Mandate check:', checkResponse.data);

        // 6. Test cancel (optional)
        console.log('\n6. Testing E-Mandate Cancel');
        const cancelResponse = await axios.post(`${BASE_URL}/digio/emandate/${sessionId}/cancel`, {}, { headers });
        console.log('✅ E-Mandate cancelled:', cancelResponse.data);
      }
    } catch (error) {
      console.log('❌ E-Mandate creation failed:', error.response?.data || error.message);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Test webhook endpoint (no auth required)
async function testWebhook() {
  console.log('\n7. Testing Webhook Endpoint');
  try {
    const webhookData = {
      document_id: "test_doc_123",
      status: "signed",
      event_type: "document.signed",
      txn_id: "test_txn_456"
    };
    
    const webhookResponse = await axios.post(`${BASE_URL}/digio/webhook`, webhookData);
    console.log('✅ Webhook test:', webhookResponse.data);
  } catch (error) {
    console.log('❌ Webhook test failed:', error.response?.data || error.message);
  }
}

// Run tests
async function runAllTests() {
  await testAPIs();
  await testWebhook();
  
  console.log('\n📋 Test Summary:');
  console.log('- Set authToken variable to test authenticated endpoints');
  console.log('- Ensure server is running on the correct port');
  console.log('- Configure Digio credentials in environment variables');
  console.log('- Test the frontend at: http://localhost:3012/digio/emandate/page');
}

runAllTests();