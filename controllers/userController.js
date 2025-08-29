const User = require('../models/user');
const Portfolio = require('../models/modelPortFolio');
const Subscription = require('../models/subscription');
const Cart = require('../models/carts');
const PaymentHistory = require('../models/paymenthistory');
const Tip = require('../models/portfolioTips');
const Bundle = require('../models/bundle');
const { digioPanVerify } = require('../services/digioPanService');


// Function is now defined at the top of the file
const updateUserPremiumStatus = async (userId) => {
  try {
    const now = new Date();
    
    // Check for any active premium subscription (case-insensitive)
    const hasPremiumSubscription = await Subscription.exists({
      user: userId,
      status: "active",
      category: { $regex: /^premium$/i },
      expiresAt: { $gt: now }
    });
    
    // Update user's premium status
    const updateResult = await User.findByIdAndUpdate(
      userId, 
      { hasPremium: !!hasPremiumSubscription },
      { new: true }
    );
    
    console.log(`Updated user ${userId} hasPremium to: ${!!hasPremiumSubscription}`);
    return !!hasPremiumSubscription;
  } catch (error) {
    console.error('Error updating premium status:', error);
    return false;
  }
};

// Helper: Get user's accessible portfolios and premium status
const getUserAccessInfo = async (userId) => {
  try {
    const now = new Date();
    console.log(`[ACCESS] Getting access info for user: ${userId}`);
    
    const allSubscriptions = await Subscription.find({
      user: userId,
      status: 'active',
      expiresAt: { $gt: now }
    })
    .populate('productId')
    .populate('portfolio');

    console.log(`[ACCESS] Found ${allSubscriptions.length} active subscriptions`);

    const accessiblePortfolioIds = new Set();
    let hasPremiumAccess = false;

    allSubscriptions.forEach((sub) => {
      // Check for premium access
      if (sub.category?.toLowerCase() === 'premium') {
        hasPremiumAccess = true;
      }

      // Portfolio subscriptions
      if (sub.productType === 'Portfolio') {
        // Priority 1: Portfolio field
        if (sub.portfolio?._id) {
          accessiblePortfolioIds.add(sub.portfolio._id.toString());
        } 
        // Priority 2: ProductId field (portfolio document)
        else if (sub.productId?._id) {
          accessiblePortfolioIds.add(sub.productId._id.toString());
        }
      }
      
      // Bundle subscriptions
      if (sub.productType === 'Bundle' && sub.productId?.portfolios) {
        sub.productId.portfolios.forEach(portfolio => {
          if (portfolio?._id) {
            accessiblePortfolioIds.add(portfolio._id.toString());
          }
        });
      }
    });

    return {
      hasPremiumAccess,
      accessiblePortfolioIds: Array.from(accessiblePortfolioIds)
    };
    
  } catch (error) {
    console.error('[ACCESS] Error in getUserAccessInfo:', error);
    return {
      hasPremiumAccess: false,
      accessiblePortfolioIds: []
    };
  }
};

