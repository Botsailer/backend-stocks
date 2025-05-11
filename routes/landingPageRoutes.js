// routes/landingPageRoutes.js
const express = require('express');
const router = express.Router();
const landingPageController = require('../controllers/LandingPageController');

/**
 * @swagger
 * tags:
 *   name: Landing Page
 *   description: Endpoints for managing the landing page configuration.
 */

/**
 * @swagger
 * /landing-page:
 *   get:
 *     summary: Retrieve the landing page configuration.
 *     description: Fetches the entire landing page configuration from the database.
 *     tags: [Landing Page]
 *     responses:
 *       200:
 *         description: Landing page configuration retrieved successfully.
 *       404:
 *         description: Landing page configuration not found.
 *       500:
 *         description: Internal server error.
 */
router.get('/', landingPageController.getLandingPage);

/**
 * @swagger
 * /landing-page:
 *   post:
 *     summary: Create or update the landing page configuration.
 *     description: Creates or updates the landing page configuration using a complete payload.
 *     tags: [Landing Page]
 *     requestBody:
 *       description: Landing page configuration data.
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               companyName:
 *                 type: string
 *               tagline:
 *                 type: string
 *               metaTitle:
 *                 type: string
 *               metaDescription:
 *                 type: string
 *               contactInfo:
 *                 type: object
 *               socialMedia:
 *                 type: object
 *               theme:
 *                 type: object
 *               customCSS:
 *                 type: string
 *               customJS:
 *                 type: string
 *               logoBase64:
 *                 type: string
 *               logoContentType:
 *                 type: string
 *               sections:
 *                 type: object
 *                 properties:
 *                   signIn:
 *                     type: object
 *                   navigation:
 *                     type: object
 *                   hero:
 *                     type: object
 *                   pricing:
 *                     type: object
 *                   springCards:
 *                     type: object
 *                   dragCards:
 *                     type: object
 *                   faq:
 *                     type: object
 *                   form:
 *                     type: object
 *                   links:
 *                     type: object
 *                   footer:
 *                     type: object
 *               innerTabs:
 *                 type: object
 *                 properties:
 *                   recommendations:
 *                     type: object
 *                   modelPortfolio:
 *                     type: object
 *                   dashboard:
 *                     type: object
 *     responses:
 *       200:
 *         description: Landing page configuration created or updated successfully.
 *       500:
 *         description: Error processing request.
 */
router.post('/', landingPageController.createOrUpdateLandingPage);

/**
 * @swagger
 * /landing-page:
 *   put:
 *     summary: Update the landing page configuration.
 *     description: Updates the landing page configuration. Use this endpoint for partial or full updates.
 *     tags: [Landing Page]
 *     requestBody:
 *       description: Landing page configuration data.
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties: 
 *               companyName:
 *                 type: string
 *               tagline:
 *                 type: string
 *               metaTitle:
 *                 type: string
 *               metaDescription:
 *                 type: string
 *               contactInfo:
 *                 type: object
 *               socialMedia:
 *                 type: object
 *               theme:
 *                 type: object
 *               customCSS:
 *                 type: string
 *               customJS:
 *                 type: string
 *               logoBase64:
 *                 type: string
 *               logoContentType:
 *                 type: string
 *               sections:
 *                 type: object
 *                 properties:
 *                   signIn:
 *                     type: object
 *                   navigation:
 *                     type: object
 *                   hero:
 *                     type: object
 *                   pricing:
 *                     type: object
 *                   springCards:
 *                     type: object
 *                   dragCards:
 *                     type: object
 *                   faq:
 *                     type: object
 *                   form:
 *                     type: object
 *                   links:
 *                     type: object
 *                   footer:
 *                     type: object
 *               innerTabs:
 *                 type: object
 *                 properties:
 *                   recommendations:
 *                     type: object
 *                   modelPortfolio:
 *                     type: object
 *                   dashboard:
 *                     type: object
 *     responses:
 *       200:
 *         description: Landing page configuration updated successfully.
 *       500:
 *         description: Error processing request.
 */
router.put('/', landingPageController.createOrUpdateLandingPage);

module.exports = (dbAdapter) => router;
