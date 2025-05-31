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
 *         - category
 *         - description
 *       properties:
 *         key:
 *           type: string
 *           description: Unique identifier for the config setting
 *         value:
 *           type: string
 *           description: Value for single-value configurations
 *         category:
 *           type: string
 *           enum: [smtp, payment, general, security, fmp_api, other]
 *           description: Category the config belongs to
 *         description:
 *           type: string
 *           description: Human-readable description
 *         isSecret:
 *           type: boolean
 *           description: Whether the config value should be masked
 *         isActive:
 *           type: boolean
 *           description: Whether the config is currently active
 *         isArray:
 *           type: boolean
 *           description: Whether this config stores an array of values
 *         arrayItems:
 *           type: array
 *           items:
 *             type: string
 *           description: Array values when isArray is true
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
 *           enum: [smtp, payment, general, security, fmp_api, other]
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
 *         description: Config key
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
 *               - category
 *               - description
 *             properties:
 *               key:
 *                 type: string
 *                 example: SMTP_CONFIG
 *               value:
 *                 type: string
 *                 example: smtp.example.com
 *               category:
 *                 type: string
 *                 enum: [smtp, payment, general, security, fmp_api, other]
 *                 example: smtp
 *               description:
 *                 type: string
 *                 example: SMTP server configuration
 *               isSecret:
 *                 type: boolean
 *                 example: true
 *               isArray:
 *                 type: boolean
 *                 example: false
 *               arrayItems:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: []
 *     responses:
 *       201:
 *         description: Configuration created
 *       400:
 *         description: Invalid input or duplicate key
 */
router.post('/', requireAdmin, configController.createConfig);

/**
 * @swagger
 * /api/admin/configs/{key}:
 *   put:
 *     summary: Update a configuration
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
 *                 example: updated_value
 *               category:
 *                 type: string
 *                 enum: [smtp, payment, general, security, fmp_api, other]
 *               description:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *               isSecret:
 *                 type: boolean
 *               isArray:
 *                 type: boolean
 *               arrayItems:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Configuration updated
 *       404:
 *         description: Configuration not found
 */
router.put('/:key', requireAdmin, configController.updateConfig);

/**
 * @swagger
 * /api/admin/configs/{key}:
 *   delete:
 *     summary: Delete a configuration
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
 *         description: Configuration deleted
 *       404:
 *         description: Configuration not found
 */
router.delete('/:key', requireAdmin, configController.deleteConfig);

/**
 * @swagger
 * /api/admin/configs/batch:
 *   post:
 *     summary: Batch create/update configurations
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
 *                   properties:
 *                     key:
 *                       type: string
 *                     value:
 *                       type: string
 *                     category:
 *                       type: string
 *                       enum: [smtp, payment, general, security, fmp_api, other]
 *                     description:
 *                       type: string
 *                     isSecret:
 *                       type: boolean
 *                     isArray:
 *                       type: boolean
 *                     arrayItems:
 *                       type: array
 *                       items:
 *                         type: string
 *     responses:
 *       200:
 *         description: Batch operation results
 *       400:
 *         description: Invalid input
 */
router.post('/batch', requireAdmin, configController.batchUpdateConfigs);

/**
 * @swagger
 * /api/admin/configs/test/smtp:
 *   post:
 *     summary: Test SMTP configuration
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
 *                 example: test@example.com
 *     responses:
 *       200:
 *         description: Test email sent
 *       400:
 *         description: Missing recipient email
 */
router.post('/test/smtp', requireAdmin, configController.testSmtpConfig);

module.exports = router;