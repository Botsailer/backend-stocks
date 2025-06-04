const router = require('express').Router();
const passport = require('passport');
const bundleController = require('../controllers/bundlecontroller');
const requireAdmin = require('../middleware/requirreAdmin');

/**
 * @swagger
 * tags:
 *   name: Bundles
 *   description: Portfolio bundle management
 * 
 * components:
 *   schemas:
 *     Bundle:
 *       type: object
 *       required:
 *         - name
 *         - portfolios
 *         - discountPercentage
 *       properties:
 *         _id:
 *           type: string
 *           format: objectid
 *         name:
 *           type: string
 *           example: "Starter Pack"
 *         description:
 *           type: string
 *           description: "Description of the bundle"
 *           example: "Curated bundle for new investors"
 *         portfolios:
 *           type: array
 *           items:
 *             type: string
 *             format: objectid
 *           description: Array of Portfolio IDs
 *           example: ["615a2d4b87d9c34f7d4f8a12", "615a2d4b87d9c34f7d4f8a13"]
 *         discountPercentage:
 *           type: number
 *           minimum: 0
 *           maximum: 100
 *           example: 15
 *         monthlyPrice:
 *           type: number
 *           description: "Auto-calculated monthly price after discount"
 *         quarterlyPrice:
 *           type: number
 *           description: "Auto-calculated quarterly price after discount"
 *         yearlyPrice:
 *           type: number
 *           description: "Auto-calculated yearly price after discount"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           readOnly: true
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           readOnly: true
 */

/**
 * @swagger
 * /api/bundles:
 *   post:
 *     summary: Create a new portfolio bundle
 *     tags: [Bundles]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Bundle'
 *           example:
 *             name: "Starter Pack"
 *             description: "Curated bundle for new investors"
 *             portfolios: ["615a2d4b87d9c34f7d4f8a12", "615a2d4b87d9c34f7d4f8a13"]
 *             discountPercentage: 20
 *     responses:
 *       201:
 *         description: Bundle created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Bundle'
 */
router.post('/', passport.authenticate('jwt', { session: false }), requireAdmin, bundleController.createBundle);

/**
 * @swagger
 * /api/bundles/{id}:
 *   put:
 *     summary: Update a bundle
 *     tags: [Bundles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Bundle'
 *           example:
 *             name: "Updated Starter Pack"
 *             description: "Now for everyone"
 *             portfolios: ["615a2d4b87d9c34f7d4f8a12"]
 *             discountPercentage: 25
 *     responses:
 *       200:
 *         description: Bundle updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Bundle'
 *       404:
 *         description: Bundle not found
 */
router.put('/:id', passport.authenticate('jwt', { session: false }), requireAdmin, bundleController.updateBundle);

/**
 * @swagger
 * /api/bundles:
 *   get:
 *     summary: Get all bundles
 *     tags: [Bundles]
 *     responses:
 *       200:
 *         description: List of all bundles
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Bundle'
 */
router.get('/', bundleController.getAllBundles);

/**
 * @swagger
 * /api/bundles/{id}:
 *   get:
 *     summary: Get bundle by ID
 *     tags: [Bundles]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Bundle details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Bundle'
 *       404:
 *         description: Bundle not found
 */
router.get('/:id', bundleController.getBundleById);

/**
 * @swagger
 * /api/bundles/{id}:
 *   delete:
 *     summary: Delete a bundle
 *     tags: [Bundles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Bundle deleted successfully
 *       404:
 *         description: Bundle not found
 */
router.delete('/:id', passport.authenticate('jwt', { session: false }), requireAdmin, bundleController.deleteBundle);

module.exports = router;