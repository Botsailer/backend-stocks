// routes/admin.js
const express    = require('express');
const passport   = require('passport');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const jwtUtil    = require('../utils/jwt');
const dbAdapter  = require('../utils/db');
const authCtl    = require('../controllers/authController');
const userCtl    = require('../controllers/adminUsersController');
const Admin      = require('../models/admin');
const { accessTokenSecret, refreshTokenSecret } = require('../config/config').jwt;

const router     = express.Router();

/** Middleware to ensure requester is an admin */
const requireAdmin = async (req, res, next) => {
  const isAdmin = await Admin.findOne({ user: req.user._id });
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
};


//route to delete all the server logs files 
/**
 * @swagger
 * /admin/files/logs:
 *   delete:
 *     tags: [AdminUsers]
 *     summary: Delete all server logs files
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logs deleted successfully
 *       500:
 *         description: Error deleting logs
 */



router.delete(
  '/files/logs',
  passport.authenticate('jwt', { session: false }),
  requireAdmin,
  async (req, res) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const logsDir = path.join(__dirname, '../logs');

      // Check if logs directory exists
      if (fs.existsSync(logsDir)) {
        fs.rmSync(logsDir, { recursive: true, force: true });
        res.json({ message: 'Logs deleted successfully' });
      } else {
        res.status(404).json({ error: 'Logs directory not found' });
      }
    } catch (err) {
      res.status(500).json({ error: 'Error deleting logs: ' + err.message });
    }
  }
);


// --- Swagger Security Scheme (declare once globally) ---
/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         username:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         provider:
 *           type: string
 *         emailVerified:
 *           type: boolean
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 * 
 *     NewUser:
 *       type: object
 *       required: [username, email, password]
 *       properties:
 *         username:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *           format: password
 *
 *     UpdateUser:
 *       type: object
 *       properties:
 *         username:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *           format: password
 *
 *     BanInfo:
 *       type: object
 *       required: [reason]
 *       properties:
 *         reason:
 *           type: string
 */

// --- Administration tag ---
/**
 * @swagger
 * tags:
 *   - name: Administration
 *     description: Admin auth (login/logout/refresh/change-password)
 *   - name: AdminUsers
 *     description: Admin-only user management
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
 *               password:
 *                 type: string
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
    if (req.body.email && !req.body.username) {
      req.body.username = req.body.email;
    }
    next();
  },
  passport.authenticate('local', { session: false }),
  async (req, res) => {
    const user = req.user;
    const isAdmin = await Admin.findOne({ user: user._id });
    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden: not an admin' });
    }
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
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token required' });
  }
  let payload;
  try {
    payload = jwt.verify(refreshToken, refreshTokenSecret);
  } catch (err) {
    return res.status(403).json({ error: 'Invalid refresh token' });
  }
  const user = await dbAdapter.findUser({ _id: payload.uid });
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  try {
    await jwtUtil.verifyRefreshToken(refreshToken, user);
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }
  const isAdmin = await Admin.findOne({ user: user._id });
  if (!isAdmin) {
    return res.status(403).json({ error: 'Not an admin' });
  }
  const newAccess  = jwtUtil.signAccessToken(user);
  const newRefresh = jwtUtil.signRefreshToken(user);
  await dbAdapter.updateUser({ _id: user._id }, { refreshToken: newRefresh });
  res.json({ accessToken: newAccess, refreshToken: newRefresh });
});

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
  authCtl.changePassword
);

// --- AdminUser CRUD & Ban/Unban ---

/**
 * @swagger
 * /admin/users:
 *   get:
 *     tags: [AdminUsers]
 *     summary: List all users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of users
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 */
router.get(
  '/users',
  passport.authenticate('jwt', { session: false }),
  requireAdmin,
  userCtl.listUsers
);

/**
 * @swagger
 * /admin/users:
 *   post:
 *     tags: [AdminUsers]
 *     summary: Create a new user
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NewUser'
 *     responses:
 *       201:
 *         description: Created user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error
 */
router.post(
  '/users',
  passport.authenticate('jwt', { session: false }),
  requireAdmin,
  userCtl.createUser
);


// exports.updateUserPAN = async (req, res) => {
//   try {
//     const { userId, pandetails, reason } = req.body;
    
//     if (!req.user.isAdmin) {
//       return res.status(403).json({ error: 'Admin access required' });
//     }
    
