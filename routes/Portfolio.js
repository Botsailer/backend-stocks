const express = require('express');
const router = express.Router();
const portfolioController = require('../controllers/portfolioController');
const chartDataController = require('../controllers/chartDataController');
const requireAdmin = require('../middleware/requirreAdmin');
const cronController = require('../controllers/portfoliocroncontroller');
const portfolioService = require('../services/portfolioservice');



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
 *           example: 150.75
 *           description: "Current/average buy price per share"
 *         originalBuyPrice:
 *           type: number
 *           format: float
 *           example: 150.75
 *           readOnly: true
 *           description: "Preserved original buy price for reference"
 *         averagePrice:
 *           type: number
 *           format: float
 *           example: 148.50
 *           readOnly: true
 *           description: "Auto-calculated average price for multiple purchases"
 *         quantity:
 *           type: number
 *           format: float
 *           example: 10.5
 *           description: "Number of shares (supports partial shares)"
 *         totalQuantity:
 *           type: number
 *           format: float
 *           example: 25.5
 *           readOnly: true
 *           description: "Total quantity including all purchases"
 *         realizedPnL:
 *           type: number
 *           format: float
 *           example: 125.50
 *           readOnly: true
 *           description: "Realized profit/loss from sales"
 *         priceHistory:
 *           type: array
 *           readOnly: true
 *           description: "History of all purchase prices for averaging calculations"
 *           items:
 *             type: object
 *             properties:
 *               price:
 *                 type: number
 *                 format: float
 *                 example: 150.75
 *               quantity:
 *                 type: number
 *                 format: float
 *                 example: 10
 *               date:
 *                 type: string
 *                 format: date-time
 *               transactionType:
 *                 type: string
 *                 enum: ["buy", "sell"]
 *                 example: "buy"
 *         saleHistory:
 *           type: array
 *           readOnly: true
 *           description: "History of sales transactions with P&L tracking"
 *           items:
 *             type: object
 *             properties:
 *               quantitySold:
 *                 type: number
 *                 format: float
 *                 example: 5
 *               salePrice:
 *                 type: number
 *                 format: float
 *                 example: 165.25
 *               pnL:
 *                 type: number
 *                 format: float
 *                 example: 72.50
 *               saleDate:
 *                 type: string
 *                 format: date-time
 *         saleType:
 *           type: string
 *           enum: [partial, complete]
 *           description: "Type of sale operation - used only in sell requests"
 *           example: "complete"
 *         minimumInvestmentValueStock:
 *           type: number
 *           example: 1000
 *           description: "Current market value of the holding (currentPrice × quantity)"
 *         investmentValueAtBuy:
 *           type: number
 *           format: float
 *           example: 1507.50
 *           readOnly: true
 *           description: "Investment value at buy price (buyPrice × quantity)"
 *         investmentValueAtMarket:
 *           type: number
 *           format: float
 *           example: 1625.00
 *           readOnly: true
 *           description: "Investment value at current market price (currentPrice × quantity)"
 *         currentPrice:
 *           type: number
 *           format: float
 *           example: 155.00
 *           readOnly: true
 *           description: "Current market price fetched from StockSymbol collection"
 *         unrealizedPnL:
 *           type: number
 *           format: float
 *           example: 117.50
 *           readOnly: true
 *           description: "Unrealized profit/loss (investmentValueAtMarket - investmentValueAtBuy)"
 *         unrealizedPnLPercent:
 *           type: number
 *           format: float
 *           example: 7.8
 *           readOnly: true
 *           description: "Unrealized profit/loss percentage"
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
 *           description: "Remaining cash balance after stock purchases and including profits from sales"
 *         currentValue:
 *           type: number
 *           example: 10500.75
 *           readOnly: true
 *           description: "Backend-calculated total portfolio value (auto-updated with market prices)"
 *         holdingsValueAtMarket:
 *           type: number
 *           example: 9300.25
 *           readOnly: true
 *           description: "Total value of all holdings at current market prices"
 *         totalUnrealizedPnL:
 *           type: number
 *           example: 1500.50
 *           readOnly: true
 *           description: "Total unrealized profit/loss across all holdings"
 *         totalUnrealizedPnLPercent:
 *           type: number
 *           example: 18.75
 *           readOnly: true
 *           description: "Total unrealized profit/loss percentage"
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
 *         saleHistory:
 *           type: array
 *           readOnly: true
 *           description: "History of completely sold stocks"
 *           items:
 *             type: object
 *             properties:
 *               symbol:
 *                 type: string
 *                 example: "RELIANCE"
 *                 description: "Stock symbol that was sold"
 *               soldDate:
 *                 type: string
 *                 format: date-time
 *                 example: "2025-08-15T10:30:00.000Z"
 *                 description: "Date when the stock was completely sold"
 *               originalQuantity:
 *                 type: number
 *                 example: 10
 *                 description: "Original quantity that was held"
 *               salePrice:
 *                 type: number
 *                 example: 2450.50
 *                 description: "Price per share at which it was sold"
 *               saleValue:
 *                 type: number
 *                 example: 24505.00
 *                 description: "Total value received from the sale"
 *               profitLoss:
 *                 type: number
 *                 example: 1500.50
 *                 description: "Profit or loss from the sale (positive for profit, negative for loss)"
 *               originalBuyPrice:
 *                 type: number
 *                 example: 2300.00
 *                 description: "Original purchase price per share"
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
 *     summary: Create a new portfolio with production-level validation and stock market logic
 *     description: |
 *       Creates a new investment portfolio with comprehensive backend validation.
 *       Features include:
 *       - Automatic stock price averaging for multiple purchases of same stock
 *       - Cash balance validation and tracking
 *       - Real-time portfolio value calculation
 *       - Anti-tampering validation
 *       - Comprehensive financial integrity checks
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
 *             name: "Tech Growth Portfolio"
 *             description: 
 *               - key: "Strategy"
 *                 value: "Tech-focused growth with dividend reinvestment"
 *               - key: "Risk Level"
 *                 value: "High"
 *               - key: "Target Return"
 *                 value: "15-20% annually"
 *             subscriptionFee:
 *               - type: "monthly"
 *                 price: 29.99
 *               - type: "yearly"
 *                 price: 299.99
 *             minInvestment: 10000
 *             durationMonths: 24
 *             PortfolioCategory: "Premium"
 *             holdings:
 *               - symbol: "AAPL"
 *                 sector: "Technology"
 *                 buyPrice: 150.75
 *                 quantity: 15
 *                 minimumInvestmentValueStock: 2261.25
 *                 stockCapType: "large cap"
 *                 status: "Hold"
 *               - symbol: "TSLA" 
 *                 sector: "Automotive"
 *                 buyPrice: 250.50
 *                 quantity: 10
 *                 minimumInvestmentValueStock: 2505.00
 *                 stockCapType: "large cap"
 *                 status: "Fresh-Buy"
 *               - symbol: "NVDA"
 *                 sector: "Technology"
 *                 buyPrice: 420.80
 *                 quantity: 12
 *                 minimumInvestmentValueStock: 5049.60
 *                 stockCapType: "large cap"
 *                 status: "addon-buy"
 *             timeHorizon: "Long-term (5+ years)"
 *             rebalancing: "Quarterly review with threshold-based rebalancing"
 *             index: "NASDAQ 100"
 *             details: "Growth-oriented portfolio focusing on large-cap technology stocks"
 *             downloadLinks:
 *               - linkType: "pdf"
 *                 linkUrl: "https://example.com/prospectus.pdf"
 *                 linkDiscription: "Fund prospectus"
 *             youTubeLinks:
 *               - link: "https://youtube.com/watch?v=xyz456"
 *     responses:
 *       201:
 *         description: Portfolio created successfully with backend validation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Portfolio'
 *             example:
 *               _id: "507f1f77bcf86cd799439011"
 *               name: "Tech Growth Portfolio"
 *               cashBalance: 184.15
 *               currentValue: 9815.85
 *               holdings:
 *                 - symbol: "AAPL"
 *                   averagePrice: 150.75
 *                   originalBuyPrice: 150.75
 *                   totalQuantity: 15
 *                   priceHistory:
 *                     - price: 150.75
 *                       quantity: 15
 *                       date: "2024-01-15T10:30:00Z"
 *                       transactionType: "buy"
 *                   weight: 23.02
 *                   realizedPnL: 0
 *                 - symbol: "TSLA"
 *                   averagePrice: 250.50
 *                   originalBuyPrice: 250.50
 *                   totalQuantity: 10
 *                   weight: 25.49
 *               createdAt: "2024-01-15T10:30:00Z"
 *               updatedAt: "2024-01-15T10:30:00Z"
 *       400:
 *         description: Validation failed or insufficient funds
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Threshold exceeded! Cash balance remaining: ₹2000 but you are trying to add worth ₹3000"
 *                 symbol:
 *                   type: string
 *                   example: "AAPL"
 *                 details:
 *                   type: object
 *                   description: "Additional validation details"
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
 *     summary: Update portfolio with advanced stock market operations
 *     description: |
 *       Advanced portfolio update with production-level stock market operations:
 *       
 *       **Stock Actions:**
 *       - **update** (default): Update existing holdings by symbol, add new ones
 *       - **add/buy**: Add new holdings with automatic price averaging if stock exists
 *       - **sell**: Sell holdings using real-time prices with profit/loss calculation
 *       - **delete**: Remove specified holdings by symbol from portfolio
 *       - **replace**: Completely replace all holdings with provided ones
 *       
 *       **Stock Market Features:**
 *       - **Price Averaging**: Multiple purchases of same stock automatically calculate weighted average
 *       - **Real-time Selling**: Sales use current market prices, profits added to cash balance
 *       - **Cash Validation**: "Threshold exceeded! Cash balance remaining: ₹X but you are trying to add worth ₹Y"
 *       - **P&L Tracking**: Realized profits/losses tracked for each sale
 *       - **Price History**: Complete transaction history maintained for each stock
 *       
 *       **Examples:**
 *       - Buy AAPL at ₹150, then buy again at ₹160 → Average price becomes ₹155
 *       - Sell AAPL at current market price ₹170 → Profit added to cash balance
 *       - Insufficient funds validation prevents overspending
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
 *                 enum: [update, add, delete, replace, buy, sell]
 *                 default: update
 *                 description: |
 *                   Action to perform on holdings:
 *                   - **update** (default): Update existing holdings by symbol, add new ones
 *                   - **add/buy**: Add new holdings with automatic price averaging for duplicate stocks
 *                   - **sell**: Sell holdings using real-time market prices with P&L calculation
 *                   - **delete**: Remove holdings by symbol (cash value returned to balance)
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
 *             buyStockWithAveraging:
 *               summary: Buy additional shares (price averaging)
 *               description: Buy more shares of existing stock - automatically calculates average price
 *               value:
 *                 stockAction: "buy"
 *                 holdings:
 *                   - symbol: "AAPL"
 *                     sector: "Technology"
 *                     buyPrice: 160.25
 *                     quantity: 10
 *                     minimumInvestmentValueStock: 1602.50
 *                     stockCapType: "large cap"
 *                     status: "addon-buy"
 *             sellStockRealTime:
 *               summary: Sell stock at real-time market price
 *               description: Sell holdings using current market price, profits added to cash balance
 *               value:
 *                 stockAction: "sell"
 *                 holdings:
 *                   - symbol: "TSLA"
 *                     quantity: 5
 *                     saleType: "partial"
 *             sellEntirePosition:
 *               summary: Sell entire stock position
 *               description: Sell all shares of a stock
 *               value:
 *                 stockAction: "sell"
 *                 holdings:
 *                   - symbol: "NVDA"
 *                     saleType: "complete"
 *     responses:
 *       200:
 *         description: Portfolio updated successfully with operation details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 portfolio:
 *                   $ref: '#/components/schemas/Portfolio'
 *                 operationResults:
 *                   type: array
 *                   description: Details of stock market operations performed
 *                   items:
 *                     type: object
 *                     properties:
 *                       success:
 *                         type: boolean
 *                         example: true
 *                       operation:
 *                         type: object
 *                         properties:
 *                           type:
 *                             type: string
 *                             enum: ["new_purchase", "averaged_purchase", "partial_sale", "complete_sale"]
 *                             example: "averaged_purchase"
 *                           symbol:
 *                             type: string
 *                             example: "AAPL"
 *                           previousPrice:
 *                             type: number
 *                             example: 150.75
 *                           newPrice:
 *                             type: number
 *                             example: 160.25
 *                           newAveragePrice:
 *                             type: number
 *                             example: 155.50
 *                       cashImpact:
 *                         type: object
 *                         properties:
 *                           previousBalance:
 *                             type: number
 *                             example: 2000.50
 *                           newBalance:
 *                             type: number
 *                             example: 397.50
 *                           amountUsed:
 *                             type: number
 *                             example: 1603.00
 *                           profitAdded:
 *                             type: number
 *                             example: 125.50
 *             example:
 *               portfolio:
 *                 _id: "507f1f77bcf86cd799439011"
 *                 name: "Tech Growth Portfolio"
 *                 cashBalance: 397.50
 *                 currentValue: 11603.25
 *                 holdings:
 *                   - symbol: "AAPL"
 *                     averagePrice: 155.50
 *                     originalBuyPrice: 150.75
 *                     totalQuantity: 25
 *                     priceHistory:
 *                       - price: 150.75
 *                         quantity: 15
 *                         date: "2024-01-15T10:30:00Z"
 *                         transactionType: "buy"
 *                       - price: 160.25
 *                         quantity: 10
 *                         date: "2024-01-16T14:20:00Z"
 *                         transactionType: "buy"
 *                     weight: 38.87
 *                     realizedPnL: 0
 *               operationResults:
 *                 - success: true
 *                   operation:
 *                     type: "averaged_purchase"
 *                     symbol: "AAPL"
 *                     previousPrice: 150.75
 *                     newPrice: 160.25
 *                     newAveragePrice: 155.50
 *                   cashImpact:
 *                     previousBalance: 2000.50
 *                     newBalance: 397.50
 *                     amountUsed: 1602.50
 *       400:
 *         description: Validation failed, insufficient funds, or operation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Threshold exceeded! Cash balance remaining: ₹500 but you are trying to add worth ₹1600"
 *                 symbol:
 *                   type: string
 *                   example: "AAPL"
 *                 details:
 *                   type: object
 *                   description: "Additional operation details and validation results"
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
// Portfolio Value Management
// ================================

