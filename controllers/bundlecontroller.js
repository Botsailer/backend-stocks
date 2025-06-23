const Bundle = require('../models/bundle');
const Portfolio = require('../models/modelPortFolio');

const asyncHandler = fn => (req, res, next) => 
  Promise.resolve(fn(req, res, next)).catch(next);

exports.createBundle = asyncHandler(async (req, res) => {
  const { name, description = "", portfolios, category, monthlyPrice, quarterlyPrice, yearlyPrice } = req.body;

  // Validation
  if (!name || !portfolios?.length || !category) {
    return res.status(400).json({ error: 'Missing required fields: name, portfolios, or category' });
  }

  if (!['basic', 'premium'].includes(category)) {
    return res.status(400).json({ error: 'Invalid category. Must be basic or premium' });
  }

  if (portfolios.length === 0) {
    return res.status(400).json({ error: 'At least one portfolio is required' });
  }

  // Check if at least one price is provided
  if (monthlyPrice === null && quarterlyPrice === null && yearlyPrice === null) {
    return res.status(400).json({ error: 'At least one pricing option is required' });
  }

  // Validate portfolio IDs
  const existingPortfolios = await Portfolio.find({ _id: { $in: portfolios } });
  if (existingPortfolios.length !== portfolios.length) {
    return res.status(400).json({ error: 'One or more portfolio IDs are invalid' });
  }

  // Create new bundle
  const bundle = new Bundle({
    name,
    description,
    portfolios,
    category,
    monthlyPrice,
    quarterlyPrice,
    yearlyPrice
  });

  // Save to database
  await bundle.save();
  
  res.status(201).json(bundle);
});

exports.updateBundle = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.id);
  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found' });
  }

  const { name, description, portfolios, category, monthlyPrice, quarterlyPrice, yearlyPrice } = req.body;

  // Update fields
  if (name) bundle.name = name;
  if (description !== undefined) bundle.description = description;
  if (category) {
    if (!['basic', 'premium'].includes(category)) {
      return res.status(400).json({ error: 'Invalid category. Must be basic or premium' });
    }
    bundle.category = category;
  }

  // Validate portfolios if updating
  if (portfolios) {
    if (portfolios.length === 0) {
      return res.status(400).json({ error: 'At least one portfolio is required' });
    }
    
    const existingCount = await Portfolio.countDocuments({ _id: { $in: portfolios } });
    if (existingCount !== portfolios.length) {
      return res.status(400).json({ error: 'One or more portfolio IDs are invalid' });
    }
    bundle.portfolios = portfolios;
  }

  // Update pricing
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
  const bundles = await Bundle.find()
    .populate({
      path: 'portfolios',
      select: 'name description subscriptionFee minInvestment',
      options: { retainNullValues: true }
    })
    .sort('-createdAt');

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