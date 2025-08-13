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
    monthlyemandateprice, 
    yearlyPrice 
  } = req.body;

  if (!name || !category) {
    return res.status(400).json({ error: 'Missing required fields: name and category are required' });
  }

  if (!['basic', 'premium'].includes(category)) {
    return res.status(400).json({ error: 'Invalid category. Must be basic or premium' });
  }

  if (monthlyPrice === undefined && monthlyemandateprice === undefined && yearlyPrice === undefined) {
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
    monthlyemandateprice,
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
    monthlyemandateprice, 
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
  if (monthlyemandateprice !== undefined) bundle.monthlyemandateprice = monthlyemandateprice;
  if (yearlyPrice !== undefined) bundle.yearlyPrice = yearlyPrice;

  // Validate at least one price exists
  if (bundle.monthlyPrice === null && 
      bundle.monthlyemandateprice === null && 
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