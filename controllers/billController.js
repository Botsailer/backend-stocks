const Bill = require('../models/bill');
const { 
  generateBill, 
  generateBillHTML, 
  sendBillEmail, 
  generateAndSendBill, 
  getUserBills 
} = require('../services/billService');
const winston = require('winston');

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/bill-controller.log' })
  ]
});

/**
 * Get user's bills
 */
exports.getUserBills = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10, status } = req.query;

    const result = await getUserBills(userId, { 
      page: parseInt(page), 
      limit: parseInt(limit), 
      status 
    });

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error('Error in getUserBills controller', { 
      userId: req.user._id, 
      error: error.message 
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch bills'
    });
  }
};

/**
 * Get specific bill by ID
 */
exports.getBillById = async (req, res) => {
  try {
    const { billId } = req.params;
    const userId = req.user._id;

    const bill = await Bill.findOne({ 
      _id: billId, 
      user: userId 
    }).populate('subscription');

    if (!bill) {
      return res.status(404).json({
        success: false,
        error: 'Bill not found'
      });
    }

    res.json({
      success: true,
      bill
    });

  } catch (error) {
    logger.error('Error in getBillById controller', { 
      billId: req.params.billId, 
      error: error.message 
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch bill'
    });
  }
};

/**
 * Download bill as HTML
 */
exports.downloadBill = async (req, res) => {
  try {
    const { billId } = req.params;
    const userId = req.user._id;

    const bill = await Bill.findOne({ 
      _id: billId, 
      user: userId 
    }).populate('subscription');

    if (!bill) {
      return res.status(404).json({
        success: false,
        error: 'Bill not found'
      });
    }

    const htmlContent = generateBillHTML(bill);

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice-${bill.billNumber}.html"`);
    res.send(htmlContent);

  } catch (error) {
    logger.error('Error in downloadBill controller', { 
      billId: req.params.billId, 
      error: error.message 
    });
    res.status(500).json({
      success: false,
      error: 'Failed to download bill'
    });
  }
};

/**
 * Resend bill email
 */
exports.resendBillEmail = async (req, res) => {
  try {
    const { billId } = req.params;
    const userId = req.user._id;

    // Verify bill ownership
    const bill = await Bill.findOne({ 
      _id: billId, 
      user: userId 
    });

    if (!bill) {
      return res.status(404).json({
        success: false,
        error: 'Bill not found'
      });
    }

    await sendBillEmail(billId);

    res.json({
      success: true,
      message: 'Bill email sent successfully'
    });

  } catch (error) {
    logger.error('Error in resendBillEmail controller', { 
      billId: req.params.billId, 
      error: error.message 
    });
    res.status(500).json({
      success: false,
      error: 'Failed to send bill email'
    });
  }
};

/**
 * Generate bill for subscription (Admin only)
 */
exports.generateBillForSubscription = async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    const { paymentId, orderId } = req.body;

    const paymentDetails = {};
    if (paymentId) paymentDetails.paymentId = paymentId;
    if (orderId) paymentDetails.orderId = orderId;

    const bill = await generateAndSendBill(subscriptionId, paymentDetails);

    res.json({
      success: true,
      message: 'Bill generated and sent successfully',
      bill: {
        id: bill._id,
        billNumber: bill.billNumber,
        totalAmount: bill.totalAmount,
        status: bill.status
      }
    });

  } catch (error) {
    logger.error('Error in generateBillForSubscription controller', { 
      subscriptionId: req.params.subscriptionId, 
      error: error.message 
    });
    res.status(500).json({
      success: false,
      error: 'Failed to generate bill'
    });
  }
};

/**
 * Test bill generation (Development only)
 */
exports.testBillGeneration = async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        error: 'Test endpoints not available in production'
      });
    }

    const { subscriptionId } = req.params;
    
    const bill = await generateAndSendBill(subscriptionId, {
      paymentId: 'test_payment_' + Date.now(),
      orderId: 'test_order_' + Date.now()
    });

    res.json({
      success: true,
      message: 'Test bill generated successfully',
      bill: {
        id: bill._id,
        billNumber: bill.billNumber,
        totalAmount: bill.totalAmount,
        status: bill.status,
        emailSent: bill.emailSent
      }
    });

  } catch (error) {
    logger.error('Error in testBillGeneration controller', { 
      subscriptionId: req.params.subscriptionId, 
      error: error.message 
    });
    res.status(500).json({
      success: false,
      error: 'Failed to generate test bill'
    });
  }
};

/**
 * Get bill statistics for user
 */
exports.getBillStats = async (req, res) => {
  try {
    const userId = req.user._id;

    const stats = await Bill.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' }
        }
      }
    ]);

    const totalBills = await Bill.countDocuments({ user: userId });
    const totalAmount = await Bill.aggregate([
      { $match: { user: userId } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);

    res.json({
      success: true,
      stats: {
        totalBills,
        totalAmount: totalAmount[0]?.total || 0,
        byStatus: stats.reduce((acc, stat) => {
          acc[stat._id] = {
            count: stat.count,
            amount: stat.totalAmount
          };
          return acc;
        }, {})
      }
    });

  } catch (error) {
    logger.error('Error in getBillStats controller', { 
      userId: req.user._id, 
      error: error.message 
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch bill statistics'
    });
  }
};

/**
 * Get billing configuration (public)
 */
exports.getBillingConfig = async (req, res) => {
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
    logger.error('Error in getBillingConfig controller', { 
      error: error.message 
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch billing configuration'
    });
  }
};

module.exports = exports;