/**
 * @swagger
 * /api/portfolios/{id}/recalculate:
 *   post:
 *     summary: Manually recalculate portfolio value
 *     description: Recalculates portfolio value using current or closing prices and updates the stored value
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
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               priceType:
 *                 type: string
 *                 enum: [closing, current]
 *                 default: current
 *                 description: Type of price to use for calculation
 *               createPriceLog:
 *                 type: boolean
 *                 default: true
 *                 description: Whether to create a price log entry
 *           example:
 *             priceType: "current"
 *             createPriceLog: true
 *     responses:
 *       200:
 *         description: Portfolio value recalculated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 portfolioId:
 *                   type: string
 *                 name:
 *                   type: string
 *                 oldValue:
 *                   type: number
 *                 newValue:
 *                   type: number
 *                 change:
 *                   type: number
 *                 changePercent:
 *                   type: number
 *                 priceType:
 *                   type: string
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *                 priceLogCreated:
 *                   type: boolean
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post('/portfolios/:id/recalculate', requireAdmin, portfolioController.recalculatePortfolioValue);

/**
 * @swagger
 * /api/portfolios/{id}/detailed-calculation:
 *   post:
 *     summary: Perform detailed portfolio calculation with step-by-step logging
 *     description: Execute a comprehensive portfolio calculation with detailed step-by-step logging for debugging cash balance and value calculation issues
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
 *         description: Detailed calculation completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 portfolio:
 *                   type: object
 *                   description: Updated portfolio with new calculated values
 *                 calculationResult:
 *                   type: object
 *                   properties:
 *                     totalPortfolioValue:
 *                       type: number
 *                     cashBalance:
 *                       type: number
 *                     holdingsValueAtMarket:
 *                       type: number
 *                 message:
 *                   type: string
 *                 logsMessage:
 *                   type: string
 *       404:
 *         description: Portfolio not found
 *       500:
 *         description: Calculation failed
 */
