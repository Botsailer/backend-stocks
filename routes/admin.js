// routes/admin.js
const express    = require('express');
const passport   = require('passport');
const bcrypt     = require('bcryptjs');
const mongoose   = require('mongoose');
const jwtUtil    = require('../utils/jwt');
const dbAdapter  = require('../utils/db');
const router     = express.Router();

// --- Admin Schema (isolated collection) ---
const AdminSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  promotedAt: { type: Date, default: Date.now }
});
const Admin = mongoose.model('Admin', AdminSchema);

// --- Swagger Security Scheme ---
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
 *   name: Administration
 *   description: Endpoints for admin users only.
 */

/**
 * @swagger
 * /admin/login:
 *   post:
 *     tags:
 *       - Administration
 *     summary: Admin login (username/email + password)
 *     description: Authenticate a user, ensure they are in the Admin collection, and issue JWT tokens.
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
 *           example:
 *             username: "admin@example.com"
 *             password: "Str0ngP@ss!"
 *     responses:
 *       200:
 *         description: Login successful; returns access & refresh tokens
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
  '/admin/login',
  (req, res, next) => {
    if (req.body.email && !req.body.username) req.body.username = req.body.email;
    next();
  },
  passport.authenticate('local', { session: false }),
  async (req, res) => {
    const user = req.user;
    // verify in Admin collection
    const isAdmin = await Admin.findOne({ user: user._id });
    if (!isAdmin) return res.status(403).json({ error: 'Forbidden: not an admin' });
    // issue tokens
    const accessToken  = jwtUtil.signAccessToken(user);
    const refreshToken = jwtUtil.signRefreshToken(user);
    // persist refresh token on User
    await dbAdapter.updateUser({ _id: user._id }, { refreshToken });
    res.json({ accessToken, refreshToken });
  }
);

/**
 * @swagger
 * /admin/logout:
 *   post:
 *     tags:
 *       - Administration
 *     summary: Admin logout
 *     description: Revoke refresh token and invalidate current JWT. Requires a valid access token.
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
 *                   example: "Admin logged out"
 *       401:
 *         description: Missing or invalid access token
 */
router.post(
  '/admin/logout',
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    // revoke on user doc
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
 *     tags:
 *       - Administration
 *     summary: Refresh admin JWT tokens
 *     description: Rotate refresh token; identical flow to /auth/refresh but scoped to admins.
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
 *         description: New tokens issued
 *       401:
 *         description: Missing refresh token
 *       403:
 *         description: Invalid or non-admin refresh token
 */
router.post('/admin/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ error: 'No token provided' });
  let payload;
  try {
    payload = jwtUtil.verifyRefreshTokenRaw(refreshToken);
  } catch {
    return res.status(403).json({ error: 'Invalid token' });
  }
  // confirm user & admin status
  const user = await dbAdapter.findUser({ _id: payload.uid });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!await Admin.findOne({ user: user._id })) {
    return res.status(403).json({ error: 'Not an admin' });
  }
  // rotate tokens
  const newAccess  = jwtUtil.signAccessToken(user);
  const newRefresh = jwtUtil.signRefreshToken(user);
  await dbAdapter.updateUser({ _id: user._id }, { refreshToken: newRefresh });
  res.json({ accessToken: newAccess, refreshToken: newRefresh });
});



async function requireAdmin(req, res, next) {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  
    const isAdmin = await Admin.findOne({ user: userId });
    if (!isAdmin) return res.status(403).json({ error: 'Forbidden: not an admin' });
  
    next();
  }
  
  /**
   * @swagger
   * /admin/change-password:
   *   post:
   *     tags:
   *       - Administration
   *     summary: Admin changes their own password
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - currentPassword
   *               - newPassword
   *             properties:
   *               currentPassword:
   *                 type: string
   *                 format: password
   *               newPassword:
   *                 type: string
   *                 format: password
   *     responses:
   *       200:
   *         description: Password updated
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Not an admin
   */
  router.post(
    '/admin/change-password',
    passport.authenticate('jwt', { session: false }),
    requireAdmin,
    userController.changePassword
  );


module.exports = router;
