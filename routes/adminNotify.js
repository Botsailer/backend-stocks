/**
 * routes/adminNotifications.js
 * ---------------------------
 * Admin endpoints for sending notifications to portfolio subscribers
 */
const express = require('express');
const routerAdmin = express.Router();
const adminController = require('../controllers/adminNotificationController');
const requireAdmin = require('../middleware/requirreAdmin');

/**
 * @swagger
 * /api/admin/notify:
 *   post:
 *     summary: Send email notification to portfolio subscribers
 *     description: |
 *       Sends an email notification to all active subscribers of a portfolio.
 *       Uses SMTP configuration from database settings, falling back to environment variables if needed.
 *     tags: [Admin Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - portfolioId
 *               - subject
 *               - message
 *             properties:
 *               portfolioId:
 *                 type: string
 *                 description: MongoDB ObjectId of the target portfolio
 *                 example: "60d5ec9bfa9747c9486b1ee1"
 *               subject:
 *                 type: string
 *                 description: Email subject line
 *                 example: "Important Portfolio Update"
 *               message:
 *                 type: string
 *                 description: Email body content (can include newlines)
 *                 example: "We've rebalanced the portfolio to include new assets.\nPlease review the changes."
 *     responses:
 *       200:
 *         description: Emails sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 mailedTo:
 *                   type: integer
 *                   description: Number of subscribers who received the email
 *                   example: 24
 *                 emailsSent:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: List of recipient email addresses
 *       400:
 *         description: Missing required parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "portfolioId, subject, and message are required"
 *       404:
 *         description: No active subscribers found for the portfolio
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "No active subscribers found"
 *       500:
 *         description: Server error while sending notifications
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Failed to send notifications: SMTP connection failed"
 */
routerAdmin.post('/notify', requireAdmin, adminController.sendNotifications);

module.exports = routerAdmin;