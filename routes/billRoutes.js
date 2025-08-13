const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../utils/jwt');

// Simple config route
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

// Placeholder routes to prevent errors
router.get('/my-bills', authenticateToken, (req, res) => {
  res.json({ success: true, bills: [], message: 'Bill feature coming soon' });
});

router.get('/my-bills/stats', authenticateToken, (req, res) => {
  res.json({ success: true, stats: { totalBills: 0, totalAmount: 0 } });
});

router.get('/:billId', authenticateToken, (req, res) => {
  res.status(404).json({ success: false, error: 'Bill not found' });
});

router.get('/:billId/download', authenticateToken, (req, res) => {
  res.status(404).json({ success: false, error: 'Bill not found' });
});

module.exports = router;