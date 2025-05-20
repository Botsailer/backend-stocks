const express = require('express');
const router = express.Router();
const portfolioController = require('../controllers/portfolioController');
const requireAdmin = require('../middleware/requirreAdmin');

/**
 * @swagger
 * tags:
 *   name: Portfolios
 *   description: Investment portfolio management
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     DownloadLink:
 *       type: object
 *       required:
 *         - link
 *       properties:
 *         link:
 *           type: string
 *           example: "https://example.com/prospectus.pdf"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           readOnly: true
 *     StockHolding:
 *       type: object
 *       required:
 *         - symbol
 *         - weight
 *         - sector
 *         - price
 *       properties:
 *         symbol:
 *           type: string
 *           example: "AAPL"
 *         weight:
 *           type: number
 *           format: float
 *           example: 25.5
 *         sector:
 *           type: string
 *           example: "Technology"
 *         status:
 *           type: string
 *           enum: [Hold, Fresh-Buy, partial-sell, addon-buy, Sell]
 *           example: "Hold"
 *         price:
 *           type: number
 *           format: float
 *           example: 150.25
 *     Portfolio:
 *       type: object
 *       required:
 *         - name
 *         - subscriptionFee
 *         - minInvestment
 *         - durationMonths
 *       properties:
 *         name:
 *           type: string
 *           example: "Growth Fund"
 *         description:
 *           type: string
 *           example: "Aggressive tech-focused fund"
 *         cashRemaining:
 *           type: number
 *           example: 1200.50
 *         subscriptionFee:
 *           type: number
 *           example: 99.99
 *         minInvestment:
 *           type: number
 *           example: 1000
 *         durationMonths:
 *           type: integer
 *           example: 12
 *         expiryDate:
 *           type: string
 *           format: date-time
 *           example: "2026-02-05T00:00:00.000Z"
 *         PortfolioCategory:
 *           type: string
 *           example: "Premium"
 *         timeHorizon:
 *           type: string
 *           example: "5 years"
 *         rebalancing:
 *           type: string
 *           example: "Quarterly"
 *         index:
 *           type: string
 *           example: "Nifty 50"
 *         details:
 *           type: string
 *           example: "Focused on high-growth technology stocks"
 *         monthlyGains:
 *           type: string
 *           example: "2%"
 *         CAGRSinceInception:
 *           type: string
 *           example: "12%"
 *         oneYearGains:
 *           type: string
 *           example: "15%"
 *         holdings:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/StockHolding'
 *         downloadLinks:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/DownloadLink'
 *   responses:
 *     Unauthorized:
 *       description: Missing or invalid token
 *     Forbidden:
 *       description: Not an admin
 */

// ================================
// @route   GET /api/portfolios
// @desc    Get all portfolios
// ================================
/**
 * @swagger
 * /api/portfolios:
 *   get:
 *     summary: Get all portfolios
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of portfolios
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Portfolio'
 */
router.get('/portfolios', requireAdmin, portfolioController.getAllPortfolios);

// ================================
// @route   GET /api/portfolios/:id
// @desc    Get a single portfolio by ID
// ================================
/**
 * @swagger
 * /api/portfolios/{id}:
 *   get:
 *     summary: Get portfolio by ID
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Portfolio data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Portfolio'
 *       404:
 *         description: Portfolio not found
 */
router.get('/portfolios/:id', requireAdmin, portfolioController.getPortfolioById);

// ================================
// @route   POST /api/portfolios
// @desc    Create a new portfolio
// ================================
/**
 * @swagger
 * /api/portfolios:
 *   post:
 *     summary: Create a new portfolio
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Portfolio'
 *           example:
 *             name: "Tech Growth"
 *             description: "Tech focused portfolio"
 *             subscriptionFee: 149.99
 *             minInvestment: 5000
 *             durationMonths: 12
 *             PortfolioCategory: "Premium"
 *             timeHorizon: "3 years"
 *             rebalancing: "Monthly"
 *             index: "NASDAQ 100"
 *             details: "AI & cloud based companies"
 *             monthlyGains: "1.2%"
 *             CAGRSinceInception: "11.3%"
 *             oneYearGains: "14.7%"
 *             holdings:
 *               - symbol: "TSLA"
 *                 weight: 40
 *                 sector: "Automotive"
 *                 price: 250.50
 *             downloadLinks:
 *               - link: "https://example.com/tech-growth.pdf"
 *     responses:
 *       201:
 *         description: Created portfolio
 */
router.post('/portfolios', requireAdmin, portfolioController.createPortfolio);

// ================================
// @route   PUT /api/portfolios/:id
// @desc    Update portfolio
// ================================
/**
 * @swagger
 * /api/portfolios/{id}:
 *   put:
 *     summary: Update portfolio by ID
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Portfolio'
 *           example:
 *             name: "Updated Tech Growth"
 *             downloadLinks:
 *               - link: "https://new.example.com/updated-docs.pdf"
 *     responses:
 *       200:
 *         description: Portfolio updated successfully
 *       400:
 *         description: Validation error
 */
router.put('/portfolios/:id', requireAdmin, portfolioController.updatePortfolio);

// ================================
// @route   DELETE /api/portfolios/:id
// @desc    Delete portfolio and related price logs
// ================================
/**
 * @swagger
 * /api/portfolios/{id}:
 *   delete:
 *     summary: Delete portfolio by ID
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Portfolio and associated logs deleted
 *       404:
 *         description: Portfolio not found
 */
router.delete('/portfolios/:id', requireAdmin, portfolioController.deletePortfolio);

module.exports = router;
