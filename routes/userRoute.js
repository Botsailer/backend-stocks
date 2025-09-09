/**
 * userRoute.js
 * ------------
 * Production-ready routes for user operations with JWT authentication
 * Includes portfolio access control, subscription management, and cart operations
 */
const express = require('express');
const router = express.Router();
const passport = require('passport');
const userController = require('../controllers/userController');
const { getUserSubscriptions } = require('../controllers/subscriptionController');

// Enhanced authentication middleware
const requireAuth = passport.authenticate('jwt', { session: false });

const optionalAuth = (req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user) => {
    req.user = user || null;  // Standardized user object handling
    next();
  })(req, res, next);
};

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: 5f8d04b3ab3456782e4c6d12
 *         username:
 *           type: string
 *           example: "johndoe"
 *         email:
 *           type: string
 *           format: email
 *           example: "john@example.com"
 *         fullName:
 *           type: string
 *           example: "John Doe"
 *         dateofBirth:
 *           type: string
 *           format: date
 *           example: "1990-01-01"
 *         phone:
 *           type: string
 *           example: "+1234567890"
 *         pnadetails:
 *           type: string
 *           example: "Additional details"
 *         emailVerified:
 *           type: boolean
 *           example: true
 *         profileComplete:
 *           type: boolean
 *           example: true
 *         pandetails:
 *           type: string
 *           example: "ABCDE1234F"
 *         adharcard:
 *           type: string
 *           example: "1234-5678-9012"
 *         address:
 *           type: string
 *           example: "123 Main St, Anytown, USA"
 *         forceComplete:
 *           type: boolean
 *           example: false
 *         missingFields:
 *           type: array
 *           items:
 *             type: string
 *           example: ["phone", "dateofBirth"]
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 * 
 *     Portfolio:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: 5f8d04b3ab3456782e4c6d12
 *         name:
 *           type: string
 *           example: "Tech Growth Portfolio"
 *         description:
 *           type: string
 *           example: "Technology focused growth stocks"
 *         subscriptionFee:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [monthly, quarterly, annual]
 *                 example: "annual"
 *               price:
 *                 type: number
 *                 example: 299
 *         minInvestment:
 *           type: number
 *           example: 5000
 *         durationMonths:
 *           type: number
 *           example: 12
 *         createdAt:
 *           type: string
 *           format: date-time
 *         CAGRSinceInception:
 *           type: number
 *           example: 15.2
 *         oneYearGains:
 *           type: number
 *           example: 22.5
 *         monthlyGains:
 *           type: number
 *           example: 1.8
 * 
 *     RestrictedPortfolio:
 *       allOf:
 *         - $ref: '#/components/schemas/Portfolio'
 *         - type: object
 *           properties:
 *             message:
 *               type: string
 *               example: "Subscribe to view complete details"
 * 
 *     TipWithPortfolio:
 *       allOf:
 *         - $ref: '#/components/schemas/Tip'
 *         - type: object
 *           properties:
 *             portfolio:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 name:
 *                   type: string
 *     
 *     RestrictedTipWithPortfolio:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         title:
 *           type: string
 *         stockId:
 *           type: string
 *         category:
 *           type: string
 *           enum: [basic, premium]
 *         portfolio:
 *           type: object
 *           properties:
 *             _id:
 *               type: string
 *             name:
 *               type: string
 *         status:
 *           type: string
 *         action:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *         message:
 *           type: string
 *           example: "Subscribe to this portfolio to view details"
 * 
 *     Subscription:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         productType:
 *           type: string
 *           enum: [Portfolio, Bundle]
 *         productId:
 *           $ref: '#/components/schemas/Portfolio'
 *         startDate:
 *           type: string
 *           format: date-time
 *         endDate:
 *           type: string
 *           format: date-time
 *         isActive:
 *           type: boolean
 * 
 *     CartItem:
 *       type: object
 *       properties:
 *         portfolio:
 *           $ref: '#/components/schemas/Portfolio'
 *         quantity:
 *           type: number
 * 
 *     Cart:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         user:
 *           type: string
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/CartItem'
 * 
 *   responses:
 *     Unauthorized:
 *       description: Missing or invalid authentication token
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               error:
 *                 type: string
 *                 example: "Unauthorized access"
 * 
 *     ValidationError:
 *       description: Request validation failed
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               error:
 *                 type: string
 *                 example: "Username already taken"
 * 
 *     ServerError:
 *       description: Internal server error
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               error:
 *                 type: string
 *                 example: "Database connection failed"
 */

