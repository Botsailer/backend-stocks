const DigioSign = require('../models/DigioSign');

/**
 * Middleware to check if user has completed e-mandate before payment
 */
const checkEMandate = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.body.userId;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User authentication required',
        redirectTo: '/auth/login'
      });
    }

    // Check if user has a completed e-mandate
    const completedMandate = await DigioSign.findOne({
      userId: userId,
      status: { $in: ['signed', 'completed'] },
      idType: 'emandate'
    }).sort({ createdAt: -1 });

    if (!completedMandate) {
      return res.status(403).json({
        success: false,
        error: 'E-mandate consent required before payment',
        message: 'Please complete the e-mandate process to authorize automatic payments',
        redirectTo: '/digio/emandate',
        requiresEMandate: true
      });
    }

    // Add mandate info to request for use in payment processing
    req.emandate = completedMandate;
    next();
    
  } catch (error) {
    console.error('E-mandate check error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify e-mandate status',
      message: error.message
    });
  }
};

module.exports = checkEMandate;