router.post('/portfolios/:id/detailed-calculation', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`🔍 Starting detailed portfolio calculation for ID: ${id}`);
    
    const result = await portfolioService.calculatePortfolioValueWithDetailedLogging(id);
    
    res.json({
      success: true,
      portfolio: result.portfolio,
      calculationResult: result.calculationResult,
      message: result.message,
      logsMessage: 'Detailed calculation logs have been generated. Use GET /api/portfolio-calculation-logs to view step-by-step details.'
    });

  } catch (error) {
    console.error(`❌ Detailed calculation failed for portfolio ${req.params.id}:`, error);
    res.status(error.message.includes('not found') ? 404 : 500).json({
      success: false,
      error: error.message,
      message: 'Portfolio detailed calculation failed'
    });
  }
});

/**
 * @swagger
 * /api/portfolios/update-all:
 *   post:
 *     summary: Update all portfolio values with current market prices
 *     description: Mass update all portfolios with current market prices and create price logs
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               priceType:
 *                 type: string
 *                 enum: [closing, current]
 *                 default: current
 *                 description: Type of price to use for calculation
 *               createPriceLogs:
 *                 type: boolean
 *                 default: true
 *                 description: Whether to create price log entries
 *           example:
 *             priceType: "current"
 *             createPriceLogs: true
 *     responses:
 *       200:
 *         description: All portfolios updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalPortfolios:
 *                   type: integer
 *                 updated:
 *                   type: integer
 *                 failed:
 *                   type: integer
 *                 priceType:
 *                   type: string
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       portfolioId:
 *                         type: string
 *                       name:
 *                         type: string
 *                       status:
 *                         type: string
 *                         enum: [success, error]
 *                       oldValue:
 *                         type: number
 *                       newValue:
 *                         type: number
 *                       change:
 *                         type: number
 *                       changePercent:
 *                         type: number
 *                       error:
 *                         type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post('/portfolios/update-all', requireAdmin, portfolioController.updateAllPortfolioValues);

/**
 * @swagger
 * /api/portfolios/{id}/realtime-value:
 *   get:
 *     summary: Get real-time portfolio value comparison
 *     description: Compare stored portfolio value with real-time calculated value and indicate sync status
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
 *         description: Real-time value comparison
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 portfolioId:
 *                   type: string
 *                 name:
 *                   type: string
 *                 storedValue:
 *                   type: number
 *                   description: Currently stored portfolio value
 *                 realTimeValue:
 *                   type: number
 *                   description: Real-time calculated value
 *                 difference:
 *                   type: number
 *                   description: Difference between real-time and stored
 *                 differencePercent:
 *                   type: number
 *                   description: Percentage difference
 *                 isInSync:
 *                   type: boolean
 *                   description: Whether values are in sync (within 1% tolerance)
 *                 lastUpdated:
 *                   type: string
 *                   format: date-time
 *                   description: When the stored value was last updated
 *                 timeSinceUpdate:
 *                   type: string
 *                   description: Human readable time since last update
 *                 marketStatus:
 *                   type: string
 *                   enum: [open, closed]
 *                   description: Current market status
 *                 calculationTime:
 *                   type: string
 *                   format: date-time
 *                   description: When this calculation was performed
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/portfolios/:id/realtime-value', requireAdmin, portfolioController.getRealTimeValue);

/**
 * @swagger
 * /api/portfolios/{id}/sell-stock:
 *   post:
 *     summary: Enhanced stock sale with detailed logging
 *     description: Process stock sale with comprehensive logging and proper handling of complete/partial sales
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
 *             required:
 *               - symbol
 *               - quantityToSell
 *             properties:
 *               symbol:
 *                 type: string
 *                 description: Stock symbol to sell
 *                 example: "BAJFINANCE"
 *               quantityToSell:
 *                 type: number
 *                 description: Quantity to sell
 *                 example: 1
 *               saleType:
 *                 type: string
 *                 enum: [partial, complete]
 *                 description: Type of sale
 *                 default: partial
 *     responses:
 *       200:
 *         description: Stock sale processed successfully
 *       400:
 *         description: Invalid request data
 *       404:
 *         description: Portfolio or stock not found
 */
