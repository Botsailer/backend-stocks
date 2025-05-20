const router = require('express').Router();
const passport = require('passport');
const { requireRole } = require('../middleware/requireAdmin');
const bCtrl = require('../controllers/bundlecontroller');

/**
 * @swagger
 * tags:
 *   name: Bundles
 *   description: Portfolio bundle management
 * components:
 *   schemas:
 *     Bundle:
 *       type: object
 *       required:
 *         - name
 *         - portfolios
 *         - discountPercentage
 *         - subscription
 *       properties:
 *         name:
 *           type: string
 *           example: "Tech Mega Bundle"
 *         description:
 *           type: string
 *           example: "Combination of top tech portfolios"
 *         portfolios:
 *           type: array
 *           items:
 *             type: string
 *             format: objectid
 *             example: "65a2b3c4d5e6f7g8h9i0j1k"
 *         discountPercentage:
 *           type: number
 *           minimum: 0
 *           maximum: 100
 *           example: 20
 *         subscription:
 *           type: object
 *           required:
 *             - minInvestment
 *             - feeAmount
 *           properties:
 *             minInvestment:
 *               type: number
 *               example: 5000
 *             feeAmount:
 *               type: number
 *               example: 999.99
 *             feeCurrency:
 *               type: string
 *               default: "INR"
 *             feeInterval:
 *               type: string
 *               enum: ["one-time", "monthly", "yearly"]
 *               default: "one-time"
 *         discountedPrice:
 *           type: number
 *           readOnly: true
 *           example: 799.99
 */

router.use(passport.authenticate('jwt', { session: false }));
router.use(requireRole('admin'));

/**
 * @swagger
 * /bundles:
 *   post:
 *     summary: Create a new portfolio bundle
 *     tags: [Bundles]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Bundle'
 *           example:
 *             name: "Starter Bundle"
 *             description: "Beginner-friendly portfolios"
 *             portfolios: ["65a2b3c4d5e6f7g8h9i0j1k", "75b4c5d6e7f8g9h0i1j2k3l"]
 *             discountPercentage: 15
 *             subscription:
 *               minInvestment: 3000
 *               feeAmount: 499.99
 *               feeInterval: "monthly"
 *     responses:
 *       201:
 *         description: Bundle created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Bundle'
 */
router.post('/', bCtrl.createBundle);

/**
 * @swagger
 * /bundles/{id}:
 *   put:
 *     summary: Update a bundle
 *     tags: [Bundles]
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
 *     responses:
 *       200:
 *         description: Updated bundle
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Bundle'
 */
router.put('/:id', bCtrl.updateBundle);

/**
 * @swagger
 * /bundles:
 *   get:
 *     summary: Get all bundles
 *     tags: [Bundles]
 *     responses:
 *       200:
 *         description: List of bundles
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Bundle'
 */
router.get('/', bCtrl.getAllBundles);

module.exports = router;
