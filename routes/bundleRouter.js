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
 *         - category
 *       properties:
 *         _id:
 *           type: string
 *           format: objectid
 *         name:
 *           type: string
 *           example: "Premium Pack"
 *         description:
 *           type: string
 *           example: "Exclusive bundle for premium users"
 *         portfolios:
 *           type: array
 *           items:
 *             type: string
 *             format: objectid
 *           example: ["615a2d4b87d9c34f7d4f8a12", "615a2d4b87d9c34f7d4f8a13"]
 *         category:
 *           type: string
 *           enum: [basic, premium]
 *           example: "premium"
 *         monthlyPrice:
 *           type: number
 *           nullable: true
 *           example: 49.99
 *         monthlyemandateprice:
 *           type: number
 *           nullable: true
 *           example: 129.99
 *         quarterlyemandateprice:
 *           type: number
 *           nullable: true
 *           example: 349.99
 *         yearlyemandateprice:
 *           type: number
 *           nullable: true
 *           example: 1199.99
 *         yearlyPrice:
 *           type: number
 *           nullable: true
 *           example: 399.99
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
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
 *             name: "Starter Bundle"
 *             description: "Perfect for new investors"
 *             portfolios: ["615a2d4b87d9c34f7d4f8a12"]
 *             category: "basic"
 *             monthlyPrice: 29.99
 *             monthlyemandateprice: 79.99
 *             quarterlyemandateprice: 199.99
 *             yearlyemandateprice: 699.99
 *             yearlyPrice: 299.99
 *     responses:
 *       201:
 *         description: Bundle created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Bundle'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
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
 *             name: "Updated Premium Bundle"
 *             description: "Enhanced premium package"
 *             category: "premium"
 *             yearlyPrice: 449.99
 *     responses:
 *       200:
 *         description: Bundle updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Bundle'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
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
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Bundle not found
 */
router.delete('/:id', passport.authenticate('jwt', { session: false }), requireAdmin, bundleController.deleteBundle);

module.exports = router;