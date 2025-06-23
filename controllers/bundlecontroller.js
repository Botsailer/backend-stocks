const Bundle = require('../models/bundle');
const Portfolio = require('../models/modelPortFolio');
const Subscription = require('../models/subscription');
const mongoose = require('mongoose');

const asyncHandler = fn => (req, res, next) => 
  Promise.resolve(fn(req, res, next)).catch(next);

exports.createBundle = asyncHandler(async (req, res) => {
  const { name, description = "", portfolios, discountPercentage } = req.body;
  
  // Validate required fields
  if (!name || !portfolios?.length || discountPercentage == null) {
    return res.status(400).json({ 
      error: 'Missing required fields: name, portfolios, or discountPercentage' 
    });
  }

  // Validate discount percentage
  if (discountPercentage < 0 || discountPercentage > 100) {
    return res.status(400).json({ 
      error: 'Discount percentage must be between 0 and 100' 
    });
  }

  // Validate portfolio IDs
  if (!portfolios.every(id => mongoose.Types.ObjectId.isValid(id))) {
    return res.status(400).json({ error: 'Invalid portfolio ID format' });
  }

  // Verify portfolios exist
  const existingPortfolios = await Portfolio.find({ _id: { $in: portfolios } });
  if (existingPortfolios.length !== portfolios.length) {
    const missingPortfolios = portfolios.filter(
      id => !existingPortfolios.some(p => p._id.equals(id))
    );
    return res.status(400).json({ 
      error: 'One or more portfolio IDs are invalid',
      missingPortfolios
    });
  }

  // Check for duplicate bundle name
  const existingBundle = await Bundle.findOne({ name });
  if (existingBundle) {
    return res.status(400).json({ 
      error: 'Bundle name already exists' 
    });
  }

  // Create new bundle
  const bundle = new Bundle({
    name,
    description,
    portfolios,
    discountPercentage
  });

  // Save to database
  await bundle.save();
  
  // Return populated bundle with calculated prices
  const populatedBundle = await Bundle.findById(bundle._id)
    .populate({
      path: 'portfolios',
      select: 'name subscriptionFee minInvestment'
    });
  
  res.status(201).json({
    message: 'Bundle created successfully',
    bundle: populatedBundle
  });
});

exports.updateBundle = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.id);
  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found' });
  }

  const { name, description, portfolios, discountPercentage } = req.body;

  // Update name if provided
  if (name) {
    if (name !== bundle.name) {
      const existingBundle = await Bundle.findOne({ name });
      if (existingBundle) {
        return res.status(400).json({ error: 'Bundle name already exists' });
      }
      bundle.name = name;
    }
  }

  // Update description if provided
  if (description !== undefined) {
    bundle.description = description;
  }

  // Update portfolios if provided
  if (portfolios) {
    if (!Array.isArray(portfolios)) {
      return res.status(400).json({ error: 'Portfolios must be an array' });
    }
    
    if (!portfolios.every(id => mongoose.Types.ObjectId.isValid(id))) {
      return res.status(400).json({ error: 'Invalid portfolio ID format' });
    }

    // Verify portfolios exist
    const existingCount = await Portfolio.countDocuments({ _id: { $in: portfolios } });
    if (existingCount !== portfolios.length) {
      return res.status(400).json({ error: 'One or more portfolio IDs are invalid' });
    }
    
    bundle.portfolios = portfolios;
  }

  // Update discount percentage if provided
  if (discountPercentage !== undefined) {
    if (discountPercentage < 0 || discountPercentage > 100) {
      return res.status(400).json({ error: 'Discount percentage must be between 0 and 100' });
    }
    bundle.discountPercentage = discountPercentage;
  }

  // Save updated bundle
  await bundle.save();
  
  // Return populated bundle with calculated prices
  const populatedBundle = await Bundle.findById(bundle._id)
    .populate({
      path: 'portfolios',
      select: 'name subscriptionFee minInvestment'
    });
    
  res.status(200).json({
    message: 'Bundle updated successfully',
    bundle: populatedBundle
  });
});

exports.getAllBundles = asyncHandler(async (req, res) => {
  // Get query parameters for filtering
  const { name, minDiscount, maxDiscount } = req.query;
  const filter = {};
  
  // Add name filter if provided
  if (name) {
    filter.name = { $regex: name, $options: 'i' };
  }
  
  // Add discount range filter if provided
  if (minDiscount || maxDiscount) {
    filter.discountPercentage = {};
    if (minDiscount) filter.discountPercentage.$gte = Number(minDiscount);
    if (maxDiscount) filter.discountPercentage.$lte = Number(maxDiscount);
  }

  const bundles = await Bundle.find(filter)
    .populate({
      path: 'portfolios',
      select: 'name subscriptionFee minInvestment',
      options: { retainNullValues: true }
    })
    .sort('-createdAt');

  res.json({
    count: bundles.length,
    bundles
  });
});

exports.getBundleById = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid bundle ID format' });
  }

  const bundle = await Bundle.findById(req.params.id)
    .populate({
      path: 'portfolios',
      select: 'name description subscriptionFee minInvestment holdings',
      options: { retainNullValues: true }
    });

  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found' });
  }

  // Ensure portfolios array exists
  if (!bundle.portfolios) bundle.portfolios = [];

  res.json(bundle);
});

exports.deleteBundle = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid bundle ID format' });
  }

  const bundle = await Bundle.findByIdAndDelete(req.params.id);
  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found' });
  }

  // Remove bundle reference from subscriptions
  await Subscription.updateMany(
    { bundle: bundle._id },
    { $unset: { bundle: "" } }
  );

  res.json({ 
    message: 'Bundle deleted successfully',
    deletedBundle: {
      id: bundle._id,
      name: bundle.name
    }
  });
});