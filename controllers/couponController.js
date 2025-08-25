const Coupon = require('../models/couponScheama');
const Subscription = require('../models/subscription');
const Portfolio = require('../models/modelPortFolio');
const Bundle = require('../models/bundle');
const User = require('../models/user');
const winston = require('winston');

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ 
      filename: 'logs/coupon-service.log', 
      maxsize: 5 * 1024 * 1024, 
      maxFiles: 7 
    })
  ]
});

/**
 * Create a new coupon (Admin only)
 */
exports.createCoupon = async (req, res) => {
  try {
    const {
      code,
      discountType,
      discountValue,
      title,
      description,
      usageLimit,
      validFrom,
      validUntil,
      applicableProducts,
      minOrderValue,
      maxDiscountAmount,
      userRestrictions
    } = req.body;

    // Validate required fields
    if (!code || !discountType || !discountValue || !title || !validUntil) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: code, discountType, discountValue, title, validUntil'
      });
    }

    // Validate discount value based on type
    if (discountType === 'percentage' && (discountValue <= 0 || discountValue > 100)) {
      return res.status(400).json({
        success: false,
        error: 'Percentage discount must be between 0 and 100'
      });
    }

    if (discountType === 'fixed' && discountValue <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Fixed discount must be greater than 0'
      });
    }

    // Validate dates
    const validFromDate = validFrom ? new Date(validFrom) : new Date();
    const validUntilDate = new Date(validUntil);
    
    if (validUntilDate <= validFromDate) {
      return res.status(400).json({
        success: false,
        error: 'Valid until date must be after valid from date'
      });
    }

    // Check if code already exists
    const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
    if (existingCoupon) {
      return res.status(409).json({
        success: false,
        error: 'Coupon code already exists'
      });
    }

    // Validate applicable products if specified
    if (applicableProducts && !applicableProducts.applyToAll) {
      if (applicableProducts.portfolios && applicableProducts.portfolios.length > 0) {
        const portfolioCount = await Portfolio.countDocuments({
          _id: { $in: applicableProducts.portfolios }
        });
        if (portfolioCount !== applicableProducts.portfolios.length) {
          return res.status(400).json({
            success: false,
            error: 'One or more portfolio IDs are invalid'
          });
        }
      }

      if (applicableProducts.bundles && applicableProducts.bundles.length > 0) {
        const bundleCount = await Bundle.countDocuments({
          _id: { $in: applicableProducts.bundles }
        });
        if (bundleCount !== applicableProducts.bundles.length) {
          return res.status(400).json({
            success: false,
            error: 'One or more bundle IDs are invalid'
          });
        }
      }
    }

    // Create new coupon
    const newCoupon = new Coupon({
      code: code.toUpperCase(),
      discountType,
      discountValue,
      title,
      description,
      usageLimit: usageLimit || -1,
      validFrom: validFromDate,
      validUntil: validUntilDate,
      applicableProducts: applicableProducts || { applyToAll: true },
      minOrderValue: minOrderValue || 0,
      maxDiscountAmount,
      userRestrictions: userRestrictions || {},
      createdBy: req.user._id,
      status: 'active'
    });

    const savedCoupon = await newCoupon.save();
    
    logger.info('Coupon created successfully', {
      couponId: savedCoupon._id,
      code: savedCoupon.code,
      createdBy: req.user._id,
      discountType: savedCoupon.discountType,
      discountValue: savedCoupon.discountValue
    });

    res.status(201).json({
      success: true,
      message: 'Coupon created successfully',
      coupon: savedCoupon
    });

  } catch (error) {
    logger.error('Error creating coupon', {
      error: error.message,
      stack: error.stack,
      userId: req.user._id
    });

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: 'Coupon code already exists'
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create coupon'
    });
  }
};

/**
 * Get all coupons with filtering and pagination
 */
exports.getAllCoupons = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      status, 
      discountType, 
      search 
    } = req.query;

    const query = {};
    
    if (status) {
      query.status = status;
    }
    
    if (discountType) {
      query.discountType = discountType;
    }
    
    if (search) {
      query.$or = [
        { code: { $regex: search, $options: 'i' } },
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const pageNumber = Math.max(1, parseInt(page));
    const pageSize = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNumber - 1) * pageSize;

    const [coupons, totalCoupons] = await Promise.all([
      Coupon.find(query)
        .populate('createdBy', 'fullName email username')
        .populate('applicableProducts.portfolios', 'name portfolioName')
        .populate('applicableProducts.bundles', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize),
      Coupon.countDocuments(query)
    ]);

    res.json({
      success: true,
      coupons,
      pagination: {
        currentPage: pageNumber,
        totalPages: Math.ceil(totalCoupons / pageSize),
        totalCoupons,
        hasNext: skip + pageSize < totalCoupons,
        hasPrev: pageNumber > 1
      }
    });

  } catch (error) {
    logger.error('Error fetching coupons', {
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch coupons'
    });
  }
};

