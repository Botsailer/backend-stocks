/**
 * Portfolio Routes
 * ---------------
 * Express router for investment portfolio management (admin-only operations)
 */
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
 *         - price
 *       properties:
 *         symbol:
 *           type: string
 *           description: Stock ticker symbol (e.g., AAPL)
 *           example: "AAPL"
 *         weight:
 *           type: number
 *           format: float
 *           description: Percentage weight of the holding (0-100)
 *           example: 25.5
 *         sector:
 *           type: string
 *           description: Sector classification of the stock (e.g., Technology)
 *           example: "Technology"
 *         status:
 *           type: string
 *           enum: [Hold, Fresh-Buy, partial-sell, addon-buy, Sell]
 *           description: Current transaction status of the holding
 *           example: "Hold"
 *         price:
 *           type: number
 *           format: float
 *           description: Base price per unit recorded at portfolio creation
 *           example: 150.25
 *     Portfolio:
 *       type: object
 *       required:
 *         - name
 *         - subscriptionFee
 *         - minInvestment
 *         - durationMonths
 *         - expiryDate
 *         - holdings
 *       properties:
 *         _id:
 *           type: string
 *           description: Unique identifier for the portfolio
 *           example: "60f5a3ef9f1b2c001c8d4e3a"
 *         name:
 *           type: string
 *           description: Name of the portfolio (must be unique)
 *           example: "Growth Fund"
 *         description:
 *           type: string
 *           description: Detailed description of the portfolio strategy
 *           example: "Aggressive tech-focused fund"
 *         cashRemaining:
 *           type: number
 *           format: float
 *           description: Amount of uninvested cash available
 *           example: 1200.50
 *         subscriptionFee:
 *           type: number
 *           format: float
 *           description: Subscription fee for enrolling in the portfolio
 *           example: 99.99
 *         minInvestment:
 *           type: number
 *           format: float
 *           description: Minimum required investment amount
 *           example: 1000
 *         durationMonths:
 *           type: integer
 *           description: Duration of the portfolio in months
 *           example: 12
 *         expiryDate:
 *           type: string
 *           format: date-time
 *           description: Expiry date (calculated from createdAt + durationMonths if not provided)
 *           example: "2026-02-05T00:00:00.000Z"
 *         holdings:
 *           type: array
 *           description: Array of stock holdings (must sum to 100% weight)
 *           items:
 *             $ref: '#/components/schemas/StockHolding'
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: When the portfolio was created
 *           example: "2023-05-01T10:00:00.000Z" 
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: When the portfolio was last updated
 *           example: "2023-05-10T15:30:00.000Z"
 *       example:
 *         _id: "60f5a3ef9f1b2c001c8d4e3a"
 *         name: "Tech Growth Fund"
 *         description: "Aggressive technology-focused equity portfolio"
 *         cashRemaining: 12000.50
 *         subscriptionFee: 99.99
 *         minInvestment: 5000
 *         durationMonths: 12
 *         expiryDate: "2026-02-05T00:00:00.000Z"
 *         holdings:
 *           - symbol: "AAPL"
 *             weight: 30
 *             sector: "Technology"
 *             status: "Hold"
 *             price: 120.00
 *           - symbol: "GOOGL"
 *             weight: 20
 *             sector: "Communication Services"
 *             status: "Fresh-Buy"
 *             price: 2250.00
 *           - symbol: "MSFT"
 *             weight: 25
 *             sector: "Technology"
 *             status: "Hold"
 *             price: 280.00
 *           - symbol: "NVDA"
 *             weight: 25
 *             sector: "Technology"
 *             status: "Fresh-Buy"
 *             price: 450.00
 *         createdAt: "2023-05-01T10:00:00.000Z"
 *         updatedAt: "2023-05-10T15:30:00.000Z"
 *   responses:
 *     UnauthorizedError:
 *       description: Missing or invalid authentication token
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               error:
 *                 type: string
 *                 example: "Unauthorized - valid authentication token required"
 *     ForbiddenError:
 *       description: Not authorized as admin
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               error:
 *                 type: string
 *                 example: "Forbidden - admin privileges required"
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
 *             example:
 *               - _id: "60f5a3ef9f1b2c001c8d4e3a"
 *                 name: "Tech Growth Fund"
 *                 description: "Aggressive technology-focused equity portfolio"
 *                 cashRemaining: 12000.50
 *                 subscriptionFee: 99.99
 *                 minInvestment: 5000
 *                 durationMonths: 12
 *                 expiryDate: "2026-02-05T00:00:00.000Z"
 *                 holdings: [...]
 *               - _id: "60f5a3ef9f1b2c001c8d4e3b" 
 *                 name: "Value Income Fund"
 *                 description: "Balanced fund focusing on dividends and value investing"
 *                 cashRemaining: 8000
 *                 subscriptionFee: 79.99
 *                 minInvestment: 2500
 *                 durationMonths: 6
 *                 expiryDate: "2025-08-15T00:00:00.000Z"
 *                 holdings: [...]
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '403':
 *         $ref: '#/components/responses/ForbiddenError'
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
 *           example: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *         required: true
 *         description: JWT access token with admin privileges
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *           example: "60f5a3ef9f1b2c001c8d4e3a"
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
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '403':
 *         $ref: '#/components/responses/ForbiddenError'
 *       '404':
 *         description: Portfolio not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Portfolio not found"
 */
router.get('/portfolios/:id', requireAdmin, portfolioController.getPortfolioById);