// User Profile Endpoints
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password -refreshToken -tokenVersion');
    
    if (!user) return res.status(404).json({ error: 'User not found' });

    const requiredFields = ['fullName', 'phone', 'pandetails'];
    const isComplete = requiredFields.every(field => user[field] && user[field] !== null);
    
    const hasActiveSubscription = await Subscription.exists({
      user: user._id,
      isActive: true
    });
    
    const forceComplete = (hasActiveSubscription && !isComplete);
    
    res.json({
      ...user.toObject(),
      profileComplete: isComplete,
      forceComplete: forceComplete,
      missingFields: !isComplete ? requiredFields.filter(field => !user[field] || user[field] === null) : [],
      panUpdateInfo: {
        canUpdatePAN: !user.panUpdatedByUser || user.isAdmin,
        lastUpdated: user.panUpdatedAt,
        updatedByUser: user.panUpdatedByUser
      },
      panVerification: {
        verified: !!user.panVerified,
        status: user.panVerificationStatus || 'unverified',
        verifiedName: user.panVerifiedName || null,
        verifiedDob: user.panVerifiedDob || null,
        lastVerifiedAt: user.panLastVerifiedAt || null
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const updates = req.body;
    const isAdmin = req.user.isAdmin || false;
    
    const restrictedFields = ['password', 'refreshToken', 'tokenVersion', 'provider', 
                             'providerId', 'emailVerified', 'changedPasswordAt', 
                             'panUpdatedByUser', 'panUpdatedAt'];
    restrictedFields.forEach(field => delete updates[field]);

    if (updates.username) {
      const existingUser = await User.findOne({ 
        username: updates.username,
        _id: { $ne: userId }
      });
      if (existingUser) {
        return res.status(400).json({ error: 'Username already taken' });
      }
    }

    if (updates.email) {
      const existingUser = await User.findOne({ 
        email: updates.email,
        _id: { $ne: userId }
      });
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }
      updates.emailVerified = false;
    }

    if (updates.pandetails && updates.pandetails.trim() !== '') {
      const panCardRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
      if (!panCardRegex.test(updates.pandetails.trim().toUpperCase())) {
        return res.status(400).json({ 
          error: 'Invalid PAN card format. Must be AAAAA9999A' 
        });
      }
      
      const currentUser = await User.findById(userId);
      
      if (currentUser.panUpdatedByUser && !isAdmin) {
        return res.status(403).json({ 
          error: 'PAN card can only be updated once' 
        });
      }
      
      const pan = updates.pandetails.trim().toUpperCase();
      const dob = updates.panDob || req.body.panDob; // expected DD/MM/YYYY
      const nameForPan = updates.fullName || currentUser.fullName || updates.name;

      if (!nameForPan || !dob) {
        return res.status(400).json({
          error: 'fullName and panDob (DD/MM/YYYY) are required to verify PAN before saving'
        });
      }

      try {
        const verifyResp = await digioPanVerify({ id_no: pan, name: nameForPan, dob });
        updates.pandetails = pan;
        updates.panVerified = true;
        updates.panVerificationStatus = 'verified';
        updates.panVerifiedName = nameForPan;
        updates.panVerifiedDob = dob;
        updates.panLastVerifiedAt = new Date();
        updates.panVerificationData = verifyResp || {};
      } catch (e) {
        const rawMessage = (e && (e.data?.message || e.message || '')).toString().toLowerCase();
        const looksLikeNameMismatch =
          ['name mismatch', 'name does not match', 'name not matching', 'mismatch in name']
            .some(s => rawMessage.includes(s)) || (e.code === 'NAME_MISMATCH');
        const humanMsg = looksLikeNameMismatch
          ? 'PAN and DOB look correct, but the name did not match. Please enter your full legal name exactly as on PAN, including middle name if any (e.g., "Anup Anand Mishra" not just "Anup Mishra").'
          : 'PAN verification failed';
        return res.status(400).json({
          error: humanMsg,
          code: e.code || (looksLikeNameMismatch ? 'NAME_MISMATCH' : 'PAN_VERIFY_FAILED'),
          details: e.data || e.message
        });
      }
      
      if (!currentUser.panUpdatedByUser && !isAdmin) {
        updates.panUpdatedByUser = true;
        updates.panUpdatedAt = new Date();
      }
      delete updates.panDob; // do not persist raw request-only field
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password -refreshToken -tokenVersion');

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const requiredFields = ['fullName', 'phone'];
    const isComplete = requiredFields.every(field => updatedUser[field] && updatedUser[field] !== null);

    res.json({
      ...updatedUser.toObject(),
      profileComplete: isComplete,
      missingFields: !isComplete ? requiredFields.filter(field => !updatedUser[field] || updatedUser[field] === null) : [],
      message: 'Profile updated successfully'
    });

  } catch (err) {
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ error: errors.join(', ') });
    }
    res.status(500).json({ error: err.message });
  }
};