/**
 * Get coupon by ID
 */
exports.getCouponById = async (req, res) => {
  try {
    const { id } = req.params;

    const coupon = await Coupon.findById(id)
      .populate('createdBy', 'fullName email username')
      .populate('applicableProducts.portfolios', 'name portfolioName')
      .populate('applicableProducts.bundles', 'name')
      .populate('usageHistory.user', 'fullName email username');

    if (!coupon) {
      return res.status(404).json({
        success: false,
        error: 'Coupon not found'
      });
    }

    res.json({
      success: true,
      coupon
    });

  } catch (error) {
    logger.error('Error fetching coupon', {
      error: error.message,
      stack: error.stack,
      couponId: req.params.id
    });

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch coupon'
    });
  }
};

/**
 * Update coupon (Admin only)
 */
exports.updateCoupon = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    // Remove fields that shouldn't be updated
    delete updateData._id;
    delete updateData.createdBy;
    delete updateData.usedCount;
    delete updateData.usageHistory;

    // Validate discount value if being updated
    if (updateData.discountType && updateData.discountValue !== undefined) {
      if (updateData.discountType === 'percentage' && 
          (updateData.discountValue <= 0 || updateData.discountValue > 100)) {
        return res.status(400).json({
          success: false,
          error: 'Percentage discount must be between 0 and 100'
        });
      }

      if (updateData.discountType === 'fixed' && updateData.discountValue <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Fixed discount must be greater than 0'
        });
      }
    }

    // Validate dates if being updated
    if (updateData.validFrom || updateData.validUntil) {
      const coupon = await Coupon.findById(id);
      if (!coupon) {
        return res.status(404).json({
          success: false,
          error: 'Coupon not found'
        });
      }

      const validFromDate = updateData.validFrom ? new Date(updateData.validFrom) : coupon.validFrom;
      const validUntilDate = updateData.validUntil ? new Date(updateData.validUntil) : coupon.validUntil;
      
      if (validUntilDate <= validFromDate) {
        return res.status(400).json({
          success: false,
          error: 'Valid until date must be after valid from date'
        });
      }
    }

    // Convert code to uppercase if provided
    if (updateData.code) {
      updateData.code = updateData.code.toUpperCase();
      
      // Check if new code already exists (excluding current coupon)
      const existingCoupon = await Coupon.findOne({ 
        code: updateData.code,
        _id: { $ne: id }
      });
      if (existingCoupon) {
        return res.status(409).json({
          success: false,
          error: 'Coupon code already exists'
        });
      }
    }

    const updatedCoupon = await Coupon.findByIdAndUpdate(
      id,
      { ...updateData, updatedAt: new Date() },
      { new: true, runValidators: true }
    ).populate('createdBy', 'fullName email username')
     .populate('applicableProducts.portfolios', 'name portfolioName')
     .populate('applicableProducts.bundles', 'name');

    if (!updatedCoupon) {
      return res.status(404).json({
        success: false,
        error: 'Coupon not found'
      });
    }

    logger.info('Coupon updated successfully', {
      couponId: updatedCoupon._id,
      code: updatedCoupon.code,
      updatedBy: req.user._id
    });

    res.json({
      success: true,
      message: 'Coupon updated successfully',
      coupon: updatedCoupon
    });

  } catch (error) {
    logger.error('Error updating coupon', {
      error: error.message,
      stack: error.stack,
      couponId: req.params.id,
      userId: req.user._id
    });

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: 'Coupon code already exists'
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update coupon'
    });
  }
};

/**
 * Delete coupon (Admin only)
 */
exports.deleteCoupon = async (req, res) => {
  try {
    const { id } = req.params;

    const coupon = await Coupon.findById(id);
    if (!coupon) {
      return res.status(404).json({
        success: false,
        error: 'Coupon not found'
      });
    }

    // Check if coupon has been used
    if (coupon.usedCount > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete coupon that has been used. Consider deactivating it instead.'
      });
    }

    await Coupon.findByIdAndDelete(id);

    logger.info('Coupon deleted successfully', {
      couponId: id,
      code: coupon.code,
      deletedBy: req.user._id
    });

    res.json({
      success: true,
      message: 'Coupon deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting coupon', {
      error: error.message,
      stack: error.stack,
      couponId: req.params.id,
      userId: req.user._id
    });

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete coupon'
    });
  }
};

/**
 * Validate and apply coupon
 */
