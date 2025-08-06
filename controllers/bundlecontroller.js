const Bundle = require('../models/bundle');
const mongoose = require('mongoose');
const Portfolio = require('../models/modelPortFolio');

const asyncHandler = fn => (req, res, next) => 
  Promise.resolve(fn(req, res, next)).catch(next);

exports.createBundle = asyncHandler(async (req, res) => {
  const { 
    name, 
    description = "", 
    portfolios = [], 
    category, 
    monthlyPrice, 
    quarterlyPrice, 
    yearlyPrice 
  } = req.body;

  if (!name || !category) {
    return res.status(400).json({ error: 'Missing required fields: name and category are required' });
  }

  if (!['basic', 'premium'].includes(category)) {
    return res.status(400).json({ error: 'Invalid category. Must be basic or premium' });
  }

  if (monthlyPrice === undefined && quarterlyPrice === undefined && yearlyPrice === undefined) {
    return res.status(400).json({ error: 'At least one pricing option is required' });
  }

  if (portfolios && portfolios.length > 0) {
    try {
      const existingPortfolios = await Portfolio.find({ _id: { $in: portfolios } });
      
      if (existingPortfolios.length !== portfolios.length) {
        return res.status(400).json({ error: 'One or more portfolio IDs are invalid' });
      }
    } catch (error) {
      return res.status(400).json({ error: 'Invalid portfolio IDs format' });
    }
  }

  const bundle = new Bundle({
    name,
    description,
    portfolios,  
    category,
    monthlyPrice,
    quarterlyPrice,
    yearlyPrice
  });

  await bundle.save();
  
  res.status(201).json(bundle);
});

exports.updateBundle = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.id);
  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found' });
  }

  const { 
    name, 
    description, 
    portfolios, 
    category, 
    monthlyPrice, 
    quarterlyPrice, 
    yearlyPrice 
  } = req.body;

  // Update basic fields
  if (name) bundle.name = name;
  if (description !== undefined) bundle.description = description;
  
  // Validate and update category
  if (category) {
    if (!['basic', 'premium'].includes(category)) {
      return res.status(400).json({ error: 'Invalid category. Must be basic or premium' });
    }
    bundle.category = category;
  }

  // Validate and update portfolios if provided
  if (portfolios !== undefined) {
    if (portfolios.length > 0) {
      try {
        const existingCount = await Portfolio.countDocuments({ _id: { $in: portfolios } });
        if (existingCount !== portfolios.length) {
          return res.status(400).json({ error: 'One or more portfolio IDs are invalid' });
        }
      } catch (error) {
        return res.status(400).json({ error: 'Invalid portfolio IDs format' });
      }
    }
    bundle.portfolios = portfolios;
  }

  // Update pricing fields
  if (monthlyPrice !== undefined) bundle.monthlyPrice = monthlyPrice;
  if (quarterlyPrice !== undefined) bundle.quarterlyPrice = quarterlyPrice;
  if (yearlyPrice !== undefined) bundle.yearlyPrice = yearlyPrice;

  // Validate at least one price exists
  if (bundle.monthlyPrice === null && 
      bundle.quarterlyPrice === null && 
      bundle.yearlyPrice === null) {
    return res.status(400).json({ error: 'At least one pricing option is required' });
  }

  await bundle.save();
  res.status(200).json(bundle);
});


