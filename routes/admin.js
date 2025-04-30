// routes/admin.js
const express    = require('express');
const passport   = require('passport');
const bcrypt     = require('bcryptjs');
const mongoose   = require('mongoose');
const jwtUtil    = require('../utils/jwt');
const dbAdapter  = require('../utils/db');
const userController = require('../controllers/authController');
const router     = express.Router();

// Admin model imported from models/admin.js instead of re-defining here:
const Admin      = require('../models/admin');

// Middleware to ensure requester is an admin
const requireAdmin = async (req, res, next) => {
  // At this point req.user is set by passport-jwt
  const isAdmin = await Admin.findOne({ user: req.user._id });
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
};

// --- Swagger Security Scheme (only declare once globally) ---
// @swagger
// components:
//   securitySchemes:
//     bearerAuth:
//       type: http
//       scheme: bearer
//       bearerFormat: JWT

/**
 * @swagger
 * tags:
 *   - name: Administration
 *     description: Admin-only endpoints (requires Bearer JWT & existence in Admin collection)
 */

/**
 * @swagger
 * /admin/login:
 *   post:
 *     tags: [Administration]
 *     summary: Admin login
 *     description: Authenticate with username/email + password, then verify Admin record.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *                 description: Username or email
 *               password:
 *                 type: string
 *             example:
 *               username: "admin@example.com"
 *               password: "Secret123!"
 *     responses:
 *       200:
 *         description: Issued access and refresh tokens
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
 *         description: Invalid credentials
 *       403:
 *         description: Authenticated but not an admin
 */
router.post(
  '/login',
  (req, res, next) => {
    // allow login by email if sent
    if (req.body.email && !req.body.username) {
      req.body.username = req.body.email;
    }
    next();
  },
  passport.authenticate('local', { session: false }),
  async (req, res) => {
    const user = req.user;
    // check admin record
    const isAdmin = await Admin.findOne({ user: user._id });
    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden: not an admin' });
    }
    // issue tokens
    const accessToken  = jwtUtil.signAccessToken(user);
    const refreshToken = jwtUtil.signRefreshToken(user);
    await dbAdapter.updateUser({ _id: user._id }, { refreshToken });
    res.json({ accessToken, refreshToken });
  }
);

/**
 * @swagger
 * /admin/logout:
 *   post:
 *     tags: [Administration]
 *     summary: Admin logout
 *     description: Revoke refresh token and bump tokenVersion.  
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Admin logged out
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Admin logged out"
 *       401:
 *         description: Missing or invalid JWT
 *       403:
 *         description: Not an admin
 */
router.post(
  '/logout',
  passport.authenticate('jwt', { session: false }),
  requireAdmin,
  async (req, res) => {
    await dbAdapter.updateUser(
      { _id: req.user._id },
      { refreshToken: null, tokenVersion: req.user.tokenVersion + 1 }
    );
    res.clearCookie('refreshToken');
    res.json({ message: 'Admin logged out' });
  }
);

/**
 * @swagger
 * /admin/refresh:
 *   post:
 *     tags: [Administration]
 *     summary: Rotate admin JWT tokens
 *     description: Refresh both tokens if valid and still an admin.
 *     requestBody:
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
 *         description: New access & refresh tokens
 *       401:
 *         description: Missing refresh token
 *       403:
 *         description: Invalid token or no longer an admin
 */
router.post(
  '/refresh',
  async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }
    let payload;
    try {
      // assumes you expose a raw verify helper
      payload = jwtUtil.verifyRefreshToken(refreshToken);
    } catch (err) {
      return res.status(403).json({ error: 'Invalid refresh token' });
    }
    const user = await dbAdapter.findUser({ _id: payload.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    // ensure still admin
    const isAdmin = await Admin.findOne({ user: user._id });
    if (!isAdmin) {
      return res.status(403).json({ error: 'Not an admin' });
    }
    // rotate tokens
    const newAccess  = jwtUtil.signAccessToken(user);
    const newRefresh = jwtUtil.signRefreshToken(user);
    await dbAdapter.updateUser({ _id: user._id }, { refreshToken: newRefresh });
    res.json({ accessToken: newAccess, refreshToken: newRefresh });
  }
);

/**
 * @swagger
 * /admin/change-password:
 *   post:
 *     tags: [Administration]
 *     summary: Admin changes own password
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 format: password
 *               newPassword:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Password updated; admin must re-login
 *       400:
 *         description: Missing fields or bad current password
 *       401:
 *         description: Missing/invalid JWT
 *       403:
 *         description: Not an admin
 */
router.post(
  '/change-password',
  passport.authenticate('jwt', { session: false }),
  requireAdmin,
  userController.changePassword
);

module.exports = router;
