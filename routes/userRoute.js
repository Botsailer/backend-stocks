/**
 * userRoute.js
 * ------------
 * Routes for user profile, portfolio access, tips, subscriptions, payments, and cart management.
 */
const express = require('express');
const router = express.Router();
const passport = require('passport');
const userController = require('../controllers/userController');
const { getalltipswithoutPortfolio, getalltipswithoutPortfolioUser } = require('../controllers/tipsController');

// Middleware for required authentication
const requireAuth = passport.authenticate('jwt', { session: false });

// Middleware for optional authentication (authenticates if token present)
const optionalAuth = (req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user) => {
    if (user) req.user = user;
    next();
  })(req, res, next);
};

/**
 * @swagger
 * tags:
 *   - name: User Profile
 *     description: User account management
 *   - name: Portfolios
 *     description: Public portfolio information
 *   - name: Tips
 *     description: Investment tips with access control
 *   - name: Subscriptions
 *     description: User subscription management
 *   - name: Payments
 *     description: Payment history
 *   - name: Cart
 *     description: Shopping cart operations
 */

// ======================
//  User Profile Routes
// ======================
/**
 * @swagger
 * /api/user/profile:
 *   get:
 *     summary: Get authenticated user's profile
 *     description: Returns non-sensitive user information. Requires authentication.
 *     tags: [User Profile]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 username:
 *                   type: string
 *                 email:
 *                   type: string
 *                 emailVerified:
 *                   type: boolean
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized - Missing or invalid token
 *       404:
 *         description: User not found
 */
router.get('/profile', requireAuth, userController.getProfile);

// ======================
//  Portfolio Routes
// ======================
/**
 * @swagger
 * /api/user/portfolios:
 *   get:
 *     summary: Get all available portfolios
 *     description: Returns public portfolio information. Accessible without authentication.
 *     tags: [Portfolios]
 *     responses:
 *       200:
 *         description: List of portfolios with public data
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   description:
 *                     type: string
 *                   minInvestment:
 *                     type: number
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *       500:
 *         description: Server error
 */
router.get('/portfolios', userController.getAllPortfolios);

/**
 * @swagger
 * /api/user/portfolios/{id}:
 *   get:
 *     summary: Get portfolio details by ID
 *     description: Returns public information for a specific portfolio. Accessible without authentication.
 *     tags: [Portfolios]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Portfolio ID
 *     responses:
 *       200:
 *         description: Portfolio details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 description:
 *                   type: string
 *                 subscriptionFee:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       type:
 *                         type: string
 *                       price:
 *                         type: number
 *                 minInvestment:
 *                   type: number
 *                 durationMonths:
 *                   type: number
 *       404:
 *         description: Portfolio not found
 *       500:
 *         description: Server error
 */
router.get('/portfolios/:id', userController.getPortfolioById);

// ======================
//  Tips Routes
// ======================
/**
 * @swagger
 * /api/user/tips:
 *   get:
 *     summary: Get investment tips with access control
 *     description: |
 *       Returns tips with content visibility based on user's subscription status.
 *       - Unauthenticated users see only tip titles
 *       - Authenticated users see full content for tips they're subscribed to
 *       - Portfolio-specific tips require subscription to that portfolio
 *       - Premium tips require premium bundle subscription
 *       - Basic tips require any active subscription
 *     tags: [Tips]
 *     security: []
 *     responses:
 *       200:
 *         description: List of tips with appropriate access
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 oneOf:
 *                   - $ref: '#/components/schemas/RestrictedTip'
 *                   - $ref: '#/components/schemas/FullTip'
 *       500:
 *         description: Server error
 * 
 * components:
 *   schemas:
 *     RestrictedTip:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         title:
 *           type: string
 *         portfolio:
 *           type: object
 *           properties:
 *             _id:
 *               type: string
 *             name:
 *               type: string
 *         category:
 *           type: string
 *           enum: [basic, premium]
 *     FullTip:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         title:
 *           type: string
 *         content:
 *           type: string
 *         status:
 *           type: string
 *         buyrange:
 *           type: string
 *         targetprice:
 *           type: string
 *         addmoreat:
 *           type: string
 *         tipurl:
 *           type: string
 *         horizon:
 *           type: string
 *         portfolio:
 *           type: object
 *           properties:
 *             _id:
 *               type: string
 *             name:
 *               type: string
 *         category:
 *           type: string
 *           enum: [basic, premium]
 */
