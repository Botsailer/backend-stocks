// routes/stocksymbolroutes.js
const express = require('express');
const router = express.Router();
const {stockSymbolController} = require('../controllers/stocksymbolcontroller');
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
 *           description: Stock exchange identifier
 *           enum:
 *             - NYSE
 *             - NASDAQ
 *             - LSE
 *             - TSE
 *             - HKEX
 *             - SSE
 *             - SZSE
 *             - NSE
 *             - BSE
 *             - ASX
 *             - TSX
 *             - EURONEXT
 *             - XETRA
 *             - SIX
 *             - BIT
 *             - JSE
 *             - MOEX
 *             - KOSPI
 *             - SET
 *             - PSX
 *             - IDX
 *             - KLSE
 *             - SGX
 *             - TASE
 *             - EGX
 *             - BMV
 *             - BVC
 *             - BOVESPA
 *             - MCX
 *             - NCDEX
 *             - ICEX
 *             - CBOT
 *             - CME
 *             - NYMEX
 *             - COMEX
 *             - LME
 *             - ICE
 *             - SHFE
 *             - DCE
 *             - ZCE
 *             - TOCOM
 *             - SAFEX
 *             - EEX
 *             - EUREX
 *             - FOREX
 *             - FX
 *             - CRYPTO
 *             - BINANCE
 *             - COINBASE
 *             - KRAKEN
 *             - BITSTAMP
 *             - MUTUAL
 *             - ETF
 *             - MF
 *             - BOND
 *             - CORPORATE_BOND
 *             - GOVT_BOND
 *             - DERIVATIVES
 *             - FUTURES
 *             - OPTIONS
 *             - ENERGY
 *             - OIL
 *             - GAS
 *             - GOLD
 *             - SILVER
 *             - PLATINUM
 *             - PALLADIUM
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
 *     security:
 *       - bearerAuth: []
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
 *                 description: Stock exchange identifier (see supported list above)
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
router.post('/', requireAdmin, stockSymbolController.createStockSymbol);

/**
 * @swagger
 * /api/stock-symbols:
 *   get:
 *     summary: Get all stock symbols with pagination
 *     tags: [Stock Symbols]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number (default 1)
 *       - in: query
 *         name: limit
 *         schema:
 *          
 *           minimum: 1
 *           maximum: 5000
 *           default: 2500
 *         description: Number of items per page (default 2500, max 5000)
 *     responses:
 *       200:
 *         description: Paginated list of stock symbols
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
 *                   description: Number of items in current page
 *                   example: 2500
 *                 totalCount:
 *                   type: integer
 *                   description: Total number of stock symbols
 *                   example: 5000
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     currentPage:
 *                       type: integer
 *                       example: 1
 *                     totalPages:
 *                       type: integer
 *                       example: 2
 *                     limit:
 *                       type: integer
 *                       example: 2500
 *                     hasNextPage:
 *                       type: boolean
 *                       example: true
 *                     hasPrevPage:
 *                       type: boolean
 *                       example: false
 *                     nextPage:
 *                       type: integer
 *                       nullable: true
 *                       example: 2
 *                     prevPage:
 *                       type: integer
 *                       nullable: true
 *                       example: null
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/StockSymbol'
 *       400:
 *         description: Invalid pagination parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Page number must be greater than 0"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Server error"
 */
router.get('/', stockSymbolController.getAllStockSymbols);


/**
 * @swagger
 * /api/stock-symbols/search:
 *   get:
 *     summary: Search stock symbols by keyword
 *     tags: [Stock Symbols]
 *     parameters:
 *       - in: query
 *         name: keyword
 *         required: true
 *         schema:
 *           type: string
 *         description: Search term (min 2 characters)
 *     responses:
 *       200:
 *         description: List of matching stock symbols
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                       symbol:
 *                         type: string
 *                       name:
 *                         type: string
 *                       exchange:
 *                         type: string
 *                         description: |
 *                           Stock exchange identifier. Supported values:
 *                           NSE, BSE, NYSE, NASDAQ, LSE, TSE, HKEX, SSE, SZSE, ASX, TSX, EURONEXT, XETRA, SIX, BIT, JSE, MOEX, KOSPI, SET, PSX, IDX, KLSE, SGX, TASE, EGX, BMV, BVC, BOVESPA, MCX, NCDEX, ICEX, CBOT, CME, NYMEX, COMEX, LME, ICE, SHFE, DCE, ZCE, TOCOM, SAFEX, EEX, EUREX, FOREX, FX, CRYPTO, BINANCE, COINBASE, KRAKEN, BITSTAMP, MUTUAL, ETF, MF, BOND, CORPORATE_BOND, GOVT_BOND, DERIVATIVES, FUTURES, OPTIONS, ENERGY, OIL, GAS, GOLD, SILVER, PLATINUM, PALLADIUM
 *                     example:
 *                       _id: 60d21b4667d0d8992e610c85
 *                       symbol: AAPL
 *                       name: Apple Inc.
 *                       exchange: NASDAQ
 *       400:
 *         description: Invalid keyword length
 *       500:
 *         description: Internal server error
 */
router.get('/search', stockSymbolController.searchStockSymbols);





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
 *     security:
 *       - bearerAuth: []
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
router.put('/:id', requireAdmin, stockSymbolController.updateStockSymbol);


/**
 * @swagger
 * /api/stock-symbols/{id}:
 *   delete:
 *     summary: Delete a stock symbol
 *     security:
 *       - bearerAuth: []
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
router.delete('/:id', requireAdmin, stockSymbolController.deleteStockSymbol);

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

/**
 * @swagger
 * /api/stock-symbols/benchmarks:
 *   get:
 *     summary: Get all stocks that can be used as benchmarks
 *     description: Returns a list of stocks that are suitable as portfolio benchmarks
 *     tags: [Stock Symbols]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of benchmark stocks
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: number
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/StockSymbol'
 *       500:
 *         description: Server error
 */
router.get('/benchmarks', stockSymbolController.getBenchmarkStocks);

/**
 * @swagger
 * /api/stock-symbols/{id}/history:
 *   get:
 *     summary: Get stock details with price history
 *     description: Returns detailed information about a stock including price history
 *     tags: [Stock Symbols]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: Stock symbol or ID
 *     responses:
 *       200:
 *         description: Stock details with price history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                     symbol:
 *                       type: string
 *                     name:
 *                       type: string
 *                     exchange:
 *                       type: string
 *                     currentPrice:
 *                       type: string
 *                     previousPrice:
 *                       type: string
 *                     priceHistory:
 *                       type: object
 *       404:
 *         description: Stock symbol not found
 *       500:
 *         description: Server error
 */
router.get('/:id/history', stockSymbolController.getStockWithHistory);

/**
 * @swagger
 * /api/stock-symbols/enums:
 *   get:
 *     summary: Get all available enum values for stock symbols
 *     description: Returns lists of all enum values for exchanges, sectors, etc. for use in dropdown menus
 *     tags: [Stock Symbols]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lists of all enum values
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     exchanges:
 *                       type: object
 *                     sectors:
 *                       type: array
 *                       items:
 *                         type: string
 *                     stockCapTypes:
 *                       type: array
 *                       items:
 *                         type: string
 *                     currencies:
 *                       type: array
 *                       items:
 *                         type: string
 *       500:
 *         description: Server error
 */
router.get('/enums', stockSymbolController.getEnumValues);

module.exports = router;