// ======================
//  User Profile Routes
// ======================
/**
 * @swagger
 * /api/user/profile:
 *   get:
 *     summary: Get authenticated user's profile
 *     description: Returns user profile information with completion status, missing fields, and force complete flag
 *     tags: [User Profile]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile data with completion status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "User not found"
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/profile', requireAuth, userController.getProfile);
/**
 * @swagger
 * /api/user/profile:
 *   put:
 *     summary: Update user profile
 *     description: |
 *       Partially update user profile information. 
 *       - Username and email must be unique
 *       - Changing email will reset email verification status
 *       - Required fields for complete profile: fullName, dateofBirth, phone
 *       - Users with active subscriptions are forced to complete profile
 *       - PAN card must follow Indian format: AAAAA9999A
 *     tags: [User Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *                 description: Must be unique across all users
 *                 minLength: 3
 *                 maxLength: 20
 *                 example: "johndoe123"
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Must be unique, will reset email verification
 *                 example: "newemail@example.com"
 *               fullName:
 *                 type: string
 *                 description: User's full name (required for complete profile)
 *                 minLength: 2
 *                 maxLength: 100
 *                 example: "John Doe"
 *               dateofBirth:
 *                 type: string
 *                 format: date
 *                 description: User's date of birth (required for complete profile)
 *                 example: "1990-01-01"
 *               phone:
 *                 type: string
 *                 description: User's phone number (required for complete profile)
 *                 example: "+1234567890"
 *               pnadetails:
 *                 type: string
 *                 description: Indian PAN card number in format AAAAA9999A
 *                 pattern: "^[A-Z]{5}[0-9]{4}[A-Z]{1}$"
 *                 example: "ABCDE1234F"
 *           examples:
 *             partial_update:
 *               summary: Partial profile update
 *               value:
 *                 fullName: "John Doe"
 *                 phone: "+1234567890"
 *             complete_update:
 *               summary: Complete profile update with PAN
 *               value:
 *                 username: "johndoe123"
 *                 fullName: "John Doe"
 *                 dateofBirth: "1990-01-01"
 *                 phone: "+1234567890"
 *                 pandetails: "ABCDE1234F"
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/User'
 *                 - type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                       example: "Profile updated successfully"
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *         examples:
 *           username_taken:
 *             summary: Username already exists
 *             value:
 *               error: "Username already taken"
 *           email_taken:
 *             summary: Email already exists
 *             value:
 *               error: "Email already registered"
 *           validation_error:
 *             summary: Field validation failed
 *             value:
 *               error: "Username must be at least 3 characters long"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "User not found"
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.put('/profile', requireAuth, userController.updateProfile);

/**
 * @swagger
 * /api/user/esign/verify:
 *   get:
 *     summary: Verify the status of the authenticated user's eSign request
 *     tags: [User Profile]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         description: Optional documentId or sessionId to look up a specific eSign request
 *     responses:
 *       200:
 *         description: eSign status returned
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: No eSign request found
 */
router.get('/esign/verify', requireAuth, userController.verifyEsignStatus);

