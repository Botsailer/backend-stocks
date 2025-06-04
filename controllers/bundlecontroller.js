const Bundle = require('../models/bundle');
const Portfolio = require('../models/modelPortFolio');

const asyncHandler = fn => (req, res, next) => 
  Promise.resolve(fn(req, res, next)).catch(next);

function computePrices(portfolios, discountPercentage) {
  const prices = {
    monthly: 0,
    quarterly: 0,
    yearly: 0
  };

  portfolios.forEach(portfolio => {
    portfolio.subscriptionFee.forEach(fee => {
      if (fee.type === 'monthly') prices.monthly += fee.price;
      if (fee.type === 'quarterly') prices.quarterly += fee.price;
      if (fee.type === 'yearly') prices.yearly += fee.price;
    });
  });

  return {
    monthly: prices.monthly * (1 - discountPercentage / 100),
    quarterly: prices.quarterly * (1 - discountPercentage / 100),
    yearly: prices.yearly * (1 - discountPercentage / 100)
  };
}

exports.createBundle = asyncHandler(async (req, res) => {
  const { name, description = [], portfolios, discountPercentage } = req.body;

  if (!name || !portfolios?.length || discountPercentage == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const existingPortfolios = await Portfolio.find({ _id: { $in: portfolios } });
  if (existingPortfolios.length !== portfolios.length) {
    return res.status(400).json({ error: 'Invalid portfolio IDs' });
  }

  const bundle = new Bundle({
    name,
    description,
    portfolios,
    discountPercentage
  });

  await bundle.save();
  
  // Populate for virtuals
  const populatedBundle = await Bundle.findById(bundle._id)
    .populate({
      path: 'portfolios',
      select: 'subscriptionFee'
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
    const existing = await Portfolio.countDocuments({ _id: { $in: portfolios } });
    if (existing !== portfolios.length) {
      return res.status(400).json({ error: 'Invalid portfolio IDs' });
    }
    bundle.portfolios = portfolios;
  }

  if (discountPercentage !== undefined) {
    bundle.discountPercentage = discountPercentage;
  }

  if (req.body.name) bundle.name = req.body.name;
  if (req.body.description) bundle.description = req.body.description;

  await bundle.save();
  
  const populatedBundle = await Bundle.findById(bundle._id)
    .populate({
      path: 'portfolios',
      select: 'subscriptionFee'
    });
    
  res.status(200).json(populatedBundle);
});

exports.getAllBundles = asyncHandler(async (req, res) => {
  const bundles = await Bundle.find()
    .populate({
      path: 'portfolios',
      select: 'name description subscriptionFee minInvestment'
    })
    .sort('-createdAt');

  res.json(bundles);
});

exports.getBundleById = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.id)
    .populate({
      path: 'portfolios',
      select: 'name description subscriptionFee minInvestment holdings'
    });

  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found' });
  }

  res.json(bundle);
});

exports.deleteBundle = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findByIdAndDelete(req.params.id);
  //clear whole cillection
  // await Bundle.deleteMany({});
  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found' });
  }

  res.json({ message: 'Bundle deleted successfully' });
});