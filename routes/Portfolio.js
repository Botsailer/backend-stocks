// routes/portfolio.js
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
 *         - quantity
 *       properties:
 *         symbol:
 *           type: string
 *           description: Stock ticker symbol (e.g., AAPL)
 *         quantity:
 *           type: number
 *           description: Number of shares held
 *     Portfolio:
 *       type: object
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
 *           description: Amount of uninvested cash in USD
 *         holdings:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/StockHolding'
 *       example:
 *         _id: "60f5a3ef9f1b2c001c8d4e3a"
 *         name: "Tech Growth Fund"
 *         description: "Aggressive technology-focused equity portfolio"
 *         cashRemaining: 12000.50
 *         holdings:
 *           - symbol: "AAPL"
 *             quantity: 50
 *           - symbol: "GOOGL"
 *             quantity: 20
 */

/**
 * @swagger
 * /api/portfolios:
 *   get:
 *     summary: Retrieve all portfolios
 *     description: Returns a list of all portfolios, sorted alphabetically by name. Requires admin privileges.
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Missing or malformed token"
 *       '403':
 *         description: Forbidden - insufficient privileges
 */
router.get('/portfolios', requireAdmin, portfolioController.getAllPortfolios);

/**
 * @swagger
 * /api/portfolios/{id}:
 *   get:
 *     summary: Retrieve a single portfolio by ID
 *     description: Fetches a portfolio including its holdings details. Admin access required.
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
 *         description: Valid JWT token
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: MongoDB ObjectId of the portfolio to retrieve
 *     responses:
 *       '200':
 *         description: Portfolio found and returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Portfolio'
 *       '404':
 *         description: Portfolio not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Not found"
 *       '401':
 *         description: Unauthorized
 */
router.get('/portfolios/:id', requireAdmin, portfolioController.getPortfolioById);

/**
 * @swagger
 * /api/portfolios:
 *   post:
 *     summary: Create a new portfolio
 *     description: Administrators can create a new portfolio. Validates unique name and weight constraints.
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
 *         description: JWT access token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - cashRemaining
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
 *                 description: Initial cash allocation in USD
 *                 example: 50000
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "duplicate key error: name must be unique"
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
 *         description: Admin JWT token
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ObjectId of the portfolio
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Stock removal not allowed unless status=Sell"
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
 *         description: Admin JWT token
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ObjectId of the portfolio to delete
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