//config/config.js
module.exports = {
  server: {
    port: process.env.PORT || 3000
  },
  database: {
    mongodb: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/authdb'
    }
  },
  jwt: {
    accessTokenSecret: process.env.ACCESS_TOKEN_SECRET || 'accesssecret',
    refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || 'refreshsecret'
  },
  email: {
    service: process.env.EMAIL_SERVICE || 'smtp',
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
};