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

/**
 * @swagger
 * /api/portfolios:
 *   post:
 *     summary: Create new portfolio
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

/**
 * @swagger
 * /api/portfolios/{id}:
 *   put:
 *     summary: Update portfolio
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
 *         description: Updated portfolio
 *       400:
 *         description: Validation error
 */
router.put('/portfolios/:id', requireAdmin, portfolioController.updatePortfolio);

/**
 * @swagger
 * /api/portfolios/{id}:
 *   delete:
 *     summary: Delete portfolio
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
 *         description: Portfolio deleted
 *       404:
 *         description: Portfolio not found
 */
router.delete('/portfolios/:id', requireAdmin, portfolioController.deletePortfolio);

module.exports = router;