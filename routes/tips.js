const express = require("express");
const router = express.Router();
const tipController = require("../controllers/tipsController");
const requireAdmin = require("../middleware/requirreAdmin");

/**
 * @swagger
 * components:
 *   schemas:
 *     DownloadLink:
 *       type: object
 *       required:
 *         - name
 *         - url
 *       properties:
 *         _id:
 *           type: string
 *           description: Unique identifier for the download link
 *           example: "665f2e8b6c1d2b001f2c5a1b"
 *         name:
 *           type: string
 *           description: Name of the document
 *           example: "Research PDF"
 *         url:
 *           type: string
 *           description: URL to the downloadable resource
 *           example: "https://example.com/research.pdf"
 *     Tip:
 *       type: object
 *       required:
 *         - title
 *         - stockId
 *         - content
 *         - description
 *       properties:
 *         _id:
 *           type: string
 *           description: Unique identifier of the tip
 *           example: "60f72b8a2e4e3c0015c4d1a2"
 *         portfolio:
 *           type: string
 *           description: ObjectId of the portfolio this tip belongs to (optional)
 *           example: "60f72a9b1d2f3b0014b3c0f1"
 *         title:
 *           type: string
 *           description: Short title of the tip
 *           example: "Rebalance quarterly"
 *         stockId:
 *           type: string
 *           description: Stock identifier associated with the tip
 *           example: "AAPL"
 *         category:
 *           type: string
 *           enum: [basic, premium]
 *           description: Access category for general tips
 *           default: "basic"
 *           example: "premium"
 *         content:
 *           type: array
 *           description: Array of key-value pairs for tip content
 *           items:
 *             type: object
 *             properties:
 *               key:
 *                 type: string
 *                 example: "Strategy"
 *               value:
 *                 type: string
 *                 example: "Review your asset allocations every quarter."
 *         description:
 *           type: string
 *           description: Description of the tip
 *           example: "Quarterly rebalancing keeps your risk profile in check."
 *         status:
 *           type: string
 *           enum: [Active, Closed]
 *           description: Whether the tip is still Active or has been Closed
 *           default: "Active"
 *           example: "Active"
 *         action:
 *           type: string
 *           description: Recommended action for the stock (Buy/Sell/Hold/Partial Profit)
 *           example: "Buy"
 *         buyRange:
 *           type: string
 *           description: The recommended buy range for the stock
 *           example: "100-150"
 *         targetPrice:
 *           type: string
 *           description: The target price for the stock
 *           example: "180"
 *         targetPercentage:
 *           type: string
 *           description: Expected percentage gain from the tip
 *           example: "20%"
 *         addMoreAt:
 *           type: string
 *           description: The price point to add more to the position
 *           example: "95"
 *         analysistConfidence:
 *           type: number
 *           description: Analyst's confidence level in the tip (0-100)
 *           default: 0
 *           minimum: 0
 *           maximum: 100
 *           example: 85
 *         tipUrl:
 *           type: string
 *           description: URL with additional information about the tip
 *           example: "https://example.com/analysis/stock-xyz"
 *         exitPrice:
 *           type: string
 *           description: Price at which to exit the position
 *           example: "200"
 *         mpWeightage:
 *           type: number
 *           description: Waitage percentage for the tip in the portfolio
 *           default: 0
 *           minimum: 0
 *           maximum: 100
 *           example: 10
 *         exitStatus:
 *           type: string
 *           description: Final status when exiting the position
 *           example: "Target Achieved"
 *         exitStatusPercentage:
 *           type: string
 *           description: Percentage gain/loss at exit
 *           example: "25%"
 *         horizon:
 *           type: string
 *           description: Investment time horizon for the tip
 *           default: "Long Term"
 *           example: "Long Term"
 *         downloadLinks:
 *           type: array
 *           description: List of downloadable resource links
 *           items:
 *             $ref: '#/components/schemas/DownloadLink'
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Timestamp when the tip was created
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Timestamp when the tip was last updated
 */

// Get all tips for a specific portfolio
/**
 * @swagger
 * /api/tips/portfolios/{portfolioId}/tips:
 *   get:
 *     summary: Get all tips for a specific portfolio
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: portfolioId
 *         schema:
 *           type: string
 *         required: true
 *         description: MongoDB ObjectId of the portfolio
 *     responses:
 *       200:
 *         description: List of tips for the portfolio
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Tip'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.get(
  "/portfolios/:portfolioId/tips",
  requireAdmin,
  tipController.getTipsByPortfolio
);

// Get a single tip by ID
/**
 * @swagger
 * /api/tips/{id}:
 *   get:
 *     summary: Get a single tip by ID
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: MongoDB ObjectId of the tip
 *     responses:
 *       200:
 *         description: Tip details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Tip'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */

