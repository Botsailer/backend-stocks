const User = require('../models/user');
const Portfolio = require('../models/modelPortFolio');
const Subscription = require('../models/subscription');
const Cart = require('../models/carts');
const PaymentHistory = require('../models/paymenthistory');
const Tip = require('../models/portfolioTips');
const Bundle = require('../models/bundle');
const { digioPanVerify } = require('../services/digioPanService');
const DigioSign = require('../models/DigioSign');
const { syncDocument } = require('../services/digioWebhookService');

// Helper function to convert internal status to user-friendly status
const getUserFriendlyStatus = (status) => {
  const statusMap = {
    'signed': 'signed',
    'completed': 'signed',
    'document_created': 'unsigned',
    'sent': 'unsigned',
    'viewed': 'unsigned',
    'pending': 'unsigned',
    'initiated': 'unsigned',
    'expired': 'expired',
    'declined': 'declined',
    'failed': 'failed',
    'template_uploaded': 'template_ready',
    'template_refetched': 'template_ready',
    'template_ready': 'template_ready'
  };

  return statusMap[status] || status;
};



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

    // eSign info (latest signing document) - exclude templates, only get actual signing records
    // Templates have: isTemplate=true, documentId=null, status="template_*"
    // Signing docs have: isTemplate=false, documentId="DIGIO_*", status="document_created|signed|..."
    const latestEsign = await DigioSign.findOne({
      userId: user._id,
      isTemplate: false, // Only get actual signing documents, not templates
      documentId: { $exists: true, $ne: null }, // Must have a documentId (templates don't)
      idType: { $in: ['esign', 'document', 'document_signing', 'pdf_auto_fetched'] }
    }).sort({ createdAt: -1 });

    const requiredFields = ['fullName', 'phone', 'pandetails', 'state', 'dateOfBirth'];
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
      ,
      // Provide the frontend a compact latest eSign/document signing summary
      latestEsign: latestEsign ? {
        _id: latestEsign._id,
        documentId: latestEsign.documentId,
        sessionId: latestEsign.sessionId,
        status: latestEsign.status,
        userFriendlyStatus: getUserFriendlyStatus(latestEsign.status), // Add user-friendly status
        idType: latestEsign.idType,
        signedAt: latestEsign.signedAt,
        signedDocumentUrl: latestEsign.signedDocumentUrl,
        createdAt: latestEsign.createdAt,
        signerName: latestEsign.name,
        signerEmail: latestEsign.email
      } : null

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

    // Handle state field if provided
    if (updates.state) {
      // List of Indian states (should match the enum in the model)
      const indianStates = [
        'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 
        'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 
        'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 
        'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
        'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 
        'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
      ];
      
      if (!indianStates.includes(updates.state)) {
        return res.status(400).json({ error: `Invalid state. Must be one of: ${indianStates.join(', ')}` });
      }
    }
    
    // Handle date of birth
    if (updates.dateOfBirth) {
      try {
        updates.dateOfBirth = new Date(updates.dateOfBirth);
        if (isNaN(updates.dateOfBirth.getTime())) {
          throw new Error('Invalid date format');
        }
      } catch (error) {
        return res.status(400).json({ error: 'Invalid date format for dateOfBirth. Use YYYY-MM-DD format.' });
      }
    }

    // Check if email is being updated
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
    
    // Check if username is being updated
    if (updates.username) {
      const existingUser = await User.findOne({ 
        username: updates.username,
        _id: { $ne: userId }
      });
      if (existingUser) {
        return res.status(400).json({ error: 'Username already taken' });
      }
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
      
      // Get date of birth - required for PAN verification
      // Try to get it from the request in different formats
      const dob = updates.dateOfBirth || updates.panDob || req.body.dateofBirth; // expected DD-MM-YYYY
      const nameForPan = updates.fullName || currentUser.fullName || updates.name;

      if (!nameForPan || !dob) {
        return res.status(400).json({
          error: 'fullName and dateOfBirth are required to verify PAN before saving'
        });
      }

      // If dateOfBirth is provided in a date format, convert to required format for PAN verification
      let formattedDob = dob;
      if (dob instanceof Date) {
        const day = String(dob.getDate()).padStart(2, '0');
        const month = String(dob.getMonth() + 1).padStart(2, '0');
        const year = dob.getFullYear();
        formattedDob = `${day}-${month}-${year}`;
      } else if (typeof dob === 'string' && dob.includes('-')) {
        // Try to parse the date string and convert to DD-MM-YYYY if needed
        try {
          const dateObj = new Date(dob);
          if (!isNaN(dateObj.getTime())) {
            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const year = dateObj.getFullYear();
            formattedDob = `${day}-${month}-${year}`;
            
            // Save the date of birth in the user's profile
            updates.dateOfBirth = dateObj;
          }
        } catch (error) {
          console.error('Error parsing date:', error);
        }
      }

      try {
        const verifyResp = await digioPanVerify({ id_no: pan, name: nameForPan, dob: formattedDob });
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

    const requiredFields = ['fullName', 'phone', 'pandetails', 'state', 'dateOfBirth'];
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
  monthlyContribution: portfolio.monthlyContribution,
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
  monthlyContribution: portfolio.monthlyContribution,
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

// Verify eSign status for the authenticated user.
// Expects an authenticated request.
// Accepts optional identifiers to locate the correct record:
// - token: documentId or sessionId
// - productType & productId: check eSign for a specific product
// This endpoint now performs a just-in-time sync with Digio to avoid stale status.
exports.verifyEsignStatus = async (req, res) => {
  try {
    const userId = req.user && req.user._id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const token = req.query.token || req.body.token || req.params.token;
    const productType = req.query.productType || req.body.productType || req.params.productType || null;
    const productId = req.query.productId || req.body.productId || req.params.productId || null;

    // Query: prefer matching token/session/document if provided, otherwise return latest signing doc
    const query = {
      userId: userId,
      isTemplate: false,
      documentId: { $exists: true, $ne: null }
    };

    if (token) {
      // token might be a sessionId or documentId
      query.$or = [ { sessionId: token }, { documentId: token } ];
    }

    if (productType && productId) {
      query.productType = productType;
      query.productId = productId;
    }

    let esign = await DigioSign.findOne(query).sort({ createdAt: -1 });

    if (!esign) {
      // If specific product requested, try fallback to user's most recent doc
      if (productType && productId) {
        esign = await DigioSign.findOne({ userId, isTemplate: false }).sort({ createdAt: -1 });
      }
      if (!esign) {
        return res.status(404).json({ success: false, message: 'No eSign request found.' });
      }
    }

    const completed = ['signed', 'completed'].includes(esign.status);

    if (completed) {
      return res.json({
        success: true,
        message: 'eSign completed',
        status: esign.status,
        documentId: esign.documentId,
        signedAt: esign.signedAt,
        signedDocumentUrl: esign.signedDocumentUrl,
        authenticationUrl: esign?.digioResponse?.authentication_url || null
      });
    }

    // Perform a just-in-time sync with Digio for freshest status
    try {
      if (esign.documentId) {
        const syncResult = await syncDocument(esign.documentId);
        if (syncResult?.document) {
          esign = syncResult.document; // use updated doc
        }
      }
    } catch (syncErr) {
      // soft-fail: return current status if sync fails
      console.warn('verifyEsignStatus sync failed:', syncErr.message);
    }

    const nowCompleted = ['signed', 'completed'].includes(esign.status);

    if (nowCompleted) {
      return res.json({
        success: true,
        message: 'eSign completed',
        status: esign.status,
        documentId: esign.documentId,
        signedAt: esign.signedAt,
        signedDocumentUrl: esign.signedDocumentUrl,
        authenticationUrl: esign?.digioResponse?.authentication_url || null
      });
    }

    return res.json({
      success: false,
      message: 'eSign not completed',
      status: esign.status,
      userFriendlyStatus: getUserFriendlyStatus(esign.status),
      authenticationUrl: esign?.digioResponse?.authentication_url || null
    });
  } catch (error) {
    console.error('verifyEsignStatus error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
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