// ======================
//  Portfolio Routes
// ======================
/**
 * @swagger
 * /api/user/portfolios:
 *   get:
 *     summary: Get all available portfolios
 *     description: |
 *       Returns portfolio information with access control:
 *       - Unauthenticated users see basic portfolio details
 *       - Authenticated users see full details for subscribed portfolios
 *     tags: [Portfolios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter portfolios created after this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter portfolios created before this date
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [basic, premium]
 *         description: Filter by portfolio category
 *     responses:
 *       200:
 *         description: Portfolio list with access-based details
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 oneOf:
 *                   - $ref: '#/components/schemas/Portfolio'
 *                   - $ref: '#/components/schemas/RestrictedPortfolio'
 *       400:
 *         description: Invalid query parameters
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/portfolios', optionalAuth, userController.getAllPortfolios);

/**
 * @swagger
 * /api/user/portfolios/{id}:
 *   get:
 *     summary: Get portfolio details by ID
 *     description: |
 *       Returns portfolio details with access control:
 *       - Public access shows basic information
 *       - Full details require subscription
 *     tags: [Portfolios]
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
 *         description: Portfolio details
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/Portfolio'
 *                 - $ref: '#/components/schemas/RestrictedPortfolio'
 *       404:
 *         description: Portfolio not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/portfolios/:id', optionalAuth, userController.getPortfolioById);

// ======================
//  Tips Routes
// ======================
/**
 * @swagger
 * /api/user/tips:
 *   get:
 *     summary: Get general investment tips (without portfolio association)
 *     description: |
 *       Returns general tips not associated with any portfolio:
 *       - Unauthenticated users see only titles
 *       - Premium tips require premium subscription
 *       - Basic tips accessible to all authenticated users
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter tips created after this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter tips created before this date
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [basic, premium]
 *         description: Filter by tip category
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, closed, expired]
 *         description: Filter by tip status
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *           enum: [buy, sell, hold]
 *         description: Filter by recommended action
 *       - in: query
 *         name: stockId
 *         schema:
 *           type: string
 *         description: Filter by stock ID
 *     responses:
 *       200:
 *         description: List of general tips with access-based content
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 oneOf:
 *                   - $ref: '#/components/schemas/Tip'
 *                   - $ref: '#/components/schemas/RestrictedTip'
 *       400:
 *         description: Invalid query parameters
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/tips', optionalAuth, userController.getTips);

/**
 * @swagger
 * /api/user/tips-with-portfolio:
 *   get:
 *     summary: Get portfolio-specific investment tips
 *     description: |
 *       Returns tips associated with specific portfolios:
 *       - Unauthenticated users see only titles
 *       - Portfolio-specific tips require portfolio subscription
 *       - Access granted through direct portfolio or bundle subscriptions
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter tips created after this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter tips created before this date
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [basic, premium]
 *         description: Filter by tip category
 *       - in: query
 *         name: portfolioId
 *         schema:
 *           type: string
 *         description: Filter by specific portfolio ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, closed, expired]
 *         description: Filter by tip status
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *           enum: [buy, sell, hold]
 *         description: Filter by recommended action
 *       - in: query
 *         name: stockId
 *         schema:
 *           type: string
 *         description: Filter by stock ID
 *     responses:
 *       200:
 *         description: List of portfolio tips with access-based content
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 oneOf:
 *                   - $ref: '#/components/schemas/TipWithPortfolio'
 *                   - $ref: '#/components/schemas/RestrictedTipWithPortfolio'
 *       400:
 *         description: Invalid query parameters
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/tips-with-portfolio', optionalAuth, userController.getTipsWithPortfolio);

/**
 * @swagger
 * /api/user/tips/{id}:
 *   get:
 *     summary: Get tip details by ID
 *     description: |
 *       Returns tip details with access control for both general and portfolio tips:
 *       - Portfolio tips require portfolio subscription
 *       - Premium tips require premium subscription
 *       - Basic tips accessible to all authenticated users
 *     tags: [Tips]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Tip ID
 *     responses:
 *       200:
 *         description: Tip details
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/Tip'
 *                 - $ref: '#/components/schemas/TipWithPortfolio'
 *                 - $ref: '#/components/schemas/RestrictedTip'
 *                 - $ref: '#/components/schemas/RestrictedTipWithPortfolio'
 *       404:
 *         description: Tip not found
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/tips/:id', optionalAuth, userController.getTipById);

// ======================
//  Subscription Routes
// ======================
/**
 * @swagger
 * /api/user/subscriptions:
 *   get:
 *     summary: Get user's active subscriptions
 *     description: Returns list of current subscriptions
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of subscriptions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Subscription'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
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
 *     description: Returns payment records with sensitive data removed
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payment history
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
 *                     $ref: '#/components/schemas/Portfolio'
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
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
 *     description: Returns current cart contents
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Shopping cart
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Cart'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Cart not found
 */
router.get('/cart', requireAuth, userController.getCart);

/**
 * @swagger
 * /api/user/cart:
 *   post:
 *     summary: Add portfolio to cart
 *     description: Add a portfolio to user's shopping cart
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
 *                 description: Portfolio ID to add
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 default: 1
 *                 description: Number of subscriptions
 *     responses:
 *       200:
 *         description: Updated cart
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Cart'
 *       400:
 *         description: Invalid portfolio ID
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Portfolio not found
 */
router.post('/cart', requireAuth, userController.addToCart);

/**
 * @swagger
 * /api/user/cart/{portfolioId}:
 *   delete:
 *     summary: Remove portfolio from cart
 *     description: Remove specific portfolio from shopping cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: portfolioId
 *         required: true
 *         schema:
 *           type: string
 *         description: Portfolio ID to remove
 *     responses:
 *       200:
 *         description: Updated cart
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Cart'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Cart or item not found
 */
router.delete('/cart/:portfolioId', requireAuth, userController.removeFromCart);

/**
 * @swagger
 * /api/user/cart:
 *   delete:
 *     summary: Clear shopping cart
 *     description: Remove all items from user's cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cart cleared
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Cart'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Cart not found
 */
router.delete('/cart', requireAuth, userController.clearCart);

// ======================
//  Contact Routes
// ======================
/**
 * @swagger
 * /api/contactus:
 *   post:
 *     summary: Send a contact us message
 *     description: Allows users to send a contact us message with their name, email, and message content.
 *     tags:
 *       - Contact
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - message
 *             properties:
 *               name:
 *                 type: string
 *                 description: Full name of the user sending the message
 *                 example: "John Doe"
 *                 minLength: 2
 *                 maxLength: 100
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Valid email address of the user
 *                 example: "john.doe@example.com"
 *               message:
 *                 type: string
 *                 description: The contact message content
 *                 example: "I would like to know more about your investment portfolios."
 *                 minLength: 10
 *                 maxLength: 1000
 *     responses:
 *       200:
 *         description: Contact message sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Contact us message sent successfully"
 *       400:
 *         description: Bad request - Missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "All fields are required"
 *       422:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid email format"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Failed to send contact us message"
 */

module.exports = router;
