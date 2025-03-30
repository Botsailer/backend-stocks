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

/**
 * @swagger
 * /auth/signup:
 *   post:
 *     summary: Register a new user.
 *     description: Creates a new user with a hashed password using local authentication.
 *     tags: [Authentication]
 *     requestBody:
 *       description: User signup data.
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               mainUserId:
 *                 type: string
 *     responses:
 *       201:
 *         description: User created successfully.
 *       400:
 *         description: Missing fields or user/email already exists.
 *       500:
 *         description: Error creating user.
 */
router.post('/signup', async (req, res) => {
  await authController.signup(req, res, dbAdapter);
});

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Log in an existing user.
 *     description: Authenticates a user with local credentials and returns JWT tokens.
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       description: Login credentials.
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful, returns access and refresh tokens.
 *       401:
 *         description: Invalid credentials.
 *       403:
 *         description: User is banned.
 */
router.post(
  '/login',
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
 *         description: Redirects to Google OAuth.
 */
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

/**
 * @swagger
 * /auth/google/callback:
 *   get:
 *     summary: Google OAuth callback.
 *     description: Handles the OAuth callback and returns JWT tokens.
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: OAuth login successful, returns tokens.
 *       500:
 *         description: Error during OAuth callback.
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
 *     description: Generates new access and refresh tokens based on a valid refresh token.
 *     tags: [Authentication]
 *     requestBody:
 *       description: Refresh token.
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Returns new JWT tokens.
 *       401:
 *         description: Refresh token required.
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
 *     description: Instructs the client to discard tokens.
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Logged out successfully.
 */
router.post('/logout', authController.logout);

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Request password reset.
 *     description: Generates a reset token and sends a reset email to the user.
 *     tags: [Authentication]
 *     requestBody:
 *       description: User email for password reset.
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Reset password email sent.
 *       400:
 *         description: Email is required.
 *       404:
 *         description: User not found.
 *       500:
 *         description: Error sending reset email.
 */
router.post('/forgot-password', async (req, res) => {
  await authController.forgotPassword(req, res, dbAdapter);
});

/**
 * @swagger
 * /auth/reset-password:
 *   get:
 *     summary: Render reset password page.
 *     description: Renders the password reset form using a provided token.
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         required: true
 *         description: The password reset token.
 *     responses:
 *       200:
 *         description: Renders reset password form.
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
 *     summary: Reset user password.
 *     description: Verifies the reset token and updates the user's password.
 *     tags: [Authentication]
 *     requestBody:
 *       description: Reset token and new password.
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password has been reset successfully.
 *       400:
 *         description: Token and new password are required or token is invalid/expired.
 *       500:
 *         description: Error resetting password.
 */
router.post('/reset-password', async (req, res) => {
  await authController.resetPassword(req, res, dbAdapter);
});

module.exports = (dbAdapter) => router;
