// utils/jwt.js
const jwt = require('jsonwebtoken');
const ACCESS_SECRET  = process.env.ACCESS_TOKEN_SECRET;
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET;

// Payload includes tokenVersion so we can reject old tokens
function signAccessToken(user) {
  const payload = {
    uid:          user._id,
    username:     user.username,
    provider:     user.provider,
    tokenVersion: user.tokenVersion
  };
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: '15m' });
}

function signRefreshToken(user) {
  const payload = {
    uid:          user._id,
    tokenVersion: user.tokenVersion
  };
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: '7d' });
}

// Middleware to verify and ensure tokens aren’t stale
async function verifyAccessToken(token, user) {
  const payload = jwt.verify(token, ACCESS_SECRET);
  // If password/email was changed after token was issued, reject
  const issued = payload.iat * 1000;
  if (user.changedPasswordAt.getTime() > issued) {
    throw new Error('Credentials changed—please log in again');
  }
  // If tokenVersion mismatches, reject
  if (payload.tokenVersion !== user.tokenVersion) {
    throw new Error('Token revoked—please log in again');
  }
  return payload;
}

async function verifyRefreshToken(token, user) {
    const payload = jwt.verify(token, REFRESH_SECRET);
    console.log('Payload tokenVersion:', payload.tokenVersion);
    console.log('User tokenVersion:', user?.tokenVersion);
    console.log('User refreshToken:', user?.refreshToken);

    if (payload.tokenVersion !== user?.tokenVersion) {
        throw new Error('Refresh token revoked');
    }
    if (user.refreshToken !== token) {
        throw new Error('Invalid refresh token');
    }
    return payload;
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken
};
