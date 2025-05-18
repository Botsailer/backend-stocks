const express = require('express');
const router = express.Router();
const stockSymbolController = require('../controllers/stocksymbolcontroller');

/**
 * @swagger
 * tags:
 *   name: Stock Symbols
 *   description: Endpoints for managing stock symbols and their current prices
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
 *       properties:
 *         _id:
 *           type: string
 *           description: The auto-generated ID of the stock symbol
 *         symbol:
 *           type: string
 *           description: The unique ticker symbol
 *         name:
 *           type: string
 *           description: The company name
 *         currentPrice:
 *           type: string
 *           description: The current stock price
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: The timestamp when the record was created
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: The timestamp when the record was last updated
 *       example:
 *         _id: 60d21b4667d0d8992e610c85
 *         symbol: AAPL
 *         name: Apple Inc.
 *         currentPrice: "150.75"
 *         createdAt: 2023-05-17T15:34:22.000Z
 *         updatedAt: 2023-05-17T15:34:22.000Z
 */

/**
 * @swagger
 * /api/stock-symbols:
 *   post:
 *     summary: Create a new stock symbol
 *     description: Creates a new stock symbol with the provided data
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
 *             properties:
 *               symbol:
 *                 type: string
 *                 description: The stock ticker symbol (will be converted to uppercase)
 *               name:
 *                 type: string
 *                 description: The company name
 *               currentPrice:
 *                 type: string
 *                 description: The current stock price
 *     responses:
 *       201:
 *         description: Stock symbol created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Stock symbol created successfully
 *                 data:
 *                   $ref: '#/components/schemas/StockSymbol'
 *       400:
 *         description: Missing required fields
 *       409:
 *         description: Stock symbol already exists
 *       500:
 *         description: Internal server error
 */
router.post('/', stockSymbolController.createStockSymbol);

/**
 * @swagger
 * /api/stock-symbols:
 *   get:
 *     summary: Get all stock symbols
 *     description: Returns a list of all stock symbols in the database
 *     tags: [Stock Symbols]
 *     responses:
 *       200:
 *         description: List of stock symbols
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                   example: 3
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/StockSymbol'
 *       500:
 *         description: Internal server error
 */
router.get('/', stockSymbolController.getAllStockSymbols);

// /**
//  * @swagger
//  * /api/stock-symbols/ticker/{symbol}:
//  *   get:
//  *     summary: Get stock symbol by ticker
//  *     description: Returns a stock symbol by its ticker symbol
//  *     tags: [Stock Symbols]
//  *     parameters:
//  *       - in: path
//  *         name: symbol
//  *         schema:
//  *           type: string
//  *         required: true
//  *         description: Stock ticker symbol
//  *     responses:
//  *       200:
//  *         description: Stock symbol found
//  *         content:
//  *           application/json:
//  *             schema:
//  *               type: object
//  *               properties:
//  *                 success:
//  *                   type: boolean
//  *                   example: true
//  *                 data:
//  *                   $ref: '#/components/schemas/StockSymbol'
//  *       404:
//  *         description: Stock symbol not found
//  *       500:
//  *         description: Internal server error
//  */
// router.get('/ticker/:symbol', stockSymbolController.getStockSymbolBySymbol);

/**
 * @swagger
 * /api/stock-symbols/{id}:
 *   get:
 *     summary: Get stock symbol by ID
 *     description: Returns a stock symbol by its MongoDB ID
 *     tags: [Stock Symbols]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: MongoDB ID of the stock symbol
 *     responses:
 *       200:
 *         description: Stock symbol found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/StockSymbol'
 *       400:
 *         description: Invalid ID format
 *       404:
 *         description: Stock symbol not found
 *       500:
 *         description: Internal server error
 */
router.get('/:id', stockSymbolController.getStockSymbolById);

/**
 * @swagger
 * /api/stock-symbols/{id}:
 *   put:
 *     summary: Update a stock symbol
 *     description: Updates a stock symbol's information
 *     tags: [Stock Symbols]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: MongoDB ID of the stock symbol
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: The company name
 *               currentPrice:
 *                 type: string
 *                 description: The current stock price
 *     responses:
 *       200:
 *         description: Stock symbol updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Stock symbol updated successfully
 *                 data:
 *                   $ref: '#/components/schemas/StockSymbol'
 *       400:
 *         description: Invalid ID format
 *       404:
 *         description: Stock symbol not found
 *       500:
 *         description: Internal server error
 */
router.put('/:id', stockSymbolController.updateStockSymbol);

/**
 * @swagger
 * /api/stock-symbols/{id}:
 *   delete:
 *     summary: Delete a stock symbol
 *     description: Removes a stock symbol from the database
 *     tags: [Stock Symbols]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: MongoDB ID of the stock symbol
 *     responses:
 *       200:
 *         description: Stock symbol deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Stock symbol deleted successfully
 *       400:
 *         description: Invalid ID format
 *       404:
 *         description: Stock symbol not found
 *       500:
 *         description: Internal server error
 */
router.delete('/:id', stockSymbolController.deleteStockSymbol);

module.exports = (dbAdapter) => router;