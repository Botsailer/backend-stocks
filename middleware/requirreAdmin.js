// middleware/requireAdmin.js
const jwt = require('jsonwebtoken');
const config = require('../config/config');
const Admin = require('../models/admin');
const User  = require('../models/user');

/**
 * Extracts and verifies JWT, then ensures the user is in the Admin collection.
 */
module.exports = async function requireAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Missing or malformed token' });
    }
    const token = auth.slice(7);
    const payload = jwt.verify(token, config.jwt.accessTokenSecret);
    // find the user
    const user = await User.findById(payload.uid);
    if (!user) return res.status(401).json({ message: 'Invalid token' });
    // check admin
    const isAdmin = await Admin.findOne({ user: user._id });
    if (!isAdmin) return res.status(403).json({ message: 'Admin only' });
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Unauthorized', error: err.message });
  }
};