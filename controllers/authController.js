const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const emailService = require('../services/emailServices'); // Your email service implementation

// Secrets for JWT tokens (can be stored in environment variables)
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'accesssecret';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'refreshsecret';

/**
 * Generates access and refresh tokens for the given user.
 * @param {Object} user - The user object.
 * @returns {Object} An object containing accessToken and refreshToken.
 */
function generateTokens(user) {
  const payload = { uid: user._id, username: user.username, provider: user.provider };
  const accessToken = jwt.sign(payload, ACCESS_TOKEN_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign(payload, REFRESH_TOKEN_SECRET, { expiresIn: '7d' });
  return { accessToken, refreshToken };
}

/**
 * Signup Controller
 * Registers a new user and sends an email verification link.
 * 
 * Error Codes:
 * - 400: Missing fields or user/email already exists.
 * - 500: Internal error during user creation.
 */
exports.signup = async (req, res, dbAdapter) => {
  const { username, email, password, mainUserId } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'Username, email, and password are required' });

  // Check if the user with the same username or email already exists
  const existingUser = await dbAdapter.findUser({
    $or: [
      { username: username },
      { email: email }
    ],
    provider: 'local'
  });

  if (existingUser) {
    return res.status(400).json({ error: 'Username or email already exists' });
  }

  try {
    // Hash the password before saving
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = {
      username,
      email,
      password: hashedPassword,
      provider: 'local',
      mainUserId: mainUserId || null
    };
    const uid = await dbAdapter.createUser(user);

    // Generate a verification token (expires in 1 hour)
    const verificationToken = jwt.sign({ uid }, ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
    const verificationUrl = `${req.protocol}://${req.get('host')}/auth/verify?token=${verificationToken}`;

    // Send verification email
    await emailService.sendVerificationEmail(email, verificationUrl);

    res.status(201).json({ message: 'User created successfully', uid });
  } catch (err) {
    res.status(500).json({ error: 'Error creating user', details: err.message });
  }
};

/**
 * Login Controller
 * Validates the user (already authenticated by Passport) and returns JWT tokens.
 * 
 * Error Codes:
 * - 401: Invalid credentials.
 * - 403: User is banned.
 */
exports.login = async (req, res, dbAdapter) => {
  // Check if the user is banned
  const bannedEntry = await dbAdapter.findBannedUser({ userId: req.user._id });
  if (bannedEntry) return res.status(403).json({ error: 'User is banned' });
  if (!req.user) return res.status(401).json({ error: 'Invalid credentials' });
  
  const tokens = generateTokens(req.user);
  res.json(tokens);
};

/**
 * OAuth Callback Controller
 * Handles Google OAuth callback and issues JWT tokens.
 * 
 * Error Codes:
 * - 403: User is banned.
 */
exports.oauthCallback = async (req, res) => {
  const bannedEntry = await dbAdapter.findBannedUser({ userId: req.user._id });
  if (bannedEntry) return res.status(403).json({ error: 'User is banned' });
  const tokens = generateTokens(req.user);
  res.json(tokens);
};

/**
 * Token Refresh Controller
 * Validates the provided refresh token and returns new JWT tokens.
 * 
 * Error Codes:
 * - 401: Refresh token missing.
 * - 403: Invalid refresh token or user not found.
 */
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

/**
 * Logout Controller
 * Instructs the client to clear tokens (client-side logout).
 */
exports.logout = async (req, res, dbAdapter) => {
  try {
    // 1. Clear the stored refresh token for local and OAuth users
    const logoutResult = await dbAdapter.updateUser({ _id: req.user._id }, { refreshToken: null });
    if (!logoutResult) {
      return res.status(500).json({ error: 'Error logging out: could not update user token' });
    }

    // 2. If you're using session-based authentication, destroy the session
    if (req.session) {
      req.session.destroy((err) => {
        if (err) {
          console.error('Error destroying session:', err);
        }
      });
    }

    // 3. For OAuth users, revoke the access token with the provider
    if (req.user.provider !== 'local' && req.user.accessToken) {
      // Example for Google OAuth:
      const revokeUrl = `https://accounts.google.com/o/oauth2/revoke?token=${req.user.accessToken}`;
      const response = await fetch(revokeUrl);
      if (!response.ok) {
        console.warn('Failed to revoke Google access token');
      }
    }

    // 4. (Optional) Implement a token blacklist for access tokens if needed.
    // This is an advanced feature that requires storing invalidated tokens until they expire.
    // For now, we rely on short token lifetimes and refresh token invalidation.

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed', details: err.message });
  }
};

/**
 * Forgot Password Controller
 * Generates a reset token and sends an email with the reset URL.
 * 
 * Error Codes:
 * - 400: Email missing.
 * - 404: User not found.
 * - 500: Internal error sending email.
 */
exports.forgotPassword = async (req, res, dbAdapter) => {
  const { email } = req.body;
  if (!email)
    return res.status(400).json({ error: 'Email is required' });

  // Attempt to find the user using email or username field
  const user = await dbAdapter.findUser({
    $or: [
      { username: email },
      { email: email }
    ],
    provider: 'local'
  });

  if (!user)
    return res.status(404).json({ error: 'User not found' });

  // Create a reset token (expires in 1 hour)
  const resetToken = jwt.sign({ uid: user._id }, ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
  const resetUrl = `${req.protocol}://${req.get('host')}/auth/reset-password?token=${resetToken}`;

  try {
    await emailService.sendResetPasswordEmail(user.email, resetUrl);
    res.json({ message: 'Reset password email sent' });
  } catch (err) {
    res.status(500).json({ error: 'Error sending reset email', details: err.message });
  }
};

/**
 * Render Reset Password Controller
 * Renders the password reset form using a valid reset token.
 * 
 * Error Codes:
 * - 400: Missing or invalid token.
 */
exports.renderResetPassword = async (req, res, dbAdapter) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Invalid or missing token');

  jwt.verify(token, ACCESS_TOKEN_SECRET, (err, payload) => {
    if (err) return res.status(400).send('Invalid or expired token');
    // Render the password reset page (using a server-side view engine)
    res.render('forgetPassword', { token });
  });
};

/**
 * Reset Password Controller
 * Validates the reset token and updates the user's password.
 * 
 * Error Codes:
 * - 400: Missing token or new password; invalid/expired token.
 * - 500: Error during password update.
 */
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

/**
 * Verify Email Controller
 * Validates the email verification token and marks the user's email as verified.
 * 
 * Error Codes:
 * - 400: Missing or invalid token.
 * - 500: Error during email verification.
 */
exports.verifyEmail = async (req, res, dbAdapter) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Invalid or missing token');

  jwt.verify(token, ACCESS_TOKEN_SECRET, async (err, payload) => {
    if (err) return res.status(400).send('Invalid or expired token');
    try {
      await dbAdapter.updateUser({ _id: payload.uid }, { emailVerified: true });
      res.send('Email verified successfully');
    } catch (err) {
      res.status(500).send('Error verifying email');
    }
  });
};
