const express = require('express');
const router = express.Router();
const configController = require('../controllers/configController');
const requireAdmin = require('../middleware/requirreAdmin'); 

/**
 * @swagger
 * tags:
 *   name: Configuration
 *   description: Admin-only endpoints for managing system configuration
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ConfigSetting:
 *       type: object
 *       required:
 *         - key
 *         - value
 *         - category
 *         - description
 *       properties:
 *         key:
 *           type: string
 *           description: Unique identifier for the config setting (e.g., EMAIL_HOST)
 *         value:
 *           type: string
 *           description: Value of the configuration setting
 *         category:
 *           type: string
 *           enum: [smtp, payment, general, security]
 *           description: Category the config belongs to
 *         description:
 *           type: string
 *           description: Human-readable description of what this config does
 *         isSecret:
 *           type: boolean
 *           description: Whether the config value should be masked in responses
 *         isActive:
 *           type: boolean
 *           description: Whether the config is currently active
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: When the config was created
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: When the config was last updated
 */

/**
 * @swagger
 * /api/admin/configs:
 *   get:
 *     summary: Get all configuration settings
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [smtp, payment, general, security]
 *         description: Filter configs by category
 *     responses:
 *       200:
 *         description: List of configuration settings
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ConfigSetting'
 *       403:
 *         description: Not authorized as admin
 */
router.get('/', requireAdmin, configController.getAllConfigs);

/**
 * @swagger
 * /api/admin/configs/{key}:
 *   get:
 *     summary: Get configuration setting by key
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Config key (e.g., EMAIL_HOST)
 *     responses:
 *       200:
 *         description: Configuration setting
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ConfigSetting'
 *       404:
 *         description: Configuration not found
 */
router.get('/:key', requireAdmin, configController.getConfigByKey);

/**
 * @swagger
 * /api/admin/configs:
 *   post:
 *     summary: Create a new configuration setting
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - key
 *               - value
 *               - category
 *               - description
 *             properties:
 *               key:
 *                 type: string
 *                 description: Unique config key (e.g., EMAIL_HOST)
 *                 example: EMAIL_HOST
 *               value:
 *                 type: string
 *                 description: Config value
 *                 example: smtp.example.com
 *               category:
 *                 type: string
 *                 enum: [smtp, payment, general, security]
 *                 description: Config category
 *                 example: smtp
 *               description:
 *                 type: string
 *                 description: Human-readable description
 *                 example: SMTP server host address
 *               isSecret:
 *                 type: boolean
 *                 description: Whether to mask the value in responses
 *                 example: false
 *     responses:
 *       201:
 *         description: Configuration created successfully
 *       400:
 *         description: Invalid input or duplicate key
 */
router.post('/', requireAdmin, configController.createConfig);

/**
 * @swagger
 * /api/admin/configs/{key}:
 *   put:
 *     summary: Update an existing configuration setting
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Config key to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               value:
 *                 type: string
 *                 description: New config value
 *               description:
 *                 type: string
 *                 description: Updated description
 *               isActive:
 *                 type: boolean
 *                 description: Whether config is active
 *               isSecret:
 *                 type: boolean
 *                 description: Whether to mask the value
 *     responses:
 *       200:
 *         description: Configuration updated successfully
 *       404:
 *         description: Configuration not found
 */
router.put('/:key', requireAdmin, configController.updateConfig);

/**
 * @swagger
 * /api/admin/configs/{key}:
 *   delete:
 *     summary: Delete a configuration setting
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Config key to delete
 *     responses:
 *       200:
 *         description: Configuration deleted successfully
 *       404:
 *         description: Configuration not found
 */
router.delete('/:key', requireAdmin, configController.deleteConfig);

/**
 * @swagger
 * /api/admin/configs/batch:
 *   post:
 *     summary: Create or update multiple configurations at once
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - configs
 *             properties:
 *               configs:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - key
 *                     - value
 *                   properties:
 *                     key:
 *                       type: string
 *                       example: EMAIL_HOST
 *                     value:
 *                       type: string
 *                       example: smtp.example.com
 *                     category:
 *                       type: string
 *                       example: smtp
 *                     description:
 *                       type: string
 *                       example: SMTP server host
 *     responses:
 *       200:
 *         description: Results of batch operation
 *       400:
 *         description: Invalid input format
 */
router.post('/batch', requireAdmin, configController.batchUpdateConfigs);

/**
 * @swagger
 * /api/admin/configs/test/smtp:
 *   post:
 *     summary: Test SMTP configuration by sending a test email
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *             properties:
 *               to:
 *                 type: string
 *                 format: email
 *                 description: Recipient email address
 *                 example: test@example.com
 *     responses:
 *       200:
 *         description: Test email sent successfully
 *       400:
 *         description: Missing recipient email
 *       500:
 *         description: Failed to send email
 */
router.post('/test/smtp', requireAdmin, configController.testSmtpConfig);

module.exports = router;