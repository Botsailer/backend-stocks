// routes/stocksymbolroutes.js
const express = require('express');
const router = express.Router();
const stockSymbolController = require('../controllers/stocksymbolcontroller');
const requireAdmin = require('../middleware/requirreAdmin');

/**
 * @swagger
 * tags:
 *   name: Stock Symbols
 *   description: Endpoints for managing stock symbols and their prices
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     StockSymbol:
 *       type: object
 *       required:
 *         - symbol
 *         - name
 *         - currentPrice
 *         - exchange
 *       properties:
 *         _id:
 *           type: string
 *           description: The auto-generated ID
 *         symbol:
 *           type: string
 *           description: Stock ticker symbol
 *         exchange:
 *           type: string
 *           description: Exchange identifier (NSE, BSE, NYSE, etc.)
 *         name:
 *           type: string
 *           description: Company name
 *         currentPrice:
 *           type: string
 *           description: Current stock price
 *         previousPrice:
 *           type: string
 *           description: Previous stock price
 *         lastUpdated:
 *           type: string
 *           format: date-time
 *           description: Last price update timestamp
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *       example:
 *         _id: 60d21b4667d0d8992e610c85
 *         symbol: AAPL
 *         exchange: NASDAQ
 *         name: Apple Inc.
 *         currentPrice: "150.75"
 *         previousPrice: "149.20"
 *         lastUpdated: "2023-05-17T15:34:22.000Z"
 *         createdAt: 2023-05-17T15:34:22.000Z
 *         updatedAt: 2023-05-17T15:34:22.000Z
 */

/**
 * @swagger
 * /api/stock-symbols:
 *   post:
 *     summary: Create a new stock symbol
 *     tags: [Stock Symbols]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - symbol
 *               - name
 *               - currentPrice
 *               - exchange
 *             properties:
 *               symbol:
 *                 type: string
 *               name:
 *                 type: string
 *               currentPrice:
 *                 type: string
 *               exchange:
 *                 type: string
 *                 description: Stock exchange identifier (e.g., NSE, BSE, NASDAQ)
 *             example:
 *               symbol: "TCS"
 *               name: "Tata Consultancy Services"
 *               currentPrice: "3500.50"
 *               exchange: "NSE"
 *     responses:
 *       201:
 *         description: Stock symbol created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StockSymbol'
 *       400:
 *         description: Missing required fields
 *       409:
 *         description: Symbol already exists for this exchange
 *       500:
 *         description: Internal server error
 */
router.post('/', stockSymbolController.createStockSymbol);

/**
 * @swagger
 * /api/stock-symbols:
 *   get:
 *     summary: Get all stock symbols
 *     tags: [Stock Symbols]
 *     responses:
 *       200:
 *         description: List of stock symbols
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/StockSymbol'
 *       500:
 *         description: Internal server error
 */
router.get('/', stockSymbolController.getAllStockSymbols);

/**
 * @swagger
 * /api/stock-symbols/{id}:
 *   get:
 *     summary: Get stock symbol by ID
 *     tags: [Stock Symbols]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stock symbol data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StockSymbol'
 *       400:
 *         description: Invalid ID format
 *       404:
 *         description: Symbol not found
 *       500:
 *         description: Internal server error
 */
router.get('/:id', stockSymbolController.getStockSymbolById);

/**
 * @swagger
 * /api/stock-symbols/ticker/{symbol}:
 *   get:
 *     summary: Get stock symbol by ticker
 *     tags: [Stock Symbols]
 *     parameters:
 *       - in: path
 *         name: symbol
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stock symbol data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StockSymbol'
 *       404:
 *         description: Symbol not found
 *       500:
 *         description: Internal server error
 */
router.get('/ticker/:symbol', stockSymbolController.getStockSymbolBySymbol);

/**
 * @swagger
 * /api/stock-symbols/{id}:
 *   put:
 *     summary: Update a stock symbol
 *     tags: [Stock Symbols]
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
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               currentPrice:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated stock symbol
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StockSymbol'
 *       400:
 *         description: Invalid ID format
 *       404:
 *         description: Symbol not found
 *       500:
 *         description: Internal server error
 */
router.put('/:id', stockSymbolController.updateStockSymbol);

/**
 * @swagger
 * /api/stock-symbols/{id}:
 *   delete:
 *     summary: Delete a stock symbol
 *     tags: [Stock Symbols]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success message
 *       400:
 *         description: Invalid ID format
 *       404:
 *         description: Symbol not found
 *       500:
 *         description: Internal server error
 */
router.delete('/:id', stockSymbolController.deleteStockSymbol);

/**
 * @swagger
 * /api/stock-symbols/update-prices:
 *   post:
 *     summary: Update stock prices using TradingView API
 *     tags: [Stock Symbols]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Price update results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 updated:
 *                   type: integer
 *                 failed:
 *                   type: integer
 *                 successSymbols:
 *                   type: array
 *                   items:
 *                     type: string
 *                 failedSymbols:
 *                   type: array
 *                   items:
 *                     type: string
 *                 progress:
 *                   type: object
 *                   properties:
 *                     current:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     processed:
 *                       type: integer
 *                     totalSymbols:
 *                       type: integer
 *                 message:
 *                   type: string
 *       404:
 *         description: No stocks found in database
 *       500:
 *         description: Internal server error
 */
router.post('/update-prices', requireAdmin, stockSymbolController.updateStockPrices);

module.exports = router;