exports.validateCoupon = async (req, res) => {
  try {
    const { code, productType, productId, orderValue } = req.body;

    if (!code || !productType || !productId || !orderValue) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: code, productType, productId, orderValue'
      });
    }

    // Find coupon
    const coupon = await Coupon.findOne({ code: code.toUpperCase() });
    
    if (!coupon) {
      return res.status(404).json({
        success: false,
        error: 'Invalid coupon code'
      });
    }

    // Check if coupon is valid
    if (!coupon.isValid) {
      let reason = 'Coupon is not valid';
      if (coupon.status !== 'active') {
        reason = 'Coupon is inactive';
      } else if (coupon.isExpired) {
        reason = 'Coupon has expired';
      } else {
        reason = 'Coupon is not yet active';
      }
      
      return res.status(400).json({
        success: false,
        error: reason
      });
    }

    // Check usage limit
    if (coupon.usageLimit !== -1 && coupon.usedCount >= coupon.usageLimit) {
      return res.status(400).json({
        success: false,
        error: 'Coupon usage limit exceeded'
      });
    }

    // Check if user can use this coupon
    const userCheck = coupon.canUserUseCoupon(req.user._id);
    if (!userCheck.canUse) {
      return res.status(400).json({
        success: false,
        error: userCheck.reason
      });
    }

    // Check if coupon applies to the product
    if (!coupon.appliesTo(productType, productId)) {
      return res.status(400).json({
        success: false,
        error: 'Coupon is not applicable to this product'
      });
    }

    // Check for new users only restriction
    if (coupon.userRestrictions.newUsersOnly) {
      const hasAnySubscription = await Subscription.findOne({ user: req.user._id });
      if (hasAnySubscription) {
        return res.status(400).json({
          success: false,
          error: 'This coupon is only for new users'
        });
      }
    }

    // Calculate discount
    const discountResult = coupon.calculateDiscount(orderValue);
    
    if (discountResult.reason) {
      return res.status(400).json({
        success: false,
        error: discountResult.reason
      });
    }

    logger.info('Coupon validation successful', {
      couponCode: coupon.code,
      userId: req.user._id,
      productType,
      productId,
      orderValue,
      discount: discountResult.discount,
      finalAmount: discountResult.finalAmount
    });

    res.json({
      success: true,
      message: 'Coupon is valid',
      coupon: {
        code: coupon.code,
        title: coupon.title,
        description: coupon.description,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue
      },
      discount: discountResult.discount,
      finalAmount: discountResult.finalAmount,
      originalAmount: orderValue,
      savings: discountResult.discount
    });

  } catch (error) {
    logger.error('Error validating coupon', {
      error: error.message,
      stack: error.stack,
      userId: req.user._id,
      couponCode: req.body.code
    });

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to validate coupon'
    });
  }
};

/**
 * Get coupon usage statistics
 */
exports.getCouponStats = async (req, res) => {
  try {
    const { id } = req.params;

    const coupon = await Coupon.findById(id)
      .populate('usageHistory.user', 'fullName email username');

    if (!coupon) {
      return res.status(404).json({
        success: false,
        error: 'Coupon not found'
      });
    }

    // Calculate statistics
    const totalDiscount = coupon.usageHistory.reduce((sum, usage) => sum + (usage.discountApplied || 0), 0);
    const uniqueUsers = new Set(coupon.usageHistory.map(usage => usage.user._id.toString())).size;
    
    // Usage by product type
    const usageByProductType = coupon.usageHistory.reduce((acc, usage) => {
      acc[usage.productType] = (acc[usage.productType] || 0) + 1;
      return acc;
    }, {});

    // Recent usage (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentUsage = coupon.usageHistory.filter(usage => usage.usedAt >= thirtyDaysAgo);

    res.json({
      success: true,
      stats: {
        basicInfo: {
          code: coupon.code,
          title: coupon.title,
          status: coupon.status,
          isValid: coupon.isValid,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue
        },
        usage: {
          totalUses: coupon.usedCount,
          remainingUses: coupon.remainingUses,
          uniqueUsers,
          totalDiscountGiven: totalDiscount,
          usageByProductType,
          recentUsage: recentUsage.length
        },
        timeline: {
          createdAt: coupon.createdAt,
          validFrom: coupon.validFrom,
          validUntil: coupon.validUntil,
          daysRemaining: Math.max(0, Math.ceil((coupon.validUntil - new Date()) / (24 * 60 * 60 * 1000)))
        }
      },
      recentUsageHistory: coupon.usageHistory
        .sort((a, b) => new Date(b.usedAt) - new Date(a.usedAt))
        .slice(0, 10) // Last 10 uses
    });

  } catch (error) {
    logger.error('Error fetching coupon stats', {
      error: error.message,
      stack: error.stack,
      couponId: req.params.id
    });

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch coupon statistics'
    });
  }
};

module.exports = exports;