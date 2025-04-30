// routes/portfolio.js
const express = require('express');
const router  = express.Router();
const portfolioController = require('../controllers/portfolioController');
const requireAdmin = require('../middleware/requirreAdmin');
/**
 * @swagger
 * tags:
 *   name: Portfolios
 *   description: Admin-only CRUD for model portfolios
 */

/**
 * @swagger
 * /api/portfolios:
 *   get:
 *     summary: List all portfolios
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of portfolios
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Portfolio'
 *       401:
 *         description: Unauthorized (missing/invalid token)
 */
router.get('/portfolios', requireAdmin, portfolioController.getAllPortfolios);

/**
 * @swagger
 * /api/portfolios/{id}:
 *   get:
 *     summary: Retrieve a portfolio by ID
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the portfolio
 *     responses:
 *       200:
 *         description: A single portfolio
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Portfolio'
 *       404:
 *         description: Not Found
 */
router.get('/portfolios/:id', requireAdmin, portfolioController.getPortfolioById);

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
 *             type: object
 *             required: [name, cashRemaining]
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
 *       201:
 *         description: Portfolio created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Portfolio'
 *       400:
 *         description: Validation error (e.g. duplicate name)
 */
router.post('/portfolios', requireAdmin, portfolioController.createPortfolio);

/**
 * @swagger
 * /api/portfolios/{id}:
 *   put:
 *     summary: Update an existing portfolio
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portfolio ObjectId
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
 *       200:
 *         description: Portfolio updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Portfolio'
 *       400:
 *         description: Validation error
 *       404:
 *         description: Not Found
 */
router.put('/portfolios/:id', requireAdmin, portfolioController.updatePortfolio);

/**
 * @swagger
 * /api/portfolios/{id}:
 *   delete:
 *     summary: Delete a portfolio
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portfolio ObjectId
 *     responses:
 *       200:
 *         description: Portfolio and related data deleted
 *       404:
 *         description: Not Found
 */
router.delete('/portfolios/:id', requireAdmin, portfolioController.deletePortfolio);

module.exports = router;
