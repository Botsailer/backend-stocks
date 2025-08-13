const express = require('express');
const router = express.Router();
const billController = require('../controllers/billController');
const { authenticateToken } = require('../utils/jwt');
const requireAdmin = require('../middleware/requirreAdmin');

// Bill routes with minimal setup

// Public routes
router.get('/config', (req, res) => {
  try {
    const { COMPANY_INFO, TAX_RATE } = require('../config/billConfig');
    res.json({
      success: true,
      config: {
        companyName: COMPANY_INFO.name,
        taxRate: TAX_RATE,
        currency: 'INR'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch billing configuration'
    });
  }
});

// User routes (require authentication)
if (billController.getUserBills) router.get('/my-bills', authenticateToken, billController.getUserBills);
if (billController.getBillStats) router.get('/my-bills/stats', authenticateToken, billController.getBillStats);
if (billController.getBillById) router.get('/:billId', authenticateToken, billController.getBillById);
if (billController.downloadBill) router.get('/:billId/download', authenticateToken, billController.downloadBill);
if (billController.downloadBillHTML) router.get('/:billId/download-html', authenticateToken, billController.downloadBillHTML);
if (billController.resendBillEmail) router.post('/:billId/resend-email', authenticateToken, billController.resendBillEmail);

// Admin routes (require admin authentication)
if (billController.generateBillForSubscription) {
  router.post('/generate/:subscriptionId', authenticateToken, requireAdmin, billController.generateBillForSubscription);
}

// Test routes (development only)
if (process.env.NODE_ENV !== 'production' && billController.testBillGeneration) {
  router.post('/test/:subscriptionId', authenticateToken, billController.testBillGeneration);
}

module.exports = router;