const express = require('express');
const router = express.Router();
const portfolioController = require('../controllers/portfolioController');
const chartDataController = require('../controllers/chartDataController');
const requireAdmin = require('../middleware/requirreAdmin');
const cronController = require('../controllers/portfoliocroncontroller');



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
 *     SubscriptionFee:
 *       type: object
 *       required:
 *         - type
 *         - price
 *       properties:
 *         type:
 *           type: string
 *           enum: 
 *             - monthly
 *             - quarterly
 *             - yearly
 *           description: Subscription interval
 *           example: "yearly"
 *         price:
 *           type: number
 *           format: float
 *           example: 149.99
 *     DescriptionItem:
 *       type: object
 *       required:
 *         - key
 *         - value
 *       properties:
 *         key:
 *           type: string
 *           example: "Investment Strategy"
 *         value:
 *           type: string
 *           example: "Long-term growth focused"
 *     DownloadLink:
 *       type: object
 *       required:
 *         - linkType
 *         - linkUrl
 *       properties:
 *         linkType:
 *           type: string
 *           example: "pdf"
 *         linkUrl:
 *           type: string
 *           example: "https://example.com/prospectus.pdf"
 *         linkDiscription:
 *           type: string
 *           example: "Portfolio prospectus"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           readOnly: true
 *     YouTubeLink:
 *       type: object
 *       required:
 *         - link
 *       properties:
 *         link:
 *           type: string
 *           example: "https://youtube.com/watch?v=abc123"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           readOnly: true
 *     StockHolding:
 *       type: object
 *       required:
 *         - symbol
 *         - sector
 *         - buyPrice
 *         - quantity
 *         - minimumInvestmentValueStock
 *       properties:
 *         symbol:
 *           type: string
 *           example: "AAPL"
 *         weight:
 *           type: number
 *           format: float
 *           example: 25.5
 *           readOnly: true
 *         sector:
 *           type: string
 *           example: "Technology"
 *         stockCapType:
 *           type: string
 *           enum: 
 *             - small cap
 *             - mid cap
 *             - large cap
 *             - micro cap
 *             - mega cap
 *           description: Market capitalization category of the stock
 *           example: "large cap"
 *         status:
 *           type: string
 *           enum: 
 *             - Hold
 *             - Fresh-Buy
 *             - partial-sell
 *             - addon-buy
 *             - Sell
 *           description: Current recommendation status
 *           example: "Hold"
 *         buyPrice:
 *           type: number
 *           format: float
 *           example: 150.25
 *         quantity:
 *           type: number
 *           format: float
 *           example: 10.5
 *         minimumInvestmentValueStock:
 *           type: number
 *           example: 1000
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
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/DescriptionItem'
 *           example:
 *             - key: "Objective"
 *               value: "Capital appreciation"
 *             - key: "Risk Level"
 *               value: "High"
 *         cashBalance:
 *           type: number
 *           example: 1200.50
 *           readOnly: true
 *         currentValue:
 *           type: number
 *           example: 10500.75
 *           readOnly: true
 *         subscriptionFee:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SubscriptionFee'
 *           example:
 *             - type: "monthly"
 *               price: 19.99
 *             - type: "yearly"
 *               price: 199.99
 *         minInvestment:
 *           type: number
 *           example: 1000
 *           readOnly: true
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
 *         lastRebalanceDate:
 *           type: string
 *           format: date-time
 *           example: "2026-02-05T00:00:00.000Z"
 *         nextRebalanceDate:
 *           type: string
 *           format: date-time
 *           example: "2026-05-05T00:00:00.000Z"
 *         monthlyContribution:
 *           type: number
 *           format: integer
 *           example: 500
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
 *         compareWith:
 *           type: string
 *           description: Benchmark symbol or ID to compare performance against
 *           example: "NIFTY50"
 *         holdings:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/StockHolding'
 *         downloadLinks:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/DownloadLink'
 *         youTubeLinks:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/YouTubeLink'
 *         holdingsValue:
 *           type: number
 *           example: 9300.25
 *           readOnly: true
 *   responses:
 *     Unauthorized:
 *       description: Missing or invalid token
 *     Forbidden:
 *       description: Not an admin
 *     AllocationExceeded:
 *       description: Total stock allocation exceeds minimum investment
 *     NotFound:
 *       description: Resource not found
 *     BadRequest:
 *       description: Validation error or invalid input
 */