router.get('/tips', optionalAuth, userController.getTips);



//** tips without portfolio */
/** * @swagger
 * /api/user/tips/without-portfolio:
 *   get:
 *     summary: Get all tips without portfolio association
 *     description: Returns all tips that are not associated with any portfolio.
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of tips without portfolio
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   title:
 *                     type: string
 *                   content:
 *                     type: string
 *                   status:
 *                     type: string
 *                   buyrange:
 *                     type: string
 *                   targetprice:
 *                     type: string
 *                   addmoreat:
 *                     type: string
 *                   tipurl:
 *                     type: string
 *                   horizon:
 *                     type: string
 *                   category:
 *                     type: string
 *                     enum: [basic, premium]
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: Unauthorized - Missing or invalid token
 *       500:
 *         description: Server error
 */
router.get('/tips/without-portfolio', requireAuth, getalltipswithoutPortfolioUser);



// ======================
//  Subscription Routes
// ======================
/**
 * @swagger
 * /api/user/subscriptions:
 *   get:
 *     summary: Get user's active subscriptions
 *     description: Returns list of subscriptions for authenticated user.
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of user subscriptions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   productId:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                       name:
 *                         type: string
 *                   startDate:
 *                     type: string
 *                     format: date-time
 *                   endDate:
 *                     type: string
 *                     format: date-time
 *                   isActive:
 *                     type: boolean
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/subscriptions', requireAuth, userController.getUserSubscriptions);

// ======================
//  Payment Routes
// ======================
/**
 * @swagger
 * /api/user/payments:
 *   get:
 *     summary: Get user's payment history
 *     description: Returns payment records for authenticated user.
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of payment records
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   amount:
 *                     type: number
 *                   currency:
 *                     type: string
 *                   status:
 *                     type: string
 *                   portfolio:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                       name:
 *                         type: string
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/payments', requireAuth, userController.getUserPaymentHistory);

// ======================
//  Cart Routes
// ======================
/**
 * @swagger
 * /api/user/cart:
 *   get:
 *     summary: Get user's shopping cart
 *     description: Returns current cart contents for authenticated user.
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Shopping cart contents
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 user:
 *                   type: string
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       portfolio:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           name:
 *                             type: string
 *                           subscriptionFee:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 type:
 *                                   type: string
 *                                 price:
 *                                   type: number
 *                       quantity:
 *                         type: number
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Cart not found
 */
router.get('/cart', requireAuth, userController.getCart);

/**
 * @swagger
 * /api/user/cart:
 *   post:
 *     summary: Add portfolio to cart
 *     description: Adds a portfolio to the authenticated user's shopping cart.
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
 *               - portfolioId
 *             properties:
 *               portfolioId:
 *                 type: string
 *                 description: ID of the portfolio to add
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 default: 1
 *                 description: Quantity to add
 *     responses:
 *       200:
 *         description: Updated cart contents
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Portfolio not found
 */
router.post('/cart', requireAuth, userController.addToCart);

/**
 * @swagger
 * /api/user/cart/{portfolioId}:
 *   delete:
 *     summary: Remove portfolio from cart
 *     description: Removes a specific portfolio from the authenticated user's cart.
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: portfolioId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of portfolio to remove
 *     responses:
 *       200:
 *         description: Updated cart contents
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Cart or item not found
 */
router.delete('/cart/:portfolioId', requireAuth, userController.removeFromCart);

/**
 * @swagger
 * /api/user/cart:
 *   delete:
 *     summary: Clear shopping cart
 *     description: Removes all items from the authenticated user's cart.
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cart cleared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 cart:
 *                   $ref: '#/components/schemas/Cart'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Cart not found
 * 
 *   components:
 *     schemas:
 *       Cart:
 *         type: object
 *         properties:
 *           _id:
 *             type: string
 *           user:
 *             type: string
 *           items:
 *             type: array
 *             items: {}
 */
router.delete('/cart', requireAuth, userController.clearCart);

module.exports = router;