// Get all tips across all portfolios - MOVED BEFORE /:id route
/**
 * @swagger
 * /api/tips:
 *   get:
 *     summary: Get all general tips with filters
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (YYYY-MM-DD)
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [basic, premium]
 *         description: Filter by category
 *     responses:
 *       200:
 *         description: Tips with premium content filtered by subscription
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/Tip'
 *                 - type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     title:
 *                       type: string
 *                     message:
 *                       type: string
 *       400:
 *         description: Invalid date format or category
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get("/", requireAdmin, tipController.getalltipswithoutPortfolio);

router.get("/:id", requireAdmin, tipController.getTipById);

// Create a new tip for a portfolio
/**
 * @swagger
 * /api/tips/portfolios/{portfolioId}/tips:
 *   post:
 *     summary: Create a new tip for a portfolio
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: portfolioId
 *         schema:
 *           type: string
 *         required: true
 *         description: MongoDB ObjectId of the portfolio
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Tip'
 *     responses:
 *       201:
 *         description: Tip created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Tip'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post(
  "/portfolios/:portfolioId/tips",
  requireAdmin,
  tipController.createTip
);

// Get all tips across all portfolios

/**
 * @swagger
 * /api/tips:
 *   get:
 *     summary: Get all general tips with filters
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (YYYY-MM-DD)
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [basic, premium]
 *         description: Filter by category
 *     responses:
 *       200:
 *         description: Tips with premium content filtered by subscription
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/Tip'
 *                 - type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     title:
 *                       type: string
 *                     message:
 *                       type: string
 *       400:
 *         description: Invalid date format or category
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/tips/by-date:
 *   get:
 *     summary: Get tips by date range and category
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (YYYY-MM-DD)
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [basic, premium]
 *         description: Filter by category
 *     responses:
 *       200:
 *         description: Tips with visibility based on subscription
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/Tip'
 *                 - type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     title:
 *                       type: string
 *                     message:
 *                       type: string
 *       400:
 *         description: Invalid date format or category
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  "/by-date",
requireAdmin,
  tipController.getTipsByDate
);

// Create a general tip (not associated with any portfolio)
/**
 * @swagger
 * /api/tips:
 *   post:
 *     summary: Create a general tip (not associated with any portfolio)
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Tip'
 *     responses:
 *       201:
 *         description: Tip created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Tip'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post("/", requireAdmin, tipController.createTipWithoutPortfolio);

// Update an existing tip
/**
 * @swagger
 * /api/tips/{id}:
 *   put:
 *     summary: Update an existing tip
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: MongoDB ObjectId of the tip to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Tip'
 *     responses:
 *       200:
 *         description: Updated tip
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Tip'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 */
router.put("/:id", requireAdmin, tipController.updateTip);

// Delete a tip
/**
 * @swagger
 * /api/tips/{id}:
 *   delete:
 *     summary: Delete a tip
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: MongoDB ObjectId of the tip to delete
 *     responses:
 *       200:
 *         description: Deletion confirmation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Tip deleted"
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */
router.delete("/:id", requireAdmin, tipController.deleteTip);

// Get all download links for a tip
/**
 * @swagger
 * /api/tips/{id}/download-links:
 *   get:
 *     summary: Get all download links for a tip
 *     tags: [Download Links]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: MongoDB ObjectId of the tip
 *     responses:
 *       200:
 *         description: Array of download links
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/DownloadLink'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Tip not found
 *       500:
 *         description: Server error
 */
router.get("/:id/download-links", requireAdmin, tipController.getDownloadLinks);

// Add a download link to a tip
/**
 * @swagger
 * /api/tips/{id}/download-links:
 *   post:
 *     summary: Add a download link to a tip
 *     tags: [Download Links]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: MongoDB ObjectId of the tip
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DownloadLink'
 *     responses:
 *       201:
 *         description: Download link added successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DownloadLink'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Tip not found
 */
router.post("/:id/download-links", requireAdmin, tipController.addDownloadLink);

// Update a download link
/**
 * @swagger
 * /api/tips/{id}/download-links/{linkId}:
 *   put:
 *     summary: Update a download link
 *     tags: [Download Links]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: MongoDB ObjectId of the tip
 *       - in: path
 *         name: linkId
 *         schema:
 *           type: string
 *         required: true
 *         description: MongoDB ObjectId of the download link
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DownloadLink'
 *     responses:
 *       200:
 *         description: Updated download link
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DownloadLink'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Resource not found
 */
router.put("/:id/download-links/:linkId", requireAdmin, tipController.updateDownloadLink);

// Delete a download link
/**
 * @swagger
 * /api/tips/{id}/download-links/{linkId}:
 *   delete:
 *     summary: Delete a download link
 *     tags: [Download Links]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: MongoDB ObjectId of the tip
 *       - in: path
 *         name: linkId
 *         schema:
 *           type: string
 *         required: true
 *         description: MongoDB ObjectId of the download link to delete
 *     responses:
 *       200:
 *         description: Deletion confirmation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Download link deleted"
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Resource not found
 *       500:
 *         description: Server error
 */
router.delete("/:id/download-links/:linkId", requireAdmin, tipController.deleteDownloadLink);

module.exports = router;