// Portfolio Endpoints
exports.getAllPortfolios = async (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;
    const user = req.user;
    
    const query = {};
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
    }
    
    if (category) {
      if (!['basic', 'premium'].includes(category.toLowerCase())) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      query.PortfolioCategory = { $regex: new RegExp(`^${category}$`, 'i') };
    }

    const portfolios = await Portfolio.find(query).sort('name');
    
    // For unauthenticated users
    if (!user) {
      const limitedPortfolios = portfolios.map(p => ({
        _id: p._id,
        name: p.name,
        description: p.description,
        subscriptionFee: p.subscriptionFee,
        minInvestment: p.minInvestment,
        durationMonths: p.durationMonths,
        PortfolioCategory: p.PortfolioCategory,
        monthlyContribution: p.monthlyContribution,
        createdAt: p.createdAt,
        message: "Login to view details"
      }));
      return res.json(limitedPortfolios);
    }
    
    // For admins - full access
    if (user.isAdmin) {
      console.log('[PORTFOLIO] Admin access granted');
      return res.json(portfolios);
    }
    
    // Get access information with logging
    console.log(`[PORTFOLIO] Getting access info for user: ${user._id}`);
    const { accessiblePortfolioIds } = await getUserAccessInfo(user._id);
    console.log(`[PORTFOLIO] User accessible portfolio IDs:`, accessiblePortfolioIds);
    
    const processedPortfolios = portfolios.map(p => {
      const portfolioIdString = p._id.toString();
      const isAccessible = accessiblePortfolioIds.includes(portfolioIdString);
      
      console.log(`[PORTFOLIO] Checking portfolio ${portfolioIdString} (${p.name}): accessible=${isAccessible}`);
      
      if (isAccessible) {
        return p;
      }
      
      return {
        _id: p._id,
        name: p.name,
        description: p.description,
        subscriptionFee: p.subscriptionFee,
        minInvestment: p.minInvestment,
        durationMonths: p.durationMonths,
        monthlyContribution: p.monthlyContribution,
        PortfolioCategory: p.PortfolioCategory,
        createdAt: p.createdAt,
        message: "Subscribe to view complete details"
      };
    });
    
    res.json(processedPortfolios);
  } catch (err) {
    console.error('getAllPortfolios error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getPortfolioById = async (req, res) => {
  try {
    const portfolio = await Portfolio.findById(req.params.id);
    if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });
    
    const user = req.user;
    
    // For unauthenticated users
    if (!user) {
      return res.json({
        _id: portfolio._id,
        name: portfolio.name,
        description: portfolio.description,
        subscriptionFee: portfolio.subscriptionFee,
        minInvestment: portfolio.minInvestment,
        durationMonths: portfolio.durationMonths,
         monthlyContribution: p.monthlyContribution,
        PortfolioCategory: portfolio.PortfolioCategory,
        createdAt: portfolio.createdAt,
        message: "Login to view details"
      });
    }
    
    // For admins - full access
    if (user.isAdmin) return res.json(portfolio);
    
    // Get access information
    const { accessiblePortfolioIds } = await getUserAccessInfo(user._id);
    const isAccessible = accessiblePortfolioIds.includes(portfolio._id.toString());
    
    if (isAccessible) return res.json(portfolio);
    
    return res.json({
      _id: portfolio._id,
      name: portfolio.name,
      description: portfolio.description,
      subscriptionFee: portfolio.subscriptionFee,
      minInvestment: portfolio.minInvestment,
       monthlyContribution: p.monthlyContribution,
      durationMonths: portfolio.durationMonths,
      PortfolioCategory: portfolio.PortfolioCategory,
      createdAt: portfolio.createdAt,
      message: "Subscribe to view complete details"
    });
  } catch (err) {
    console.error('getPortfolioById error:', err);
    res.status(500).json({ error: err.message });
  }
};


exports.getUserSubscriptions = async (req, res) => {
  try {
    const subscriptions = await Subscription.find({ 
      user: req.user._id,
      status: "active",
      expiresAt: { $gt: new Date() }
    })
      .populate('productId')
      .populate('portfolio')
      .sort({ createdAt: -1 });

    // Update user premium status
    await updateUserPremiumStatus(req.user._id);

    // Group eMandate subscriptions and collect access data
    const groupedSubscriptions = {};
    const individualSubscriptions = [];
    let portfolioAccess = [];
    let hasBasic = false;
    let hasPremiumFromSubs = false;

    subscriptions.forEach(sub => {
      // Add to portfolio access list
      if (sub.productType === 'Portfolio' && sub.portfolio) {
        portfolioAccess.push(sub.portfolio._id.toString());
      }
      
      // Check subscription categories (case-insensitive)
      const category = sub.category?.toLowerCase();
      if (category === 'basic') hasBasic = true;
      if (category === 'premium') hasPremiumFromSubs = true;

      // Group recurring subscriptions
      if (sub.razorpaySubscriptionId && sub.type === 'recurring') {
        if (!groupedSubscriptions[sub.razorpaySubscriptionId]) {
          groupedSubscriptions[sub.razorpaySubscriptionId] = {
            razorpaySubscriptionId: sub.razorpaySubscriptionId,
            type: sub.type,
            status: sub.status,
            expiresAt: sub.expiresAt,
            totalAmount: 0,
            portfolios: [],
            bundleId: sub.bundleId,
            category: sub.category
          };
        }
        groupedSubscriptions[sub.razorpaySubscriptionId].totalAmount += sub.amount || 0;
        groupedSubscriptions[sub.razorpaySubscriptionId].portfolios.push(sub);
      } else {
        individualSubscriptions.push(sub);
      }
    });

    // Premium users automatically get basic access
    const finalHasPremium = hasPremiumFromSubs;
    const finalHasBasic = hasBasic || finalHasPremium;

    // Determine subscription type
    let subscriptionType = "none";
    if (finalHasPremium) {
      subscriptionType = "premium";
    } else if (finalHasBasic) {
      subscriptionType = "basic";
    }

    res.json({
      success: true,
      bundleSubscriptions: Object.values(groupedSubscriptions),
      individualSubscriptions,
      totalSubscriptions: subscriptions.length,
      accessData: {
        hasPremium: finalHasPremium,
        hasBasic: finalHasBasic,
        portfolioAccess: [...new Set(portfolioAccess)], 
        subscriptionType
      }
    });
  } catch (error) {
    console.error("Fetch subscriptions error", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch subscriptions" 
    });
  }
};


