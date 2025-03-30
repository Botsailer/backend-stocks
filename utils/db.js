// utils/db.js
const mongoose = require('mongoose');
const User = require('../models/user');
const config = require('../config/config');
const BannedUsers = require('../models/BannedUsers');

async function connect() {
  await mongoose.connect(config.database.mongodb.uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  console.log('Connected to database');
}

async function createUser(userData) {
  console.log('in DbAdapter Creating user with data:', userData);
  const user = new User(userData);
  const savedUser = await user.save();
  return savedUser._id;
}

async function findUser(query) {
  return User.findOne(query);
}

async function findBannedUser(query) {
  return BannedUsers.findOne(query);
}

async function updateUser(query, updateData) {
  return User.findOneAndUpdate(query, updateData, { new: true });
}


module.exports = { connect, createUser, findBannedUser ,findUser, updateUser };