//     if (!pandetails || !pandetails.trim()) {
//       return res.status(400).json({ error: 'PAN details are required' });
//     }
    
//     const panCardRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
//     if (!panCardRegex.test(pandetails.trim())) {
//       return res.status(400).json({ 
//         error: 'Invalid PAN card format. Must be AAAAA9999A (5 letters, 4 digits, 1 letter)' 
//       });
//     }
    
//     const updatedUser = await User.findByIdAndUpdate(
//       userId,
//       { 
//         $set: { 
//           pandetails: pandetails.trim().toUpperCase(),
//           panUpdatedAt: new Date()
//         }
//       },
//       { new: true, runValidators: true }
//     ).select('-password -refreshToken -tokenVersion');
    
//     if (!updatedUser) {
//       return res.status(404).json({ error: 'User not found' });
//     }
    
//     res.json({
//       message: 'User PAN updated successfully by admin',
//       user: updatedUser,
//       updatedBy: req.user.username,
//       reason: reason || 'Admin update'
//     });
    
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };

//updateUserPAN endpoint

/** * @swagger
 * /admin/users/{id}/pan:
 *   put:
 *     tags: [AdminUsers]
 *     summary: Update a user's PAN details
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
 *             type: object
 *             required: [pandetails]
 *             properties:
 *               pandetails:
 *                 type: string
 *                 description: New PAN card number in format AAAAA9999A
 *               reason:
 *                 type: string
 *                 description: Reason for PAN update
 *     responses:
 *       200:
 *         description: User PAN updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "User PAN updated successfully by admin"
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 updatedBy:
 *                   type: string
 *                   example: "admin_username"
 *                 reason:
 *                   type: string
 *                   example: "Admin update"
 *       400:
 *         description: Validation error or missing fields
 *       403:
 *         description: Admin access required
 *       404:
 *         description: User not found
 */
router.put(
  '/users/:id/pan',
  passport.authenticate('jwt', { session: false }),
  requireAdmin,
  userCtl.updateUserPAN
);

/**
 * @swagger
 * /admin/users/{id}:
 *   get:
 *     tags: [AdminUsers]
 *     summary: Fetch a user by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB User ID
 *     responses:
 *       200:
 *         description: User object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       404:
 *         description: User not found
 */
router.get(
  '/users/:id',
  passport.authenticate('jwt', { session: false }),
  requireAdmin,
  userCtl.getUser
);

/**
 * @swagger
 * /admin/users/{id}:
 *   put:
 *     tags: [AdminUsers]
 *     summary: Update a user by ID
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
 *             $ref: '#/components/schemas/UpdateUser'
 *     responses:
 *       200:
 *         description: Updated user object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error
 *       404:
 *         description: User not found
 */
router.put(
  '/users/:id',
  passport.authenticate('jwt', { session: false }),
  requireAdmin,
  userCtl.updateUser
);

/**
 * @swagger
 * /admin/users/{id}:
 *   delete:
 *     tags: [AdminUsers]
 *     summary: Delete a user by ID
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
 *         description: Deletion confirmation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "User deleted"
 *       404:
 *         description: User not found
 */
router.delete(
  '/users/:id',
  passport.authenticate('jwt', { session: false }),
  requireAdmin,
  userCtl.deleteUser
);

/**
 * @swagger
 * /admin/users/{id}/ban:
 *   post:
 *     tags: [AdminUsers]
 *     summary: Ban a user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BanInfo'
 *     responses:
 *       200:
 *         description: User banned
 *       400:
 *         description: Already banned
 */
router.post(
  '/users/:id/ban',
  passport.authenticate('jwt', { session: false }),
  requireAdmin,
  userCtl.banUser
);

/**
 * @swagger
 * /admin/users/{id}/unban:
 *   post:
 *     tags: [AdminUsers]
 *     summary: Unban a user
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
 *         description: User unbanned
 *       404:
 *         description: Ban record not found
 */
router.post(
  '/users/:id/unban',
  passport.authenticate('jwt', { session: false }),
  requireAdmin,
  userCtl.unbanUser
);


//logs files delete  the whole folder ./logs on server
/**
 * @swagger
 * /admin/users/logs:
 *   delete:
 *     tags: [AdminUsers]
 *     summary: Delete all user logs
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logs deleted successfully
 *       500:
 *         description: Error deleting logs
 */




module.exports = router;
