// controllers/adminUserController.js
const User        = require('../models/user');
const BannedUser  = require('../models/BannedUsers');
const bcrypt      = require('bcryptjs');



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


exports.getUser = async (req, res) => {
  try {
    const u = await User.findById(req.params.id).select('-password -refreshToken');
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json(u);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


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


exports.deleteUser = async (req, res) => {
  try {
    const u = await User.findByIdAndDelete(req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


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

exports.unbanUser = async (req, res) => {
  try {
    const b = await BannedUser.findOneAndDelete({ userId: req.params.id });
    if (!b) return res.status(404).json({ error: 'Ban record not found' });
    res.json({ message: 'User unbanned' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
