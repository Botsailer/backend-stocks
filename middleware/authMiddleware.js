const jwt = require('jsonwebtoken');
const User = require('../models/user');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization') || req.header('authorization');
    
    if (!authHeader) {
      return res.status(401).json({ 
        success: false, 
        error: 'Access denied. No token provided.' 
      });
    }

    // Extract token from "Bearer <token>" format
    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.slice(7) 
      : authHeader;

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: 'Access denied. Invalid token format.' 
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    // Find user
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid token. User not found.' 
      });
    }

    // Add user to request object
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid token.' 
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        error: 'Token expired.' 
      });
    }
    
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error during authentication.' 
    });
  }
};

module.exports = authMiddleware;