// Tips Endpoints
exports.getTips = async (req, res) => {
  try {
    const { startDate, endDate, category, status, action, stockId } = req.query;
    const user = req.user;
    const query = { portfolio: { $exists: false } };
    
    // Date filtering
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
    }

    // Category filtering
    if (category) {
      if (!['basic', 'premium'].includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      query.category = category;
    }
    
    // Additional filters
    if (status) query.status = status;
    if (action) query.action = action;
    if (stockId) query.stockId = stockId;

    const tips = await Tip.find(query).sort('-createdAt');
    
    // For unauthenticated users
    if (!user) {
      return res.json(tips.map(tip => ({
        _id: tip._id,
        title: tip.title,
        stockId: tip.stockId,
        category: tip.category,
        createdAt: tip.createdAt,
        status: tip.status,
           analysistConfidence: tip?.analysistConfidence,
        action: tip.action,
        message: "Login to view details"
      }))); 
    }
    
    // For admins - full access
    if (user.isAdmin) return res.json(tips);

    // Get access information using the fixed function
    const { hasPremiumAccess } = await getUserAccessInfo(user._id);

    const processedTips = tips.map(tip => {
      // Always show basic tips
      if (tip.category === 'basic') return tip;
      
      // Show premium tips if user has premium access
      if (tip.category === 'premium' && hasPremiumAccess) return tip;
      
      // Restricted premium tip
      return {
        _id: tip._id,
        title: tip.title,
        stockId: tip.stockId,
        category: 'premium',
        createdAt: tip.createdAt,
        status: tip.status,
        analysistConfidence: tip?.analysistConfidence,
        action: tip.action,
        message: "Upgrade to premium to view this content"
      };
    });

    res.json(processedTips);
  } catch (err) {
    console.error('getTips error:', err);
    res.status(500).json({ error: err.message });
  }
};