exports.getAllBundles = asyncHandler(async (req, res) => {
  // First, get bundles without population to check the reference IDs
  const rawBundles = await Bundle.find().lean();
  console.log('Raw bundles with portfolio references:', 
    JSON.stringify(rawBundles.map(b => ({
      bundleId: b._id,
      name: b.name,
      portfolioIds: b.portfolios
    })), null, 2)
  );
  
  // Check if those portfolio IDs actually exist
  if (rawBundles.length > 0 && rawBundles[0].portfolios.length > 0) {
    const Portfolio = mongoose.model('Portfolio');
    const samplePortfolioId = rawBundles[0].portfolios[0];
    
    try {
      const portfolioExists = await Portfolio.findById(samplePortfolioId);
      console.log(`Sample portfolio ID ${samplePortfolioId} exists: ${!!portfolioExists}`);
      if (portfolioExists) {
        console.log('Portfolio data sample:', {
          id: portfolioExists._id,
          name: portfolioExists.name
        });
      }
    } catch (error) {
      console.error('Error checking portfolio:', error.message);
    }
  }

  // Try with specific fields in the populate
  const bundles = await Bundle.find()
    .populate({
      path: 'portfolios',
      select: 'name description subscriptionFee minInvestment'
    })
    .sort('-createdAt');
  
  console.log('Populated bundles portfolio count:', 
    bundles.map(b => ({
      bundleName: b.name,
      portfolioCount: Array.isArray(b.portfolios) ? b.portfolios.length : 0
    }))
  );

  res.json(bundles);
});


exports.getBundleById = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.id)
    .populate({
      path: 'portfolios',
      select: 'name description subscriptionFee minInvestment holdings',
      options: { retainNullValues: true }
    });

  if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
  res.json(bundle);
});

exports.deleteBundle = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findByIdAndDelete(req.params.id);
  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found' });
  }
  res.json({ message: 'Bundle deleted successfully' });
});

/**
 * @swagger
 * /api/bundles/{id}/telegram/access-link:
 *   post:
 *     summary: Generate Telegram group access link for bundle
 *     tags: [Bundle, Telegram]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Bundle ID
 *     responses:
 *       200:
 *         description: Access link generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Telegram access link generated successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     linkId:
 *                       type: string
 *                       example: "def456abc789"
 *                     inviteLink:
 *                       type: string
 *                       example: "https://t.me/+XyZaBcDeFgHiJkLm"
 *                     expiresAt:
 *                       type: string
 *                       format: date-time
 *                       example: "2024-12-07T10:30:00Z"
 *                     subscriptionExpiresAt:
 *                       type: string
 *                       format: date-time
 *                       example: "2025-01-07T10:30:00Z"
 *                     maxUses:
 *                       type: number
 *                       example: 1
 *                     currentUses:
 *                       type: number
 *                       example: 0
 *                     bundle:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         name:
 *                           type: string
 *       400:
 *         description: No active subscription found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "No active subscription found for this bundle"
 *       404:
 *         description: Bundle or telegram group not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Bundle not found"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 details:
 *                   type: string
 */
exports.generateTelegramAccessLink = asyncHandler(async (req, res) => {
  const bundleId = req.params.id;
  const userId = req.user._id;
  
  // Check if bundle exists
  const bundle = await Bundle.findById(bundleId);
  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found' });
  }

  // Check if user has active subscription for this bundle
  const Subscription = require('../models/subscription');
  const subscription = await Subscription.findOne({
    user: userId,
    productType: 'Bundle',
    productId: bundleId,
    status: 'active'
  });

  if (!subscription) {
    return res.status(400).json({
      error: 'No active subscription found for this bundle'
    });
  }

  // Check if subscription is expired
  if (subscription.expiresAt < new Date()) {
    return res.status(400).json({
      error: 'Subscription has expired'
    });
  }

  try {
    // Generate access link using telegram service
    const telegramService = require('../services/telegramService');
    const inviteLink = await telegramService.generateAccessLink(
      userId,
      'Bundle',
      bundleId,
      subscription._id
    );

    res.json({
      success: true,
      message: 'Telegram access link generated successfully',
      data: {
        linkId: inviteLink.linkId,
        inviteLink: inviteLink.inviteLink,
        expiresAt: inviteLink.expiresAt,
        subscriptionExpiresAt: inviteLink.subscriptionExpiresAt,
        maxUses: inviteLink.maxUses,
        currentUses: inviteLink.currentUses,
        bundle: {
          id: bundle._id,
          name: bundle.name
        }
      }
    });

  } catch (error) {
    if (error.message.includes('No Telegram group found')) {
      return res.status(404).json({
        error: 'No Telegram group configured for this bundle'
      });
    }

    res.status(500).json({
      error: 'Failed to generate access link',
      details: error.message
    });
  }
});