// ================================
// Portfolio CRUD Operations
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
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/portfolios', requireAdmin, portfolioController.getAllPortfolios);




/**
 * @swagger
 * /api/portfolios/{id}/price-history:
 *   get:
 *     summary: Get portfolio price history for charting
 *     tags: [Portfolios]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portfolio ID
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [1w, 1m, 3m, 6m, 1y, all]
 *         description: Time period for historical data
 *     responses:
 *       200:
 *         description: Portfolio price history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 portfolioId:
 *                   type: string
 *                 period:
 *                   type: string
 *                 dataPoints:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         format: date-time
 *                       value:
 *                         type: number
 *                       cash:
 *                         type: number
 *                       change:
 *                         type: number
 *                       changePercent:
 *                         type: number
 *       400:
 *         description: Invalid portfolio ID
 *       404:
 *         description: No price history found
 *       500:
 *         description: Server error
 */
router.get('/portfolios/:id/price-history', portfolioController.getPortfolioPriceHistory);


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
 *         description: Portfolio ID
 *     responses:
 *       200:
 *         description: Portfolio data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Portfolio'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
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
 *             $ref: '#/components/schemas/Portfolio'
 *           example:
 *             name: "Tech Growth"
 *             description: 
 *               - key: "Strategy"
 *                 value: "Tech focused"
 *               - key: "Risk"
 *                 value: "High"
 *             subscriptionFee:
 *               - type: "monthly"
 *                 price: 19.99
 *               - type: "yearly"
 *                 price: 199.99
 *             minInvestment: 5000
 *             durationMonths: 12
 *             PortfolioCategory: "Premium"
 *             holdings:
 *               - symbol: "TSLA"
 *                 sector: "Automotive"
 *                 buyPrice: 250.50
 *                 quantity: 20
 *                 minimumInvestmentValueStock: 1000
 *                 stockCapType: "large cap"
 *             downloadLinks:
 *               - linkType: "pdf"
 *                 linkUrl: "https://example.com/prospectus.pdf"
 *                 linkDiscription: "Fund prospectus"
 *             youTubeLinks:
 *               - link: "https://youtube.com/watch?v=xyz456"
 *     responses:
 *       201:
 *         description: Created portfolio
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Portfolio'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post('/portfolios', requireAdmin, portfolioController.createPortfolio);