exports.getTipsWithPortfolio = async (req, res) => {
  try {
    const { startDate, endDate, category, portfolioId, status, action, stockId } = req.query;
    const user = req.user;
    const query = { portfolio: { $ne: null } };
    
    // Date filtering
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
    }

    // Category filtering
    if (category) {
      if (!['basic', 'premium'].includes(category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      query.category = category;
    }
    
    // Portfolio filtering
    if (portfolioId) query.portfolio = portfolioId;
    
    // Additional filters
    if (status) query.status = status;
    if (action) query.action = action;
    if (stockId) query.stockId = stockId;

    const tips = await Tip.find(query)
      .populate('portfolio', 'name')
      .sort('-createdAt');
    
    // For unauthenticated users
    if (!user) {
      return res.json(tips.map(tip => ({
        _id: tip._id,
        title: tip.title,
        stockId: tip.stockId,
        category: tip.category,
        portfolio: tip.portfolio ? { 
          _id: tip.portfolio._id, 
          name: tip.portfolio.name 
        } : null,
        createdAt: tip.createdAt,
        status: tip.status,
           analysistConfidence: tip?.analysistConfidence,
        action: tip.action,
        message: "Login to view details"
      }))); 
    }
    
    // For admins - full access
    if (user.isAdmin) return res.json(tips);
    
    // Get access information
    const { accessiblePortfolioIds } = await getUserAccessInfo(user._id);

    const processedTips = tips.map(tip => {
      // Portfolio tip access
      const isAccessible = tip.portfolio && 
        accessiblePortfolioIds.includes(tip.portfolio._id.toString());
      
      if (isAccessible) return tip;
      
      return {
        _id: tip._id,
        title: tip.title,
        stockId: tip.stockId,
        category: tip.category,
        portfolio: tip.portfolio ? { 
          _id: tip.portfolio._id, 
          name: tip.portfolio.name 
        } : null,
        createdAt: tip.createdAt,
           analysistConfidence: tip?.analysistConfidence,
        status: tip.status,
        action: tip.action,
        message: "Subscribe to this portfolio to view details"
      };
    });

    res.json(processedTips);
  } catch (err) {
    console.error('getTipsWithPortfolio error:', err);
    res.status(500).json({ error: err.message });
  }
};


exports.getTipById = async (req, res) => {
  try {
    const tip = await Tip.findById(req.params.id)
      .populate('portfolio', 'name');
    
    if (!tip) return res.status(404).json({ error: 'Tip not found' });
    
    const user = req.user;
    
    // For unauthenticated users
    if (!user) {
      return res.json({
        _id: tip._id,
        title: tip.title,
        stockId: tip.stockId,
        category: tip.category,
        portfolio: tip.portfolio ? { 
          _id: tip.portfolio._id, 
          name: tip.portfolio.name 
        } : null,
        createdAt: tip.createdAt,
        status: tip.status,
        action: tip.action,
           analysistConfidence: tip?.analysistConfidence,
        message: "Login to view details"
      });
    }
    
    // Admin access
    if (user.isAdmin) return res.json(tip);
    
    // Get access information
    const { hasPremiumAccess, accessiblePortfolioIds } = await getUserAccessInfo(user._id);
    
    // Portfolio tip access
    if (tip.portfolio) {
      const isAccessible = accessiblePortfolioIds.includes(tip.portfolio._id.toString());
      
      if (isAccessible) return res.json(tip);
      
      return res.json({
        _id: tip._id,
        title: tip.title,
        stockId: tip.stockId,
        category: tip.category,
        portfolio: tip.portfolio ? { 
          _id: tip.portfolio._id, 
          name: tip.portfolio.name 
        } : null,
        createdAt: tip.createdAt,
        status: tip.status,
           analysistConfidence: tip?.analysistConfidence,
        action: tip.action,
        message: "Subscribe to this portfolio to view details"
      });
    }
    
    // General tip access - Premium tips
    if (tip.category === 'premium' && !hasPremiumAccess) {
      return res.json({
        _id: tip._id,
        title: tip.title,
        stockId: tip.stockId,
        category: 'premium',
        createdAt: tip.createdAt,
        status: tip.status,
        action: tip.action,
        message: "Upgrade to premium to view this content"
      });
    }
    
    // Basic tip or premium with access
    return res.json(tip);
  } catch (err) {
    console.error('getTipById error:', err);
    res.status(500).json({ error: err.message });
  }
};


// Payment and Cart Endpoints
exports.getUserPaymentHistory = async (req, res) => {
  try {
    const payments = await PaymentHistory.find({ user: req.user._id })
      .populate('portfolio', 'name')
      .select('-signature')
      .sort('-createdAt');
    
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getCart = async (req, res) => {
  try {
    let cart = await Cart.findOne({ user: req.user._id })
      .populate('items.portfolio', 'name subscriptionFee minInvestment');
    
    if (!cart) {
      cart = new Cart({ user: req.user._id, items: [] });
      await cart.save();
    }
    
    res.json(cart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.addToCart = async (req, res) => {
  try {
    const { portfolioId } = req.body;
    const portfolio = await Portfolio.findById(portfolioId);
    if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });

    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) cart = new Cart({ user: req.user._id, items: [] });

    const existingIndex = cart.items.findIndex(
      item => item.portfolio.toString() === portfolioId
    );

    if (existingIndex > -1) {
      cart.items[existingIndex].quantity += 1;
    } else {
      cart.items.push({ portfolio: portfolioId, quantity: 1 });
    }

    await cart.save();
    res.json(await Cart.findById(cart._id).populate('items.portfolio'));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.removeFromCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return res.status(404).json({ error: 'Cart not found' });

    cart.items = cart.items.filter(
      item => item.portfolio.toString() !== req.params.portfolioId
    );

    await cart.save();
    res.json(await Cart.findById(cart._id).populate('items.portfolio'));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.clearCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return res.status(404).json({ error: 'Cart not found' });

    cart.items = [];
    await cart.save();
    res.json(cart);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};