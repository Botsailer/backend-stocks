const express = require('express');
const passport = require('passport');
const authController = require('../controllers/authController');
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Authentication
 *   description: Endpoints for user authentication and account management.
 */
module.exports = (dbAdapter) => {

  /**
   * @swagger
   * /auth/signup:
   *   post:
   *     summary: Register a new user.
   *     description: Creates a new local user with a hashed password. Sends an email verification link upon successful registration.
   *     tags: [Authentication]
   *     requestBody:
   *       required: true
   *       description: User signup data (username, email, password, optional mainUserId).
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - username
   *               - email
   *               - password
   *             properties:
   *               username:
   *                 type: string
   *                 description: The user’s username.
   *               email:
   *                 type: string
   *                 description: The user’s email address.
   *               password:
   *                 type: string
   *                 description: The user’s password.
   *               mainUserId:
   *                 type: string
   *                 description: (Optional) Reference to the main user record.
   *                 example: "mainUserId123"
   *     responses:
   *       201:
   *         description: User created successfully. Verification email sent.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                 uid:
   *                   type: string
   *       400:
   *         description: Missing required fields or username/email already exists.
   *       500:
   *         description: Internal server error while creating the user.
   */
  router.post('/signup', async (req, res) => {
    console.log("dbAdapter in authRoutes", dbAdapter);
    await authController.signup(req, res, dbAdapter);
  });

  /**
   * @swagger
   * /auth/login:
   *   post:
   *     summary: Log in an existing user.
   *     description: Authenticates a user using local credentials (either username or email) and returns JWT tokens.
   *     tags: [Authentication]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       description: Login credentials. The field "username" accepts either a username or an email.
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
   *                 description: The user’s username or email.
   *               password:
   *                 type: string
   *                 description: The user’s password.
   *     responses:
   *       200:
   *         description: Login successful; returns access and refresh tokens.
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
   *         description: Invalid credentials.
   *       403:
   *         description: The user is banned.
   */
  router.post(
    '/login',
    // Middleware: if email is provided but username is not, assign email to username
    (req, res, next) => {
      if (req.body.email && !req.body.username) {
        req.body.username = req.body.email;
      }
      next();
    },
    passport.authenticate('local', { session: false }),
    async (req, res) => {
      await authController.login(req, res, dbAdapter);
    }
  );

  /**
   * @swagger
   * /auth/google:
   *   get:
   *     summary: Initiate Google OAuth login.
   *     description: Redirects the user to Google for authentication.
   *     tags: [Authentication]
   *     responses:
   *       302:
   *         description: Redirects to Google OAuth login.
   */
  router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

  /**
   * @swagger
   * /auth/google/callback:
   *   get:
   *     summary: Google OAuth callback.
   *     description: Handles the callback from Google OAuth and returns JWT tokens.
   *     tags: [Authentication]
   *     responses:
   *       200:
   *         description: OAuth login successful; returns tokens.
   *       500:
   *         description: Error during the OAuth callback process.
   */
  router.get(
    '/google/callback',
    passport.authenticate('google', { session: false }),
    async (req, res) => {
      await authController.oauthCallback(req, res, dbAdapter);
    }
  );

  /**
   * @swagger
   * /auth/refresh:
   *   post:
   *     summary: Refresh JWT tokens.
   *     description: Generates new access and refresh tokens using a valid refresh token.
   *     tags: [Authentication]
   *     requestBody:
   *       required: true
   *       description: Contains the refresh token.
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               refreshToken:
   *                 type: string
   *                 description: A valid refresh token.
   *     responses:
   *       200:
   *         description: New JWT tokens are returned.
   *       401:
   *         description: Refresh token is missing.
   *       403:
   *         description: Invalid refresh token or user not found.
   */
  router.post('/refresh', async (req, res) => {
    await authController.refresh(req, res, dbAdapter);
  });

  /**
   * @swagger
   * /auth/logout:
   *   post:
   *     summary: Log out the user.
   *     description: Instructs the client to clear JWT tokens.
   *     tags: [Authentication]
   *     responses:
   *       200:
   *         description: Logged out successfully.
   */
 router.post('/logout', async (req, res) => {
    await authController.logout(req, res, dbAdapter);
  });

  /**
   * @swagger
   * /auth/forgot-password:
   *   post:
   *     summary: Request a password reset.
   *     description: Generates a reset token and sends an email with a password reset link.
   *     tags: [Authentication]
   *     requestBody:
   *       required: true
   *       description: Email address used for account recovery.
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               email:
   *                 type: string
   *                 description: The user's email address.
   *     responses:
   *       200:
   *         description: Reset password email sent.
   *       400:
   *         description: Email is missing from the request.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Internal error sending reset email.
   */
  router.post('/forgot-password', async (req, res) => {
    await authController.forgotPassword(req, res, dbAdapter);
  });

  /**
   * @swagger
   * /auth/reset-password:
   *   get:
   *     summary: Render the reset password page.
   *     description: Displays the reset password form using a provided token.
   *     tags: [Authentication]
   *     parameters:
   *       - in: query
   *         name: token
   *         required: true
   *         schema:
   *           type: string
   *         description: The reset token.
   *     responses:
   *       200:
   *         description: Reset password form rendered successfully.
   *       400:
   *         description: Invalid or missing token.
   */
  router.get('/reset-password', async (req, res) => {
    await authController.renderResetPassword(req, res, dbAdapter);
  });

  /**
   * @swagger
   * /auth/reset-password:
   *   post:
   *     summary: Reset the user's password.
   *     description: Validates the reset token and updates the user’s password.
   *     tags: [Authentication]
   *     requestBody:
   *       required: true
   *       description: Contains the reset token and the new password.
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               token:
   *                 type: string
   *                 description: The reset token.
   *               newPassword:
   *                 type: string
   *                 description: The new password.
   *     responses:
   *       200:
   *         description: Password reset successfully.
   *       400:
   *         description: Missing token/new password or invalid/expired token.
   *       500:
   *         description: Error while resetting the password.
   */
  router.post('/reset-password', async (req, res) => {
    await authController.resetPassword(req, res, dbAdapter);
  });

  return router;
};
