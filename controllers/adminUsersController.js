// controllers/adminUserController.js

const User = require('../models/user');
const BannedUser = require('../models/BannedUsers');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

// GET /admin/users
exports.listUsers = async (req, res) => {
  try {
    const users = await User.find()
      .select('-password -refreshToken')
      .sort({ createdAt: -1 });

    const bans = await BannedUser.find()
      .select('userId reason bannedBy bannedAt createdAt')
      .populate('bannedBy', 'username');

    const banMap = {};
    bans.forEach(ban => {
      banMap[ban.userId.toString()] = {
        reason: ban.reason,
        bannedBy: ban.bannedBy,
        bannedAt: ban.bannedAt
      };
    });

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

// POST /admin/users
exports.createUser = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hash = await bcrypt.hash(password, 12);
    const newUser = new User({ username, email, password: hash });
    await newUser.save();
    const output = newUser.toObject();
    delete output.password;
    res.status(201).json(output);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// GET /admin/users/:id
exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password -refreshToken');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /admin/users/:id
exports.updateUser = async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 12);
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).select('-password -refreshToken');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.updateUserPAN = async (req, res) => {
  try {
    const { userId, pandetails, reason } = req.body;
    
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    if (!pandetails || !pandetails.trim()) {
      return res.status(400).json({ error: 'PAN details are required' });
    }
    
    const panCardRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    if (!panCardRegex.test(pandetails.trim())) {
      return res.status(400).json({ 
        error: 'Invalid PAN card format. Must be AAAAA9999A (5 letters, 4 digits, 1 letter)' 
      });
    }
    
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { 
        $set: { 
          pandetails: pandetails.trim().toUpperCase(),
          panUpdatedAt: new Date()
        }
      },
      { new: true, runValidators: true }
    ).select('-password -refreshToken -tokenVersion');
    
    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      message: 'User PAN updated successfully by admin',
      user: updatedUser,
      updatedBy: req.user.username,
      reason: reason || 'Admin update'
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// DELETE /admin/users/:id
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /admin/users/:id/ban
exports.banUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const adminId = req.user && req.user._id; // Assumes middleware attaches authenticated admin to req.user

    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      return res.status(400).json({ error: 'Invalid admin ID for bannedBy' });
    }

    const existingBan = await BannedUser.findOne({ userId });
    if (existingBan) return res.status(400).json({ error: 'User already banned' });

    const ban = new BannedUser({
      userId,
      reason: req.body.reason || 'No reason provided',
      bannedBy: adminId
    });

    await ban.save();
    res.json({ message: 'User banned' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /admin/users/:id/unban
exports.unbanUser = async (req, res) => {
  try {
    const unbanned = await BannedUser.findOneAndDelete({ userId: req.params.id });
    if (!unbanned) return res.status(404).json({ error: 'Ban record not found' });
    res.json({ message: 'User unbanned' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};