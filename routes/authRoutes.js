const express = require('express');
const passport = require('passport');
const authController = require('../controllers/authController');
const router = express.Router();

/**
 * @swagger
 * /auth/signup:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Create a new user and send verification email
 *     description: |
 *       Registers a new local user. Hashes the password, sets initial metadata,
 *       and sends an email verification link.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - email
 *               - password
 *               - phone
 *             properties:
 *               username:
 *                 type: string
 *                 description: Unique username for login
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User's email address, used for login and verification
 *               password:
 *                 type: string
 *                 format: password
 *                 description: Plain-text password (min length enforced in controller)
 *               phone:
 *                 type: string
 *                 description: User's phone number (required)
 *                 example: "+91-9876543210"
 *               mainUserId:
 *                 type: string
 *                 description: Optional reference to an existing main user record
 *             example:
 *               username: "johndoe"
 *               email: "john@example.com"
 *               password: "P@ssw0rd!"
 *               phone: "+91-9876543210"
 *               mainUserId: "abc123"
 *     responses:
 *       201:
 *         description: User created, verification email sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Signup successful—check your email"
 *       400:
 *         description: Validation error or user already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/signup', async (req, res) => {
  await authController.signup(req, res);
});

/**
 * @swagger
 * /auth/login:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Authenticate user and issue JWT tokens
 *     description: |
 *       Logs in a user via local strategy (username or email + password).
 *       Returns access and refresh tokens on success.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 description: Username or email of the user
 *               password:
 *                 type: string
 *                 format: password
 *                 description: User's password
 *             example:
 *               username: "john@example.com"
 *               password: "P@ssw0rd!"
 *     responses:
 *       200:
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                   description: JWT access token
 *                 refreshToken:
 *                   type: string
 *                   description: JWT refresh token
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: User is banned or blocked
 */
router.post(
  '/login',
  (req, res, next) => {
    if (req.body.email && !req.body.username) {
      req.body.username = req.body.email;
    }
    next();
  },
  passport.authenticate('local', { session: false }),
  authController.login
);

/**
 * @swagger
 * /auth/google:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Redirect to Google for OAuth authentication
 *     description: Initiates Google OAuth2 flow requesting profile and email scopes.
 *     responses:
 *       302:
 *         description: Redirects to Google OAuth consent screen
 */
router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

/**
 * @swagger
 * /auth/google/callback:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Google OAuth2 callback
 *     description: Handles Google's callback, logs in or creates user, returns JWT tokens.
 *     responses:
 *       200:
 *         description: OAuth login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *       403:
 *         description: User is banned
 *       500:
 *         description: Internal server error during OAuth callback
 */
router.get(
  '/google/callback',
  passport.authenticate('google', { session: false }),
  authController.oauthCallback
);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Refresh JWT tokens
 *     description: |
 *       Accepts a valid refresh token in the request body and returns new
 *       access and refresh tokens (rotation). Invalidates old refresh token.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: The user's current refresh token
 *             example:
 *               refreshToken: "eyJhbGciOiJIUzI1NiIs..."
 *     responses:
 *       200:
 *         description: Tokens refreshed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *       401:
 *         description: Missing refresh token
 *       403:
 *         description: Invalid or revoked refresh token
 */
router.post('/refresh', authController.refresh);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Log out the user
 *     description: |
 *       Revokes the user's refresh token and invalidates all active sessions.
 *       Requires a valid access token in the Authorization header.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Logged out successfully"
 *       401:
 *         description: Missing or invalid access token
 */
router.post(
  '/logout',
  passport.authenticate('jwt', { session: false }),
  authController.logout
);

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Send password reset email
 *     description: |
 *       Generates a one-time reset token and emails a link to the user to reset
 *       their password.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: The email address associated with the user account
 *             example:
 *               email: "john@example.com"
 *     responses:
 *       200:
 *         description: Reset email sent
 *       400:
 *         description: Email missing from request
 *       404:
 *         description: No user found with that email
 */
router.post('/forgot-password', authController.forgotPassword);

/**
 * @swagger
 * /auth/reset-password:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Render reset-password form
 *     description: Displays the password reset form when provided a valid token.
 *     parameters:
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         required: true
 *         description: One-time reset token sent in email
 *     responses:
 *       200:
 *         description: Reset form rendered
 *       400:
 *         description: Missing or invalid token
 */
router.get('/reset-password', authController.renderResetPassword);

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Process password reset
 *     description: Validates reset token and updates user's password.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - newPassword
 *             properties:
 *               token:
 *                 type: string
 *                 description: One-time reset token
 *               newPassword:
 *                 type: string
 *                 format: password
 *                 description: New password to set
 *             example:
 *               token: "eyJhbGciOi..."
 *               newPassword: "N3wP@ssw0rd!"
 *     responses:
 *       200:
 *         description: Password successfully reset
 *       400:
 *         description: Missing fields or invalid/expired token
 */
router.post('/reset-password', authController.resetPassword);

/**
 * @swagger
 * /auth/verify:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Verify user email
 *     description: Confirms a user's email address using a verification token.
 *     parameters:
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         required: true
 *         description: Email verification JWT token
 *     responses:
 *       200:
 *         description: Email verified successfully
 *       400:
 *         description: Missing or invalid token
 */
router.get('/verify', authController.verifyEmail);

/**
 * @swagger
 * /auth/change-email:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Change user's email address
 *     description: |
 *       Updates the user's email, resets verification status,
 *       and forces logout. Requires valid access token.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newEmail
 *             properties:
 *               newEmail:
 *                 type: string
 *                 format: email
 *                 description: The new email address to set
 *             example:
 *               newEmail: "new@example.com"
 *     responses:
 *       200:
 *         description: Email changed; verification email sent
 *       400:
 *         description: Missing newEmail field
 *       401:
 *         description: Missing or invalid access token
 */
router.post(
  '/change-email',
  passport.authenticate('jwt', { session: false }),
  authController.changeEmail
);

module.exports = router;



