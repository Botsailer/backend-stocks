// controllers/authController.js
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const emailService = require('../services/emailServices');
const db           = require('../utils/db');
const jwtUtil      = require('../utils/jwt');

const {
  accessTokenSecret,  
  refreshTokenSecret
} = require('../config/config').jwt;

exports.signup = async (req, res) => {
  const { username, email, password, phone, state, mainUserId } = req.body;
  
  if (!username || !email || !password || !phone) {
    return res.status(400).json({ error: 'Missing required fields: username, email, password, phone are required.' });
  }

  const exists = await db.findUser({
    $or: [{ username }, { email }],
    provider: 'local'
  });
  if (exists) {
    return res.status(400).json({ error: 'User already exists with this username or email' });
  }

  const hashed = await bcrypt.hash(password, 10);
  const userData = {
    username,
    email,
    password: hashed,
    phone,
    provider: 'local',
    mainUserId: mainUserId || null,
    changedPasswordAt: Date.now()
  };
  
  // Add state if provided
  if (state) {
    userData.state = state;
  }
  
  const user = await db.createUser(userData);

  // Generate email-verification token
  const verifyToken = jwt.sign(
    { uid: user._id },
    accessTokenSecret,
    { expiresIn: '1h' }
  );
  const verifyUrl = `${req.protocol}://${req.get('host')}/auth/verify?token=${verifyToken}`;

  await emailService.sendVerificationEmail(email, verifyUrl);
  res.status(201).json({ message: 'Signup successful—check your email' });
};

exports.login = async (req, res) => {
  const user = req.user; // set by passport
  const banned = await db.findBannedUser({ userId: user._id });
  if (banned) {
      return res.status(403).json({ error: 'User banned' });
  }

  const accessToken  = jwtUtil.signAccessToken(user);
  const refreshToken = jwtUtil.signRefreshToken(user);

  await db.updateUser({ _id: user._id }, { refreshToken }); // Save refreshToken in the database
  res.json({ accessToken, refreshToken });
};

exports.oauthCallback = async (req, res) => {
  const user = req.user;
  const banned = await db.findBannedUser({ userId: user._id });
  if (banned) {
    return res.status(403).json({ error: 'User banned' });
  }
  const accessToken  = jwtUtil.signAccessToken(user);
  const refreshToken = jwtUtil.signRefreshToken(user);
  await db.updateUser({ _id: user._id }, { refreshToken });
  res.json({ accessToken, refreshToken });
};

exports.refresh = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(401).json({ error: 'No token provided' });
  }

  let payload;
  try {
    payload = jwt.verify(refreshToken, refreshTokenSecret);
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired refresh token' });
  }

  const user = await db.findUser({ _id: payload.uid });
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  try {
    await jwtUtil.verifyRefreshToken(refreshToken, user);
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }

  // rotate tokens
  const newAccess  = jwtUtil.signAccessToken(user);
  const newRefresh = jwtUtil.signRefreshToken(user);
  await db.updateUser({ _id: user._id }, { refreshToken: newRefresh });

  res.json({ accessToken: newAccess, refreshToken: newRefresh });
};

exports.logout = async (req, res) => {
  if (req.logout) req.logout();
  await db.updateUser(
      { _id: req.user._id },
      {
          refreshToken: null,
          tokenVersion: req.user.tokenVersion + 1 
      }
  );
  res.clearCookie('refreshToken', { httpOnly: true, secure: true, sameSite: 'strict' });
  res.json({ message: 'Logged out' });
};

exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both current and new passwords are required' });
  }

  const userRecord = await db.findUser({ _id: req.user._id });
  const match = await bcrypt.compare(currentPassword, userRecord.password);
  if (!match) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  await db.updateUser(
    { _id: req.user._id },
    {
      password:           hashed,
      changedPasswordAt: Date.now(),
      tokenVersion:      req.user.tokenVersion + 1,
      refreshToken:      null
    }
  );
  res.json({ message: 'Password changed—please log in again' });
};

exports.changeEmail = async (req, res) => {
  const { newEmail } = req.body;
  if (!newEmail) {
    return res.status(400).json({ error: 'New email is required' });
  }

  await db.updateUser(
    { _id: req.user._id },
    {
      email:             newEmail,
      emailVerified:     false,
      changedPasswordAt: Date.now(),
      tokenVersion:      req.user.tokenVersion + 1,
      refreshToken:      null
    }
  );

  // resend verification
  const verifyToken = jwt.sign(
    { uid: req.user._id },
    accessTokenSecret,
    { expiresIn: '1h' }
  );
  const verifyUrl = `${req.protocol}://${req.get('host')}/auth/verify?token=${verifyToken}`;
  await emailService.sendVerificationEmail(newEmail, verifyUrl);

  res.json({ message: 'Email changed—please verify and log in again' });
};

exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  console.log('Email received in request:', email);
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const user = await db.findUser({
    $or: [{ email }, { username: email }],
    provider: 'local'
  });
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  console.log('User found:', user);

  // Use user.email or fallback to user.username
  const recipientEmail = user.email || user.username;
  console.log('Sending email to:', recipientEmail); // Debug log

  const resetToken = jwt.sign(
    { uid: user._id },
    accessTokenSecret,
    { expiresIn: '1h' }
  );
  const resetUrl = `${req.protocol}://${req.get('host')}/auth/reset-password?token=${resetToken}`;
  await emailService.sendResetPasswordEmail(recipientEmail, resetUrl);

  res.json({ message: 'Reset password email sent' });
};

exports.renderResetPassword = async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).send('Invalid or missing token');
  }

  jwt.verify(token, accessTokenSecret, (err, payload) => {
    if (err) return res.status(400).send('Invalid or expired token');
    // assuming you have an EJS (or similar) view named 'resetPassword'
    res.render('resetPassword', { token });
  });
};

exports.resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password are required' });
  }

  jwt.verify(token, accessTokenSecret, async (err, payload) => {
    if (err) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    await db.updateUser(
      { _id: payload.uid },
      {
        password:           hashed,
        changedPasswordAt: Date.now(),
        tokenVersion:      (await db.findUser({ _id: payload.uid })).tokenVersion + 1,
        refreshToken:      null
      }
    );
    res.json({ message: 'Password has been reset successfully' });
  });
};

exports.verifyEmail = async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).send('Invalid or missing token');
  }

  jwt.verify(token, accessTokenSecret, async (err, payload) => {
    if (err) {
      return res.status(400).send('Invalid or expired token');
    }
    await db.updateUser({ _id: payload.uid }, { emailVerified: true });
    res.send('Email verified successfully');
  });
};
