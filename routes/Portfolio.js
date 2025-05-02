// routes/portfolio.js
// -------------------
// Express router for admin-only CRUD operations on Portfolio model

const express = require('express');
const router = express.Router();
const portfolioController = require('../controllers/portfolioController');
const requireAdmin = require('../middleware/requirreAdmin');

/**
 * @swagger
 * tags:
 *   name: Portfolios
 *   description: Admin-only CRUD operations for investment portfolios
 */

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     StockHolding:
 *       type: object
 *       required:
 *         - symbol
 *         - weight
 *         - sector
 *       properties:
 *         symbol:
 *           type: string
 *           description: Stock ticker symbol (e.g., AAPL)
 *         weight:
 *           type: number
 *           format: float
 *           description: Percentage weight of the holding (0-100)
 *         sector:
 *           type: string
 *           description: Sector classification of the stock (e.g., Technology)
 *         status:
 *           type: string
 *           enum: [Hold, Fresh-Buy, partial-sell, addon-buy, Sell]
 *           description: Current transaction status of the holding
 *     Portfolio:
 *       type: object
 *       required:
 *         - name
 *         - subscriptionFee
 *         - minInvestment
 *         - durationMonths
 *         - expiryDate
 *       properties:
 *         _id:
 *           type: string
 *           description: Unique identifier for the portfolio
 *         name:
 *           type: string
 *           description: Name of the portfolio
 *         description:
 *           type: string
 *           description: Detailed description of the portfolio strategy
 *         cashRemaining:
 *           type: number
 *           format: float
 *           description: Amount of uninvested cash in USD
 *         subscriptionFee:
 *           type: number
 *           format: float
 *           description: Subscription fee for enrolling in the portfolio
 *         minInvestment:
 *           type: number
 *           format: float
 *           description: Minimum required investment in USD
 *         durationMonths:
 *           type: integer
 *           description: Duration of the portfolio in months
 *         expiryDate:
 *           type: string
 *           format: date-time
 *           description: Automatically computed expiry date (createdAt + durationMonths)
 *         holdings:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/StockHolding'
 *       example:
 *         _id: "60f5a3ef9f1b2c001c8d4e3a"
 *         name: "Tech Growth Fund"
 *         description: "Aggressive technology-focused equity portfolio"
 *         cashRemaining: 12000.50
 *         subscriptionFee: 99.99
 *         minInvestment: 1000
 *         durationMonths: 12
 *         expiryDate: "2026-02-05T00:00:00.000Z"
 *         holdings:
 *           - symbol: "AAPL"
 *             weight: 30
 *             sector: "Technology"
 *             status: "Hold"
 *           - symbol: "GOOGL"
 *             weight: 20
 *             sector: "Communication Services"
 *             status: "Fresh-Buy"
 */

/**
 * @swagger
 * /api/portfolios:
 *   get:
 *     summary: Retrieve all portfolios
 *     description: Returns a list of all portfolios, sorted alphabetically by name. Admin privileges required.
 *     tags:
 *       - Portfolios
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         schema:
 *           type: string
 *           example: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *         required: true
 *         description: JWT access token with admin privileges
 *     responses:
 *       '200':
 *         description: A JSON array of portfolio objects
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Portfolio'
 *       '401':
 *         description: Unauthorized or missing token
 *       '403':
 *         description: Forbidden - insufficient privileges
 */
router.get('/portfolios', requireAdmin, portfolioController.getAllPortfolios);

/**
 * @swagger
 * /api/portfolios/{id}:
 *   get:
 *     summary: Retrieve a portfolio by ID
 *     description: Fetches a single portfolio including its holdings. Admin privileges required.
 *     tags:
 *       - Portfolios
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         schema:
 *           type: string
 *           example: "Bearer <JWT>"
 *         required: true
 *         description: JWT access token with admin privileges
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: MongoDB ObjectId of the portfolio
 *     responses:
 *       '200':
 *         description: Portfolio found and returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Portfolio'
 *       '401':
 *         description: Unauthorized or missing token
 *       '403':
 *         description: Forbidden - insufficient privileges
 *       '404':
 *         description: Portfolio not found
 */
