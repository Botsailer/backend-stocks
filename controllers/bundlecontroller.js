const Bundle = require('../models/bundle');
const Portfolio = require('../models/modelPortFolio');

const asyncHandler = fn => (req, res, next) => 
  Promise.resolve(fn(req, res, next)).catch(next);

exports.createBundle = asyncHandler(async (req, res) => {
  const { name, description = "", portfolios, discountPercentage } = req.body;

  
  if (!name || !portfolios?.length || discountPercentage == null) {
    return res.status(400).json({ error: 'Missing required fields: name, portfolios, or discountPercentage' });
  }


  if (discountPercentage < 0 || discountPercentage > 100) {
    return res.status(400).json({ error: 'Discount percentage must be between 0 and 100' });
  }


  const existingPortfolios = await Portfolio.find({ _id: { $in: portfolios } });
  if (existingPortfolios.length !== portfolios.length) {
    return res.status(400).json({ error: 'One or more portfolio IDs are invalid' });
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
  
  // Populate for virtual price calculations
  const populatedBundle = await Bundle.findById(bundle._id)
    .populate({
      path: 'portfolios',
      select: 'name subscriptionFee'
    });
  
  res.status(201).json(populatedBundle);
});

exports.updateBundle = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.id);
  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found' });
  }

  const { portfolios, discountPercentage } = req.body;

  if (portfolios) {
    const existingCount = await Portfolio.countDocuments({ _id: { $in: portfolios } });
    if (existingCount !== portfolios.length) {
      return res.status(400).json({ error: 'One or more portfolio IDs are invalid' });
    }
    bundle.portfolios = portfolios;
  }

  if (discountPercentage !== undefined) {
    if (discountPercentage < 0 || discountPercentage > 100) {
      return res.status(400).json({ error: 'Discount percentage must be between 0 and 100' });
    }
    bundle.discountPercentage = discountPercentage;
  }

  if (req.body.name) bundle.name = req.body.name;
  if (req.body.description) bundle.description = req.body.description;

  await bundle.save();
  
  const populatedBundle = await Bundle.findById(bundle._id)
    .populate({
      path: 'portfolios',
      select: 'name subscriptionFee'
    });
    
  res.status(200).json(populatedBundle);
});

exports.getAllBundles = asyncHandler(async (req, res) => {
  const bundles = await Bundle.find()
    .populate({
      path: 'portfolios',
      select: 'name subscriptionFee minInvestment',
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

  // Add this safety check to handle missing portfolios
  if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
  if (!bundle.portfolios) bundle.portfolios = []; // Ensure portfolios exists

  res.json(bundle);
});

exports.deleteBundle = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findByIdAndDelete(req.params.id);
  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found' });
  }
  // await Bundle.deleteMany({})
  res.json({ message: 'Bundle deleted successfully' });
});