router.post('/portfolios/:id/sell-stock', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { symbol, quantityToSell, saleType } = req.body;

    if (!symbol || !quantityToSell) {
      return res.status(400).json({
        success: false,
        error: 'Symbol and quantityToSell are required'
      });
    }

    const result = await portfolioService.processStockSaleWithLogging(id, {
      symbol,
      quantityToSell,
      saleType
    });

    res.json({
      success: true,
      message: 'Stock sale processed successfully',
      data: result
    });

  } catch (error) {
    console.error('Stock sale error:', error);
    res.status(500).json({
      success: false,
      error: 'Stock sale failed',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/portfolios/cleanup-sold-stocks:
 *   post:
 *     summary: Cleanup sold stocks older than 10 days
 *     description: Remove sold stocks from portfolios that were sold more than 10 days ago
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sold stocks cleanup completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 totalCleaned:
 *                   type: integer
 *                   description: Number of sold stocks removed
 *                 message:
 *                   type: string
 *       500:
 *         description: Cleanup failed
 */
router.post('/portfolios/cleanup-sold-stocks', requireAdmin, async (req, res) => {
  try {
    const result = await portfolioService.cleanupOldSoldStocks();

    res.json({
      success: true,
      totalCleaned: result.totalCleaned,
      message: `Successfully cleaned up ${result.totalCleaned} sold stocks older than 10 days`
    });

  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({
      success: false,
      error: 'Cleanup failed',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/portfolios/{id}/update-market-prices:
 *   put:
 *     summary: Update portfolio with current market prices and calculate PnL
 *     description: Fetches current prices from StockSymbol collection and updates portfolio valuations
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
 *         description: Portfolio updated with market prices successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 message:
 *                   type: string
 *                   example: "Portfolio updated with current market prices from StockSymbol collection"
 *                 portfolio:
 *                   type: object
 *                   properties:
 *                     totalUnrealizedPnL:
 *                       type: number
 *                       example: 15000.50
 *                     totalUnrealizedPnLPercent:
 *                       type: number
 *                       example: 12.5
 *                     holdingsValueAtMarket:
 *                       type: number
 *                       example: 135000.75
 *       404:
 *         description: Portfolio not found
 *       500:
 *         description: Server error
 */
router.put('/portfolios/:id/update-market-prices', requireAdmin, portfolioController.updatePortfolioWithMarketPrices);

/**
 * @swagger
 * /api/portfolios/{id}/pnl-summary:
 *   get:
 *     summary: Get portfolio PnL summary with unrealized gains/losses
 *     description: Returns comprehensive profit/loss analysis for portfolio holdings
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
 *         description: Portfolio PnL summary retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 summary:
 *                   type: object
 *                   properties:
 *                     portfolioName:
 *                       type: string
 *                       example: "Growth Portfolio"
 *                     totalInvestmentAtBuy:
 *                       type: number
 *                       example: 120000
 *                     totalValueAtMarket:
 *                       type: number
 *                       example: 135000.75
 *                     totalUnrealizedPnL:
 *                       type: number
 *                       example: 15000.75
 *                     totalUnrealizedPnLPercent:
 *                       type: number
 *                       example: 12.5
 *                 holdings:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       symbol:
 *                         type: string
 *                         example: "RELIANCE"
 *                       unrealizedPnL:
 *                         type: number
 *                         example: 5000.25
 *                       unrealizedPnLPercent:
 *                         type: number
 *                         example: 8.5
 *       404:
 *         description: Portfolio not found
 *       500:
 *         description: Server error
 */
router.get('/portfolios/:id/pnl-summary', requireAdmin, portfolioController.getPortfolioPnLSummary);

/**
 * @swagger
 * /api/portfolios/update-all-market-prices:
 *   put:
 *     summary: Update all portfolios with current market prices
 *     description: Bulk update all portfolios with latest market prices from StockSymbol collection
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All portfolios updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 message:
 *                   type: string
 *                   example: "Updated 5 portfolios successfully, 0 failed"
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       portfolioName:
 *                         type: string
 *                         example: "Growth Portfolio"
 *                       status:
 *                         type: string
 *                         example: "success"
 *                       totalUnrealizedPnL:
 *                         type: number
 *                         example: 15000.50
 *       500:
 *         description: Server error
 */
router.put('/portfolios/update-all-market-prices', requireAdmin, portfolioController.updateAllPortfoliosWithMarketPrices);

module.exports = router;
