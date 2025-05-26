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
 * securitySchemes:
 *   bearerAuth:
 *     type: http
 *     scheme: bearer
 *     bearerFormat: JWT
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
 *             description: "Best portfolios for new investors"
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
 *             discountPercentage: 25
 *     responses:
 *       200:
 *         description: Bundle updated successfully
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
