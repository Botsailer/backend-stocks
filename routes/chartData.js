const express = require('express');
const router = express.Router();
const priceLogController = require('../controllers/priceLogController');
const requireAdmin = require('../middleware/requirreAdmin');

/**
 * @swagger
 * tags:
 *   name: ChartData
 *   description: Portfolio performance chart data management
 * components:
 *   schemas:
 *     PriceLog:
 *       type: object
 *       required:
 *         - portfolio
 *         - portfolioValue
 *         - cashRemaining
 *       properties:
 *         portfolio:
 *           type: string
 *           description: Portfolio ID
 *         date:
 *           type: string
 *           format: date-time
 *           description: Date and time of the price log
 *         dateOnly:
 *           type: string
 *           format: date
 *           description: Date (without time) of the price log
 *         portfolioValue:
 *           type: number
 *           description: Total value of the portfolio
 *         cashRemaining:
 *           type: number
 *           description: Cash remaining in the portfolio
 *         compareIndexValue:
 *           type: number
 *           description: Value of the comparison index
 *         compareIndexPriceSource:
 *           type: string
 *           enum: [closing, current, null]
 *           description: Source of the comparison index price
 *         usedClosingPrices:
 *           type: boolean
 *           description: Whether closing prices were used
 *         dataVerified:
 *           type: boolean
 *           description: Whether the data has been verified
 *         dataQualityIssues:
 *           type: array
 *           items:
 *             type: string
 *           description: List of data quality issues
 */

/**
 * @swagger
 * /api/chart-data:
 *   get:
 *     summary: Get all price logs
 *     tags: [ChartData]
 *     parameters:
 *       - in: query
 *         name: portfolioId
 *         schema:
 *           type: string
 *         description: Portfolio ID
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for filtering
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for filtering
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Number of records to return
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of price logs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                 total:
 *                   type: integer
 *                 pagination:
 *                   type: object
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PriceLog'
 */
router.get('/', requireAdmin, priceLogController.getAllPriceLogs);

/**
 * @swagger
 * /api/chart-data/portfolio/{portfolioId}/performance:
 *   get:
 *     summary: Get portfolio performance data
 *     tags: [ChartData]
 *     parameters:
 *       - in: path
 *         name: portfolioId
 *         required: true
 *         schema:
 *           type: string
 *         description: Portfolio ID
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for filtering
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for filtering
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Portfolio performance data
 *       404:
 *         description: Portfolio not found
 */
router.get('/portfolio/:portfolioId/performance', requireAdmin, priceLogController.getPortfolioPerformance);

/**
 * @swagger
 * /api/chart-data/cleanup-duplicates:
 *   post:
 *     summary: Clean up duplicate price logs
 *     tags: [ChartData]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cleanup results
 */
router.post('/cleanup-duplicates', requireAdmin, priceLogController.cleanupDuplicates);

/**
 * @swagger
 * /api/chart-data/{id}:
 *   get:
 *     summary: Get a specific price log
 *     tags: [ChartData]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Price log ID
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Price log details
 *       404:
 *         description: Price log not found
 */
router.get('/:id', requireAdmin, priceLogController.getPriceLogById);

/**
 * @swagger
 * /api/chart-data:
 *   post:
 *     summary: Create a new price log
 *     tags: [ChartData]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PriceLog'
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Price log created
 *       400:
 *         description: Invalid input
 */
router.post('/', requireAdmin, priceLogController.createPriceLog);

/**
 * @swagger
 * /api/chart-data/{id}:
 *   put:
 *     summary: Update a price log
 *     tags: [ChartData]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: Price log ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PriceLog'
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Price log updated
 *       404:
 *         description: Price log not found
 */
router.put('/:id', requireAdmin, priceLogController.updatePriceLog);

/**
 * @swagger
 * /api/chart-data/{id}:
 *   delete:
 *     summary: Delete a price log
 *     tags: [ChartData]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: Price log ID
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Price log deleted
 *       404:
 *         description: Price log not found
 */
router.delete('/:id', requireAdmin, priceLogController.deletePriceLog);

module.exports = router;