router.get('/portfolios/:id', requireAdmin, portfolioController.getPortfolioById);

/**
 * @swagger
 * /api/portfolios:
 *   post:
 *     summary: Create a new portfolio
 *     description: Administrators can create a new portfolio. Validates unique name and holding weight constraints.
 *     tags:
 *       - Portfolios
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         schema:
 *           type: string
 *           example: "Bearer <JWT>"
 *         required: true
 *         description: JWT access token with admin privileges
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - subscriptionFee
 *               - minInvestment
 *               - durationMonths
 *               - expiryDate
 *             properties:
 *               name:
 *                 type: string
 *                 description: Unique name for the portfolio
 *                 example: "Balanced Income Fund"
 *               description:
 *                 type: string
 *                 description: Detailed description of investment strategy
 *                 example: "Medium-risk balanced fund with dividend focus"
 *               cashRemaining:
 *                 type: number
 *                 format: float
 *                 description: Initial cash allocation in USD
 *                 example: 50000
 *               subscriptionFee:
 *                 type: number
 *                 format: float
 *                 description: Subscription fee for enrolling in the portfolio
 *                 example: 49.99
 *               minInvestment:
 *                 type: number
 *                 format: float
 *                 description: Minimum required investment in USD
 *                 example: 1000
 *               durationMonths:
 *                 type: integer
 *                 description: Duration of the portfolio in months
 *                 example: 6
 *               expiryDate:
 *                 type: string
 *                 format: date-time
 *                 description: Manually set expiry date or omitted to auto-calculate
 *               holdings:
 *                 type: array
 *                 description: List of initial stock holdings
 *                 items:
 *                   $ref: '#/components/schemas/StockHolding'
 *     responses:
 *       '201':
 *         description: Portfolio successfully created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Portfolio'
 *       '400':
 *         description: Validation error or duplicate name
 */
router.post('/portfolios', requireAdmin, portfolioController.createPortfolio);

/**
 * @swagger
 * /api/portfolios/{id}:
 *   put:
 *     summary: Update an existing portfolio
 *     description: Modify portfolio details. Business rules enforced on holdings updates.
 *     tags:
 *       - Portfolios
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         schema:
 *           type: string
 *           example: "Bearer <JWT>"
 *         required: true
 *         description: JWT access token with admin privileges
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: MongoDB ObjectId of the portfolio to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               cashRemaining:
 *                 type: number
 *                 format: float
 *               subscriptionFee:
 *                 type: number
 *                 format: float
 *               minInvestment:
 *                 type: number
 *                 format: float
 *               durationMonths:
 *                 type: integer
 *               expiryDate:
 *                 type: string
 *                 format: date-time
 *               holdings:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/StockHolding'
 *     responses:
 *       '200':
 *         description: Portfolio successfully updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Portfolio'
 *       '400':
 *         description: Invalid input or business rule violation
 *       '404':
 *         description: Portfolio not found
 */
router.put('/portfolios/:id', requireAdmin, portfolioController.updatePortfolio);

/**
 * @swagger
 * /api/portfolios/{id}:
 *   delete:
 *     summary: Delete a portfolio and its related data
 *     description: Removes a portfolio along with all associated tips and price logs.
 *     tags:
 *       - Portfolios
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         schema:
 *           type: string
 *           example: "Bearer <JWT>"
 *         required: true
 *         description: JWT access token with admin privileges
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: MongoDB ObjectId of portfolio to delete
 *     responses:
 *       '200':
 *         description: Portfolio and related data deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Portfolio and related data deleted"
 *       '404':
 *         description: Portfolio not found
 */
router.delete('/portfolios/:id', requireAdmin, portfolioController.deletePortfolio);

module.exports = router;