/**
 * @swagger
 * /api/portfolios/{id}:
 *   patch:
 *     summary: Update portfolio by ID with flexible stock management
 *     description: |
 *       Update portfolio with different stock actions:
 *       - **Default/Update**: Merge holdings - update existing stocks by symbol, add new ones
 *       - **Add**: Add new holdings to existing portfolio without affecting current holdings
 *       - **Delete**: Remove specified holdings by symbol from portfolio
 *       - **Replace**: Completely replace all holdings with provided ones
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portfolio ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               stockAction:
 *                 type: string
 *                 enum: [update, add, delete, replace]
 *                 description: |
 *                   Action to perform on holdings:
 *                   - **update** (default): Update existing holdings by symbol, add new ones
 *                   - **add**: Add new holdings without affecting existing ones
 *                   - **delete**: Remove holdings by symbol
 *                   - **replace**: Replace entire holdings array
 *               holdings:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/StockHolding'
 *               name:
 *                 type: string
 *               description:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     key:
 *                       type: string
 *                     value:
 *                       type: string
 *           examples:
 *             updateHoldings:
 *               summary: Update existing holdings (default behavior)
 *               value:
 *                 holdings:
 *                   - symbol: "POLYMED"
 *                     quantity: 2
 *                     buyPrice: 2100
 *                   - symbol: "NEWSTOCK"
 *                     sector: "TECHNOLOGY"
 *                     buyPrice: 1500
 *                     quantity: 1
 *                     minimumInvestmentValueStock: 1500
 *             addHoldings:
 *               summary: Add new holdings
 *               value:
 *                 stockAction: "add"
 *                 holdings:
 *                   - symbol: "NEWTECH"
 *                     sector: "TECHNOLOGY"
 *                     buyPrice: 2000
 *                     quantity: 1
 *                     minimumInvestmentValueStock: 2000
 *             deleteHoldings:
 *               summary: Delete holdings by symbol
 *               value:
 *                 stockAction: "delete"
 *                 holdings:
 *                   - symbol: "POLYMED"
 *                   - symbol: "INDIASHLTR"
 *             replaceAllHoldings:
 *               summary: Replace entire holdings array
 *               value:
 *                 stockAction: "replace"
 *                 holdings:
 *                   - symbol: "ONLYSTOCK"
 *                     sector: "FINANCE"
 *                     buyPrice: 1000
 *                     quantity: 5
 *                     minimumInvestmentValueStock: 5000
 *     responses:
 *       200:
 *         description: Portfolio updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Portfolio'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch('/portfolios/:id', requireAdmin, portfolioController.updatePortfolio);

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
 *         description: Portfolio ID
 *     responses:
 *       200:
 *         description: Portfolio deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Portfolio deleted successfully"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete('/portfolios/:id', requireAdmin, portfolioController.deletePortfolio);

// ================================
// YouTube Links CRUD Operations
// ================================

/**
 * @swagger
 * /api/portfolios/{id}/youtube:
 *   post:
 *     summary: Add YouTube link to portfolio
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portfolio ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/YouTubeLink'
 *           example:
 *             link: "https://youtube.com/watch?v=newvideo123"
 *     responses:
 *       201:
 *         description: YouTube link added
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Portfolio'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post('/portfolios/:id/youtube', requireAdmin, portfolioController.addYouTubeLink);

/**
 * @swagger
 * /api/portfolios/{id}/youtube/{linkId}:
 *   delete:
 *     summary: Remove YouTube link from portfolio
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portfolio ID
 *       - in: path
 *         name: linkId
 *         required: true
 *         schema:
 *           type: string
 *         description: YouTube link ID
 *     responses:
 *       200:
 *         description: YouTube link removed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Portfolio'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Portfolio or link not found
 */
router.delete('/portfolios/:id/youtube/:linkId', requireAdmin, portfolioController.removeYouTubeLink);

// ================================
// Download Links CRUD Operations
// ================================

/**
 * @swagger
 * /api/portfolios/{id}/downloads:
 *   post:
 *     summary: Add download link to portfolio
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portfolio ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DownloadLink'
 *           example:
 *             linkType: "pdf"
 *             linkUrl: "https://example.com/new-document.pdf"
 *             linkDiscription: "Updated prospectus"
 *     responses:
 *       201:
 *         description: Download link added
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Portfolio'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post('/portfolios/:id/downloads', requireAdmin, portfolioController.addDownloadLink);

/**
 * @swagger
 * /api/portfolios/{id}/downloads/{linkId}:
 *   delete:
 *     summary: Remove download link from portfolio
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portfolio ID
 *       - in: path
 *         name: linkId
 *         required: true
 *         schema:
 *           type: string
 *         description: Download link ID
 *     responses:
 *       200:
 *         description: Download link removed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Portfolio'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Portfolio or link not found
 */
router.delete('/portfolios/:id/downloads/:linkId', requireAdmin, portfolioController.removeDownloadLink);




/**
 * @swagger
 * /api/portfolios/trigger-daily-valuation:
 *   post:
 *     summary: Manually trigger daily portfolio valuation
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Valuation results
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   portfolio:
 *                     type: string
 *                   status:
 *                     type: string
 *                   logId:
 *                     type: string
 *                   error:
 *                     type: string
 *       500:
 *         description: Server error
 */
