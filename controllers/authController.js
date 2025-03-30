// controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const emailService = require('../services/emailServices'); // Your email service implementation

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'accesssecret';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'refreshsecret';

function generateTokens(user) {
  const payload = { uid: user._id, username: user.username, provider: user.provider };
  const accessToken = jwt.sign(payload, ACCESS_TOKEN_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign(payload, REFRESH_TOKEN_SECRET, { expiresIn: '7d' });
  return { accessToken, refreshToken };
}

exports.signup = async (req, res, dbAdapter) => {
  const { username, password, mainUserId } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username or email and password are required' });
  
  // check if user already exists
  const existingUser = await dbAdapter.findUser({ username, provider: 'local' });
  if (existingUser)
    return res.status(400).json({ error: 'User already exists' });

  // check if email already exists
  const existingEmailUser = await dbAdapter.findUser({ email: username, provider: 'local' });
  if (existingEmailUser)
    return res.status(400).json({ error: 'Email already exists' });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = {
      username,
      password: hashedPassword,
      provider: 'local',
      mainUserId: mainUserId || null
    };
    const uid = await dbAdapter.createUser(user);
    res.status(201).json({ message: 'User created successfully', uid });
  } catch (err) {
    res.status(500).json({ error: 'Error creating user', details: err.message });
  }
};

exports.login = async (req, res, dbAdapter) => {
  // Check banned user
  const bannedEntry = await dbAdapter.findBannedUser({ userId: req.user._id });
  if (bannedEntry) return res.status(403).json({ error: 'User is banned' });
  if (!req.user) return res.status(401).json({ error: 'Invalid credentials' });
  
  // Generate tokens internally
  const tokens = generateTokens(req.user);
  res.json(tokens);
};
exports.oauthCallback = async (req, res) => {
  const bannedEntry = await dbAdapter.findBannedUser({ userId: req.user._id });
  if (bannedEntry) return res.status(403).json({ error: 'User is banned' });
  const tokens = generateTokens(req.user);
  res.json(tokens);
};


exports.refresh = async (req, res, dbAdapter) => {
  const { refreshToken } = req.body;
  if (!refreshToken)
    return res.status(401).json({ error: 'Refresh token required' });
  
  jwt.verify(refreshToken, REFRESH_TOKEN_SECRET, async (err, payload) => {
    if (err)
      return res.status(403).json({ error: 'Invalid refresh token' });
    const user = await dbAdapter.findUser({ _id: payload.uid });
    if (!user)
      return res.status(403).json({ error: 'User not found' });
    const tokens = generateTokens(user);
    res.json(tokens);
  });
};

exports.logout = (req, res) => {
  res.json({ message: 'Logged out successfully' });
};

// Forgot Password: generate a reset token and send an email with the reset URL
exports.forgotPassword = async (req, res, dbAdapter) => {
  const { email } = req.body;
  if (!email)
    return res.status(400).json({ error: 'Email is required' });
  
  // Find user by email
  const user = await dbAdapter.findUser({ username:email , provider: 'local' });
  if (!user)
    return res.status(404).json({ error: 'User not found' });

  // Create a reset token (using the ACCESS_TOKEN_SECRET here; you might opt for a separate secret)
  const resetToken = jwt.sign({ uid: user._id }, ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
  
  // Construct a reset URL with the token as a query parameter
  const resetUrl = `${req.protocol}://${req.get('host')}/auth/reset-password?token=${resetToken}`;

  try {
    // Implement email sending using your preferred email service (e.g., Nodemailer)
    await emailService.sendResetPasswordEmail(user.username, resetUrl);
    res.json({ message: 'Reset password email sent' });
  } catch (err) {
    res.status(500).json({ error: 'Error sending reset email', details: err.message });
  }
};

// Render the reset password page on GET (this uses your server-side view engine)
exports.renderResetPassword = async (req, res, dbAdapter) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Invalid or missing token');

  jwt.verify(token, ACCESS_TOKEN_SECRET, (err, payload) => {
    if (err) return res.status(400).send('Invalid or expired token');
    res.render('forgetPassword', { token });
  });
};

// Reset Password: verify token and update password
exports.resetPassword = async (req, res, dbAdapter) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword)
    return res.status(400).json({ error: 'Token and new password are required' });

  jwt.verify(token, ACCESS_TOKEN_SECRET, async (err, payload) => {
    if (err)
      return res.status(400).json({ error: 'Invalid or expired token' });
    try {
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await dbAdapter.updateUser({ _id: payload.uid }, { password: hashedPassword });
      res.json({ message: 'Password has been reset successfully' });
    } catch (err) {
      res.status(500).json({ error: 'Error resetting password', details: err.message });
    }
  });
};
