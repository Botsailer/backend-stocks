// utils/db.js
const mongoose   = require('mongoose');
const User       = require('../models/user');
const admin      = require('../models/admin')
const BannedUser = require('../models/BannedUsers');
const config     = require('../config/config');

 const subscription = require('../models/subscription');

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

async function disconnect() {
  await mongoose.disconnect();
  console.log('Disconnected from database');
  child.unref(); 
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

const cleanupDuplicateSubscriptions = async () => {
  try {
    console.log('Starting duplicate cleanup...');
    
    // Find all duplicate groups
    const duplicates = await subscription.aggregate([
      {
        $group: {
          _id: {
            user: "$user",
            productType: "$productType", 
            productId: "$productId"
          },
          docs: { $push: "$_id" },
          count: { $sum: 1 }
        }
      },
      {
        $match: { count: { $gt: 1 } }
      }
    ]);

    console.log(`Found ${duplicates.length} duplicate groups`);

    // Remove duplicates, keeping the most recent active one
    for (const duplicate of duplicates) {
      const subscriptions = await subscription.find({
        _id: { $in: duplicate.docs }
      }).sort({ 
        status: -1,      // Active first
        updatedAt: -1,   // Most recent first
        createdAt: -1    // Newest first
      });
      
      // Keep the first (best) record and remove the rest
      const toKeep = subscriptions[0];
      const toRemove = subscriptions.slice(1).map(sub => sub._id);
      
      await subscription.deleteMany({ _id: { $in: toRemove } });
      
      console.log(`Kept subscription ${toKeep._id}, removed ${toRemove.length} duplicates`);
    }
    
    console.log('Duplicate cleanup completed');
  } catch (error) {
    console.error('Error cleaning up duplicates:', error);
  }
};



module.exports = { connect, disconnect,createAdmin, createUser, findUser, updateUser, findBannedUser, cleanupDuplicateSubscriptions };
