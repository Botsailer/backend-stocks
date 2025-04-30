// routes/tip.js
const express = require('express');
const router  = express.Router();
const tipController = require('../controllers/tipsController');
const requireAdmin = require('../middleware/requirreAdmin');

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
 *     summary: List tips for a portfolio
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: portfolioId
 *         required: true
 *         schema:
 *           type: string
 *         description: Portfolio ObjectId
 *     responses:
 *       200:
 *         description: Array of tips
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Tip'
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
 *     summary: Retrieve a tip by ID
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Tip ObjectId
 *     responses:
 *       200:
 *         description: Single tip
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Tip'
 *       404:
 *         description: Not Found
 */
router.get('/tips/:id', requireAdmin, tipController.getTipById);

/**
 * @swagger
 * /api/portfolios/{portfolioId}/tips:
 *   post:
 *     summary: Create a new tip for a portfolio
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: portfolioId
 *         required: true
 *         schema:
 *           type: string
 *         description: Portfolio ObjectId
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, content]
 *             properties:
 *               title:
 *                 type: string
 *               content:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [Active, Closed]
 *     responses:
 *       201:
 *         description: Tip created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Tip'
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
 *     summary: Update an existing tip
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Tip ObjectId
 *     requestBody:
 *       required: true
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
 *     responses:
 *       200:
 *         description: Tip updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Tip'
 *       404:
 *         description: Not Found
 */
router.put('/tips/:id', requireAdmin, tipController.updateTip);

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
 *         required: true
 *         schema:
 *           type: string
 *         description: Tip ObjectId
 *     responses:
 *       200:
 *         description: Tip deleted
 *       404:
 *         description: Not Found
 */
router.delete('/tips/:id', requireAdmin, tipController.deleteTip);

module.exports = router;
