// services/adminService.js

const mongoose = require('mongoose');
const User      = require('../models/user');
const Admin     = require('../models/admin');  // your Admin model with { user: ObjectId }
 
/**
 * Promote an existing user to admin.
 * @param {string} userId  - MongoDB ObjectId string of the user to promote
 * @returns {Promise<mongoose.Document>}  - The created Admin document
 * @throws {Error} if the user does not exist, or is already an admin
 */
async function makeAdmin(userId) {
  // 1. Ensure the user exists
  const user = await User.findById(userId);
  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  // 2. Check not already an admin
  const existing = await Admin.findOne({ user: user._id });
  if (existing) {
    throw new Error(`User ${userId} is already an admin`);
  }

  // 3. Create the Admin record
  // Model.create() is a shorthand for `new Admin(doc).save()` :contentReference[oaicite:1]{index=1}
  const admin = await Admin.create({ user: user._id });

  // 4. Return the new admin document
  return admin;
}

module.exports = { makeAdmin };