router.post('/portfolios/trigger-daily-valuation', requireAdmin, async (req, res) => {
  try {
    const results = await cronController.triggerDailyValuation();
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================================
// Chart Data CRUD Operations
// ================================

/**
 * @swagger
 * tags:
 *   name: ChartData
 *   description: Portfolio performance chart data management
 */

/**
 * @swagger
 * /api/portfolios/{portfolioId}/chart-data:
 *   get:
 *     summary: Get price logs for a portfolio
 *     tags: [ChartData]
 *     parameters:
 *       - in: path
 *         name: portfolioId
 *         schema:
 *           type: string
 *         required: true
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
 *     responses:
 *       200:
 *         description: List of price logs
 */
router.get('/portfolios/:portfolioId/chart-data', chartDataController.getAllPriceLogs);

/**
 * @swagger
 * /api/chart-data/{id}:
 *   get:
 *     summary: Get a price log by ID
 *     tags: [ChartData]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: Price log ID
 *     responses:
 *       200:
 *         description: Price log data
 *       404:
 *         description: Price log not found
 */
router.get('/chart-data/:id', chartDataController.getPriceLogById);

/**
 * @swagger
 * /api/portfolios/{portfolioId}/chart-data:
 *   post:
 *     summary: Create a new price log
 *     tags: [ChartData]
 *     parameters:
 *       - in: path
 *         name: portfolioId
 *         schema:
 *           type: string
 *         required: true
 *         description: Portfolio ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - portfolioValue
 *               - cashRemaining
 *             properties:
 *               date:
 *                 type: string
 *                 format: date-time
 *                 description: Date and time of the price log (defaults to current time if not provided)
 *                 example: "2025-08-01T12:00:00Z"
 *               portfolioValue:
 *                 type: number
 *                 description: Total value of the portfolio
 *                 example: 125000.50
 *               cashRemaining:
 *                 type: number
 *                 description: Cash remaining in the portfolio
 *                 example: 12500.75
 *               compareIndexValue:
 *                 type: number
 *                 description: Value of the comparison index
 *                 example: 18045.22
 *               compareIndexPriceSource:
 *                 type: string
 *                 enum: [closing, current]
 *                 description: Source of the comparison index price
 *                 example: "closing"
 *               usedClosingPrices:
 *                 type: boolean
 *                 description: Whether closing prices were used
 *                 example: true
 *               dataVerified:
 *                 type: boolean
 *                 description: Whether the data has been verified
 *                 example: true
 *               dataQualityIssues:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: List of data quality issues
 *                 example: ["Missing some stock data"]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Price log created
 *       400:
 *         description: Invalid input
 */
router.post('/portfolios/:portfolioId/chart-data', requireAdmin, chartDataController.createPriceLog);

/**
 * @swagger
 * /api/chart-data/{id}:
 *   patch:
 *     summary: Update a price log (partial update)
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
 *             type: object
 *             properties:
 *               date:
 *                 type: string
 *                 format: date-time
 *                 description: Date and time of the price log
 *                 example: "2025-08-01T12:00:00Z"
 *               portfolioValue:
 *                 type: number
 *                 description: Total value of the portfolio
 *                 example: 125000.50
 *               cashRemaining:
 *                 type: number
 *                 description: Cash remaining in the portfolio
 *                 example: 12500.75
 *               compareIndexValue:
 *                 type: number
 *                 description: Value of the comparison index
 *                 example: 18045.22
 *               compareIndexPriceSource:
 *                 type: string
 *                 enum: [closing, current]
 *                 description: Source of the comparison index price
 *                 example: "closing"
 *               usedClosingPrices:
 *                 type: boolean
 *                 description: Whether closing prices were used
 *                 example: true
 *               dataVerified:
 *                 type: boolean
 *                 description: Whether the data has been verified
 *                 example: true
 *               dataQualityIssues:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: List of data quality issues
 *                 example: ["Missing some stock data"]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Price log updated
 *       404:
 *         description: Price log not found
 */
router.patch('/chart-data/:id', requireAdmin, chartDataController.updatePriceLog);

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
router.delete('/chart-data/:id', requireAdmin, chartDataController.deletePriceLog);

/**
 * @swagger
 * /api/portfolios/{portfolioId}/performance:
 *   get:
 *     summary: Get portfolio performance data
 *     tags: [ChartData]
 *     parameters:
 *       - in: path
 *         name: portfolioId
 *         schema:
 *           type: string
 *         required: true
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
 *     responses:
 *       200:
 *         description: Portfolio performance data
 *       404:
 *         description: Portfolio not found
 */
router.get('/portfolios/:portfolioId/performance', chartDataController.getPortfolioPerformance);

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
router.post('/chart-data/cleanup-duplicates', requireAdmin, chartDataController.cleanupDuplicates);

module.exports = router;
