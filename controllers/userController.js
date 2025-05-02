
/**

controllers/userController.js



*/
const Portfolio = require('../models/modelPortFolio');
const PaymentHistory = require('../models/paymenthistory');

// GET /api/user/portfolios
// Returns [{ _id, name, subscriptionFee, minInvestment, expiryDate }]
exports.listPortfolios = async (req, res) => {
    const list = await Portfolio.find()
        .select('name subscriptionFee minInvestment expiryDate description')
        .sort('name')
        .lean();
    res.json(list);
};


exports.getUserPayments = async (req, res) => {
    const userId = req.user.id;
    const records = await PaymentHistory.find({ user: userId })
        .populate('portfolio', 'name')
        .sort('-createdAt')
        .lean();
    res.json(records);
};


