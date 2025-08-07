const express = require('express');
const router = express.Router();
const portfolioController = require('../controllers/portfolioController');
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
 *   put:
 *     summary: Update portfolio by ID
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
 *             $ref: '#/components/schemas/Portfolio'
 *           example:
 *             name: "Updated Tech Growth"
 *             description: 
 *               - key: "Strategy"
 *                 value: "Updated tech focus"
 *             holdings:
 *               - symbol: "TSLA"
 *                 sector: "Automotive"
 *                 buyPrice: 260.75
 *                 quantity: 22
 *                 minimumInvestmentValueStock: 1000
 *                 stockCapType: "large cap"
 *             downloadLinks:
 *               - linkType: "excel"
 *                 linkUrl: "https://example.com/data.xlsx"
 *                 linkDiscription: "Portfolio holdings"
 *     responses:
 *       200:
 *         description: Portfolio updated
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
router.put('/portfolios/:id', requireAdmin, portfolioController.updatePortfolio);

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

module.exports = router;
