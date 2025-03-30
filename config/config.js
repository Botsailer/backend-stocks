// config/config.js
module.exports = {
  server: {
    port: process.env.PORT || 3000,
    jwtSecret: process.env.JWT_SECRET || 'defaultsecret'
  },
  database: {
    type: process.env.DB_TYPE || 'mongodb',
    mongodb: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/authdb'
    }
  }
};