/**
 * @swagger
 * /api/portfolios:
 *   post:
 *     summary: Create a new portfolio
 *     description: |
 *       Administrators can create a new portfolio with holdings.
 *       
 *       Business rules:
 *       - Portfolio name must be unique
 *       - Total holdings weight must equal exactly 100%
 *       - Each holding must have symbol, weight, sector and price
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
 *               - holdings
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
 *                 description: Initial cash buffer amount
 *                 example: 50000
 *               subscriptionFee:
 *                 type: number
 *                 format: float
 *                 description: Subscription fee for enrolling
 *                 example: 49.99
 *               minInvestment:
 *                 type: number
 *                 format: float
 *                 description: Minimum required investment amount
 *                 example: 1000
 *               durationMonths:
 *                 type: integer
 *                 description: Portfolio duration in months
 *                 example: 6
 *               expiryDate:
 *                 type: string
 *                 format: date-time
 *                 description: Expiry date (calculated from durationMonths if not provided)
 *                 example: "2026-02-05T00:00:00.000Z"
 *               holdings:
 *                 type: array
 *                 description: Initial list of holdings (must sum to exactly 100% weight)
 *                 items:
 *                   $ref: '#/components/schemas/StockHolding'
 *           example:
 *             {
 *               "name": "Dividend Growth Portfolio",
 *               "description": "Focus on companies with consistent dividend growth history",
 *               "cashRemaining": 15000,
 *               "subscriptionFee": 79.99,
 *               "minInvestment": 5000,
 *               "durationMonths": 12,
 *               "holdings": [
 *                 {
 *                   "symbol": "JNJ",
 *                   "weight": 25,
 *                   "sector": "Healthcare",
 *                   "status": "Fresh-Buy",
 *                   "price": 165.75
 *                 },
 *                 {
 *                   "symbol": "PG",
 *                   "weight": 25,
 *                   "sector": "Consumer Staples",
 *                   "status": "Fresh-Buy",
 *                   "price": 148.50
 *                 },
 *                 {
 *                   "symbol": "KO", 
 *                   "weight": 20,
 *                   "sector": "Consumer Staples",
 *                   "status": "Fresh-Buy",
 *                   "price": 62.30
 *                 },
 *                 {
 *                   "symbol": "MSFT",
 *                   "weight": 30,
 *                   "sector": "Technology",
 *                   "status": "Fresh-Buy", 
 *                   "price": 330.75
 *                 }
 *               ]
 *             }
 *     responses:
 *       '201':
 *         description: Portfolio successfully created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Portfolio'
 *       '400':
 *         description: Validation error (duplicate name, incorrect weights, etc.)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Total holdings weight must equal 100%"
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '403':
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.post('/portfolios', requireAdmin, portfolioController.createPortfolio);

/**
 * @swagger
 * /api/portfolios/{id}:
 *   put:
 *     summary: Update an existing portfolio
 *     description: |
 *       Modify portfolio details including holdings.
 *       
 *       Business rules:
 *       - Cannot remove holdings unless their status is 'Sell'
 *       - Total weight must remain 100% if holdings are updated
 *       - Portfolio name must remain unique in the system
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
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *           example: "60f5a3ef9f1b2c001c8d4e3a"
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
 *                 description: Updated portfolio name
 *               description:
 *                 type: string
 *                 description: Updated portfolio description
 *               cashRemaining:
 *                 type: number
 *                 format: float
 *                 description: Updated cash buffer amount
 *               subscriptionFee:
 *                 type: number
 *                 format: float
 *                 description: Updated subscription fee
 *               minInvestment:
 *                 type: number
 *                 format: float
 *                 description: Updated minimum investment amount
 *               durationMonths:
 *                 type: integer
 *                 description: Updated portfolio duration
 *               expiryDate:
 *                 type: string
 *                 format: date-time
 *                 description: Updated expiry date
 *               holdings:
 *                 type: array
 *                 description: Updated list of holdings
 *                 items:
 *                   $ref: '#/components/schemas/StockHolding'
 *           example:
 *             {
 *               "name": "Tech Growth Fund (Updated)",
 *               "description": "Updated portfolio focusing on high-growth tech stocks",
 *               "cashRemaining": 15000,
 *               "subscriptionFee": 109.99,
 *               "holdings": [
 *                 {
 *                   "symbol": "AAPL",
 *                   "weight": 30,
 *                   "sector": "Technology",
 *                   "status": "Hold",
 *                   "price": 175.50
 *                 },
 *                 {
 *                   "symbol": "MSFT", 
 *                   "weight": 30,
 *                   "sector": "Technology",
 *                   "status": "Hold",
 *                   "price": 330.20
 *                 },
 *                 {
 *                   "symbol": "NVDA",
 *                   "weight": 40,
 *                   "sector": "Technology",
 *                   "status": "Fresh-Buy",
 *                   "price": 450.80
 *                 }
 *               ]
 *             }
 *     responses:
 *       '200':
 *         description: Portfolio successfully updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Portfolio'
 *       '400':
 *         description: Invalid input or business rule violation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Can only remove holdings with status Sell"
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '403':
 *         $ref: '#/components/responses/ForbiddenError'
 *       '404':
 *         description: Portfolio not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Portfolio not found"
 */
router.put('/portfolios/:id', requireAdmin, portfolioController.updatePortfolio);

/**
 * @swagger
 * /api/portfolios/{id}:
 *   delete:
 *     summary: Delete a portfolio and its related data
 *     description: |
 *       Removes a portfolio along with all associated price logs.
 *       This operation is permanent and cannot be undone.
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
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *           example: "60f5a3ef9f1b2c001c8d4e3a"
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
 *                   example: "Portfolio and associated logs deleted"
 *       '401':
 *         $ref: '#/components/responses/UnauthorizedError'
 *       '403':
 *         $ref: '#/components/responses/ForbiddenError'
 *       '404':
 *         description: Portfolio not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Portfolio not found"
 */
router.delete('/portfolios/:id', requireAdmin, portfolioController.deletePortfolio);

module.exports = router;