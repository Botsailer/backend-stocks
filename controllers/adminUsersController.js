// controllers/adminUserController.js
const User        = require('../models/user');
const BannedUser  = require('../models/BannedUsers');
const bcrypt      = require('bcryptjs');

/**
 * @swagger
 * tags:
 *   name: AdminUsers
 *   description: Admin-only user management
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     NewUser:
 *       type: object
 *       required: [username, email, password]
 *       properties:
 *         username:
 *           type: string
 *           example: "johndoe"
 *         email:
 *           type: string
 *           format: email
 *           example: "john@example.com"
 *         password:
 *           type: string
 *           format: password
 *           example: "Secret123!"
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
 *     BanInfo:
 *       type: object
 *       required: [reason]
 *       properties:
 *         reason:
 *           type: string
 *           example: "Violation of TOS"
 */

/**
 * GET /admin/users
 * @swagger
 * /admin/users:
 *   get:
 *     summary: List all users
 *     tags: [AdminUsers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of user objects
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 */
exports.listUsers = async (req, res) => {
  try {
    // First get all users
    const users = await User.find()
      .select('-password -refreshToken')
      .sort({ createdAt: -1 });
    
    // Then get ban information separately
    const bans = await BannedUser.find()
      .select('userId reason bannedBy bannedAt createdAt')
      .populate('bannedBy', 'username');
    
    // Create a map of user IDs to their ban info
    const banMap = {};
    bans.forEach(ban => {
      banMap[ban.userId.toString()] = {
        reason: ban.reason,
        bannedBy: ban.bannedBy,
    bannedAt:ban.bannedAt

      };
    });
    
    // Add ban info to user objects
    const usersWithBanStatus = users.map(user => {
      const userData = user.toObject();
      userData.banInfo = banMap[user._id.toString()] || null;
      return userData;
    });
    
    res.json(usersWithBanStatus);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
/**
 * POST /admin/users
 * @swagger
 * /admin/users:
 *   post:
 *     summary: Create a new user
 *     tags: [AdminUsers]
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
exports.createUser = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hash = await bcrypt.hash(password, 12);
    const u = new User({ username, email, password: hash });
    await u.save();
    const out = u.toObject();
    delete out.password;
    res.status(201).json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /admin/users/{id}
 * @swagger
 * /admin/users/{id}:
 *   get:
 *     summary: Get user by ID
 *     tags: [AdminUsers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB user ID
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
exports.getUser = async (req, res) => {
  try {
    const u = await User.findById(req.params.id).select('-password -refreshToken');
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json(u);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * PUT /admin/users/{id}
 * @swagger
 * /admin/users/{id}:
 *   put:
 *     summary: Update user by ID
 *     tags: [AdminUsers]
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
 *         description: Updated user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error
 *       404:
 *         description: User not found
 */
exports.updateUser = async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 12);
    }
    const u = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).select('-password -refreshToken');
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json(u);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * DELETE /admin/users/{id}
 * @swagger
 * /admin/users/{id}:
 *   delete:
 *     summary: Delete user by ID
 *     tags: [AdminUsers]
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
 *         description: Deleted confirmation
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
exports.deleteUser = async (req, res) => {
  try {
    const u = await User.findByIdAndDelete(req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /admin/users/{id}/ban
 * @swagger
 * /admin/users/{id}/ban:
 *   post:
 *     summary: Ban a user
 *     tags: [AdminUsers]
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
 *         description: User banned
 *       400:
 *         description: Already banned
 */
exports.banUser = async (req, res) => {
  try {
    const exists = await BannedUser.findOne({ userId: req.params.id });
    if (exists) return res.status(400).json({ error: 'User already banned' });
    const ban = new BannedUser({
      userId: req.params.id,
      reason: req.body.reason || 'No reason provided',
      bannedBy:'admin'
    });
    await ban.save();
    res.json({ message: 'User banned' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /admin/users/{id}/unban
 * @swagger
 * /admin/users/{id}/unban:
 *   post:
 *     summary: Unban a user
 *     tags: [AdminUsers]
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
exports.unbanUser = async (req, res) => {
  try {
    const b = await BannedUser.findOneAndDelete({ userId: req.params.id });
    if (!b) return res.status(404).json({ error: 'Ban record not found' });
    res.json({ message: 'User unbanned' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
