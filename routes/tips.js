// routes/tip.js
const express = require('express');
const router  = express.Router();
const tipController = require('../controllers/tipsController');
const requireAdmin = require('../middleware/requirreAdmin');

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     Tip:
 *       type: object
 *       required:
 *         - _id
 *         - portfolio
 *         - title
 *         - content
 *         - status
 *         - createdAt
 *         - updatedAt
 *       properties:
 *         _id:
 *           type: string
 *           description: Unique identifier of the tip
 *           example: 60f72b8a2e4e3c0015c4d1a2
 *         portfolio:
 *           type: string
 *           description: ObjectId of the portfolio this tip belongs to
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
 *           example: "Active"
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
 *   description: Admin-only CRUD for portfolio tips
 */

/**
 * @swagger
 * /api/portfolios/{portfolioId}/tips:
 *   get:
 *     summary: List all tips for a given portfolio
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema:
 *           type: string
 *           example: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *         description: JWT access token
 *       - in: path
 *         name: portfolioId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ObjectId of the portfolio to retrieve tips for
 *         example: 60f72a9b1d2f3b0014b3c0f1
 *     responses:
 *       200:
 *         description: An array of Tip objects, newest first
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Tip'
 *       401:
 *         description: Missing/Malformed or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Missing or malformed token
 *       403:
 *         description: User is not an admin
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Admin only
 */
router.get(
  '/portfolios/:portfolioId/tips',
  requireAdmin,
  tipController.getTipsByPortfolio
);

/**
 * @swagger
 * /api/tips/{id}:
 *   get:
 *     summary: Get a single tip by its ID
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema:
 *           type: string
 *           example: Bearer eyJhbGciOiJI...
 *         description: JWT access token
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ObjectId of the Tip
 *         example: 60f72b8a2e4e3c0015c4d1a2
 *     responses:
 *       200:
 *         description: Tip found and returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Tip'
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
 *                   example: Not found
 */
router.get(
  '/tips/:id',
  requireAdmin,
  tipController.getTipById
);

/**
 * @swagger
 * /api/portfolios/{portfolioId}/tips:
 *   post:
 *     summary: Create a new tip under a portfolio
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema:
 *           type: string
 *           example: Bearer eyJhbGciOi...
 *         description: JWT access token
 *       - in: path
 *         name: portfolioId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ObjectId of the portfolio
 *         example: 60f72a9b1d2f3b0014b3c0f1
 *     requestBody:
 *       description: Tip object that needs to be added
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - content
 *             properties:
 *               title:
 *                 type: string
 *                 description: Title of the tip
 *                 example: "Review asset allocation"
 *               content:
 *                 type: string
 *                 description: Detailed advice content
 *                 example: "Ensure you review and rebalance according to market changes."
 *               status:
 *                 type: string
 *                 description: Current status of the tip
 *                 enum: [Active, Closed]
 *                 example: Active
 *     responses:
 *       201:
 *         description: Tip successfully created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Tip'
 *       400:
 *         description: Invalid portfolio ID or validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Invalid portfolio
 */
router.post(
  '/portfolios/:portfolioId/tips',
  requireAdmin,
  tipController.createTip
);

/**
 * @swagger
 * /api/tips/{id}:
 *   put:
 *     summary: Update an existing tip by ID
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema:
 *           type: string
 *           example: Bearer eyJhbGc...
 *         description: JWT access token
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ObjectId of the Tip to update
 *         example: 60f72b8a2e4e3c0015c4d1a2
 *     requestBody:
 *       description: Fields to update in the Tip
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Updated title"
 *               content:
 *                 type: string
 *                 example: "Updated detailed content."
 *               status:
 *                 type: string
 *                 enum: [Active, Closed]
 *                 example: Closed
 *     responses:
 *       200:
 *         description: Tip updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Tip'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Validation failed
 *       404:
 *         description: Tip not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Not found
 */
router.put(
  '/tips/:id',
  requireAdmin,
  tipController.updateTip
);

/**
 * @swagger
 * /api/tips/{id}:
 *   delete:
 *     summary: Delete a tip by its ID
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema:
 *           type: string
 *           example: Bearer eyJhbG...
 *         description: JWT access token
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Tip ObjectId to delete
 *         example: 60f72b8a2e4e3c0015c4d1a2
 *     responses:
 *       200:
 *         description: Tip deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Tip deleted
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
 *                   example: Not found
 */
router.delete(
  '/tips/:id',
  requireAdmin,
  tipController.deleteTip
);

module.exports = router;
