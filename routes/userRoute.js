/**
 * userRoute.js
 * ------------
 * Routes for regular users to access their portfolio data
 * and profile information.
 */
const express = require('express');
const router = express.Router();
const passport = require('passport');
const userController = require('../controllers/userController');

// Middleware to require authenticated user
const requireAuth = passport.authenticate('jwt', { session: false });

/**
 * @swagger
 * tags:
 *   name: User
 *   description: User profile and subscription management
 */

/**
 * @swagger
 * /api/user/profile:
 *   get:
 *     summary: Get user's profile information
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile data
 *       401:
 *         description: Unauthorized
 */
router.get('/profile', requireAuth, userController.getProfile);

// Custom middleware for optional authentication
const optionalAuth = (req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user) => {
    if (user) {
      req.user = user;
    }
    next();
  })(req, res, next);
};

/**
 * @swagger
 * /api/user/tips:
 *   get:
 *     summary: Get tips with subscription-based access control
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *       - {}  # Empty security requirement means optional authentication
 *     responses:
 *       200:
 *         description: List of tips with subscription-based access control
 *       500:
 *         description: Server error
 */
router.get('/tips', optionalAuth, userController.getTips);

/**
 * @swagger
 * /api/user/portfolios:
 *   get:
 *     summary: Get all available portfolios (public data only)
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of portfolios with limited data
 *       401:
 *         description: Unauthorized
 */
router.get('/portfolios', requireAuth, userController.getAllPortfolios);

/**
 * @swagger
 * /api/user/portfolios/{id}:
 *   get:
 *     summary: Get a portfolio by ID (public data only)
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portfolio ID
 *     responses:
 *       200:
 *         description: Portfolio data with limited fields
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Portfolio not found
 */
router.get('/portfolios/:id', requireAuth, userController.getPortfolioById);

/**
 * @swagger
 * /api/user/subscriptions:
 *   get:
 *     summary: Get user's subscriptions
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of user's subscriptions
 *       401:
 *         description: Unauthorized
 */
router.get('/subscriptions', requireAuth, userController.getUserSubscriptions);

/**
 * @swagger
 * /api/user/payments:
 *   get:
 *     summary: Get user's payment history
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of user's payments
 *       401:
 *         description: Unauthorized
 */
router.get('/payments', requireAuth, userController.getUserPaymentHistory);

/**
 * @swagger
 * /api/user/cart:
 *   get:
 *     summary: Get user's cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's shopping cart
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/cart', requireAuth, userController.getCart);

/**
 * @swagger
 * /api/user/cart:
 *   post:
 *     summary: Add product to cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productType
 *               - productId
 *             properties:
 *               productType:
 *                 type: string
 *                 enum: [Portfolio, Bundle]
 *                 description: Type of product to add
 *               productId:
 *                 type: string
 *                 description: ID of product to add
 *               planType:
 *                 type: string
 *                 enum: [monthly, quarterly, yearly]
 *                 default: monthly
 *                 description: Subscription plan type
 *               quantity:
 *                 type: integer
 *                 description: Quantity to add (default 1)
 *                 default: 1
 *     responses:
 *       200:
 *         description: Updated cart
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Product not found
 */
router.post('/cart', requireAuth, userController.addToCart);

/**
 * @swagger
 * /api/user/cart/{itemId}:
 *   delete:
 *     summary: Remove item from cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *         description: Cart item ID to remove
 *     responses:
 *       200:
 *         description: Updated cart
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Cart not found or item not in cart
 */
router.delete('/cart/:itemId', requireAuth, userController.removeFromCart);

/**
 * @swagger
 * /api/user/cart:
 *   delete:
 *     summary: Clear all items from cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cart cleared successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Cart not found
 */
router.delete('/cart', requireAuth, userController.clearCart);

module.exports = router;