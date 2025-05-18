const express = require("express");
const router = express.Router();
const tipController = require("../controllers/tipsController");
const requireAdmin = require("../middleware/requirreAdmin");

/**
 * @swagger
 * components:
 *   schemas:
 *     Tip:
 *       type: object
 *       required:
 *         - title
 *       description: |
 *         **Field names are case-insensitive when sending data (e.g. "buyRange", "BUYRANGE", "buyrange" all work), but spelling must be correct.**
 *         **All responses will always use the exact camelCase field names as shown below.**
 *       properties:
 *         _id:
 *           type: string
 *           description: Unique identifier of the tip
 *           example: 60f72b8a2e4e3c0015c4d1a2
 *         portfolio:
 *           type: string
 *           description: ObjectId of the portfolio this tip belongs to (optional)
 *           example: 60f72a9b1d2f3b0014b3c0f1
 *         title:
 *           type: string
 *           description: Short title of the tip
 *           example: "Rebalance quarterly"
 *         content:
 *           type: string
 *           description: Detailed content of the tip
 *           example: "Review your asset allocations every quarter to maintain risk profile."
 *         status:
 *           type: string
 *           enum: [Active, Closed]
 *           description: Whether the tip is still Active or has been Closed
 *           default: "Active"
 *           example: "Active"
 *         buyRange:
 *           type: string
 *           description: The recommended buy range for the stock
 *           example: "100-150"
 *         targetPrice:
 *           type: string
 *           description: The target price for the stock
 *           example: "180"
 *         addMoreAt:
 *           type: string
 *           description: The price point to add more to the position
 *           example: "95"
 *         tipUrl:
 *           type: string
 *           description: URL with additional information about the tip
 *           example: "https://example.com/analysis/stock-xyz"
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


/**
 * @swagger
 * tags:
 *   name: Tips
 *   description: Management of portfolio tips
 */

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
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
router.get(
  "/portfolios/:portfolioId/tips",
  requireAdmin,
  tipController.getTipsByPortfolio
);

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
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
router.get("/:id", requireAdmin, tipController.getTipById);

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
 *             type: object
 *             required:
 *               - title
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Buy below $150"
 *               content:
 *                 type: string
 *                 example: "This stock is undervalued at $150 and represents a good buying opportunity."
 *               status:
 *                 type: string
 *                 enum: [Active, Closed]
 *                 default: "Active"
 *               buyrange:
 *                 type: string
 *                 example: "140-155"
 *               targetprice:
 *                 type: string
 *                 example: "200"
 *               addmoreat:
 *                 type: string
 *                 example: "130"
 *               tipurl:
 *                 type: string
 *                 example: "https://example.com/analysis"
 *               horizon:
 *                 type: string
 *                 example: "Long Term"
 *               downloadLinks:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                       example: "Research PDF"
 *                     url:
 *                       type: string
 *                       example: "https://example.com/research.pdf"
 *     responses:
 *       201:
 *         description: Tip created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Tip'
 *       400:
 *         description: Invalid input
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.post(
  "/portfolios/:portfolioId/tips",
  requireAdmin,
  tipController.createTip
);

/**
 * @swagger
 * /api/tips:
 *   get:
 *     summary: Get all tips across all portfolios
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all tips
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Tip'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
router.get("/", requireAdmin, tipController.getalltipswithoutPortfolio);

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
 *             type: object
 *             required:
 *               - title
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Market Outlook Q2 2025"
 *               content:
 *                 type: string
 *                 example: "Our analysis suggests markets will trend higher in Q2 with technology leading."
 *               status:
 *                 type: string
 *                 enum: [Active, Closed]
 *                 default: "Active"
 *               buyRange:
 *                 type: string
 *                 example: "N/A"
 *               targetPrice:
 *                 type: string
 *                 example: "N/A"
 *               addMoreAt:
 *                 type: string
 *                 example: "N/A"
 *               tipUrl:
 *                 type: string
 *                 example: "https://example.com/market-outlook"
 *               horizon:
 *                 type: string
 *                 example: "Medium Term"
 *               downloadLinks:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                       example: "Full Report"
 *                     url:
 *                       type: string
 *                       example: "https://example.com/full-report.pdf"
 *     responses:
 *       201:
 *         description: Tip created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Tip'
 *       400:
 *         description: Invalid input
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 */
router.post("/", requireAdmin, tipController.createTipWithoutPortfolio);

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
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               content:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [Active, Closed]
 *               buyRange:
 *                 type: string
 *               targetPrice:
 *                 type: string
 *               addMoreAt:
 *                 type: string
 *               tipUrl:
 *                 type: string
 *               horizon:
 *                 type: string
 *               downloadLinks:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     url:
 *                       type: string
 *     responses:
 *       200:
 *         description: Updated tip
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Tip'
 *       400:
 *         description: Invalid input
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.put("/:id", requireAdmin, tipController.updateTip);

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
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
router.delete("/:id", requireAdmin, tipController.deleteTip);

/**
 * @swagger
 * tags:
 *   name: Download Links
 *   description: Management of downloadable resources within tips
 */

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
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Tip not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Tip not found"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
router.get("/:id/download-links", requireAdmin, tipController.getDownloadLinks);

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
 *             type: object
 *             required:
 *               - name
 *               - url
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Analyst Report"
 *                 description: Name of the document
 *               url:
 *                 type: string
 *                 example: "https://example.com/reports/analysis.pdf"
 *                 description: URL to the downloadable resource
 *     responses:
 *       201:
 *         description: Download link added successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DownloadLink'
 *       400:
 *         description: Invalid input
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Name and URL are required for download links"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Tip not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Tip not found"
 */
router.post("/:id/download-links", requireAdmin, tipController.addDownloadLink);

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
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Updated Report Name"
 *               url:
 *                 type: string
 *                 example: "https://example.com/reports/updated-file.pdf"
 *     responses:
 *       200:
 *         description: Updated download link
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DownloadLink'
 *       400:
 *         description: Invalid input
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "At least one field (name or URL) is required"
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Resource not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Resource not found"
 */
router.put("/:id/download-links/:linkId", requireAdmin, tipController.updateDownloadLink);

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
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         description: Resource not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Resource not found"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
router.delete("/:id/download-links/:linkId", requireAdmin, tipController.deleteDownloadLink);

module.exports = router;






