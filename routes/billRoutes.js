const express = require('express');
const router = express.Router();
const billController = require('../controllers/billController');
const { authenticateToken } = require('../utils/jwt');
const requireAdmin = require('../middleware/requirreAdmin');

// Bill routes with minimal setup

// Public routes
router.get('/config', billController.getBillingConfig);

// User routes (require authentication)
router.get('/my-bills', authenticateToken, billController.getUserBills);
router.get('/my-bills/stats', authenticateToken, billController.getBillStats);
router.get('/:billId', authenticateToken, billController.getBillById);
router.get('/:billId/download', authenticateToken, billController.downloadBill);
router.get('/:billId/download-html', authenticateToken, billController.downloadBillHTML);
router.post('/:billId/resend-email', authenticateToken, billController.resendBillEmail);

// Admin routes (require admin authentication)
router.post('/generate/:subscriptionId', authenticateToken, requireAdmin, billController.generateBillForSubscription);

// Test routes (development only)
router.post('/test/:subscriptionId', authenticateToken, billController.testBillGeneration);

module.exports = router;