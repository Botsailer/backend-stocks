const Bundle = require('../models/Bundle');
const Portfolio = require('../models/modelPortFolio');

const asyncHandler = fn => (req, res, next) => 
  Promise.resolve(fn(req, res, next)).catch(next);

// @desc    Create new bundle
// @route   POST /api/bundles
exports.createBundle = asyncHandler(async (req, res) => {
  const { name, description, portfolios, discountPercentage } = req.body;

  if (!name || !portfolios?.length || discountPercentage == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Verify all portfolios exist
  const existingPortfolios = await Portfolio.find({ _id: { $in: portfolios } });
  if (existingPortfolios.length !== portfolios.length) {
    return res.status(400).json({ error: 'Invalid portfolio IDs' });
  }

  const bundle = new Bundle({
    name,
    description,
    portfolios,
    discountPercentage,
    subscription: { amount: 0 } // Will be calculated in pre-save hook
  });

  await bundle.save();
  res.status(201).json(bundle);
});

// @desc    Update bundle
// @route   PUT /api/bundles/:id
exports.updateBundle = asyncHandler(async (req, res) => {
  const updates = { ...req.body };
  
  if (updates.portfolios) {
    const existing = await Portfolio.countDocuments({ _id: { $in: updates.portfolios } });
    if (existing !== updates.portfolios.length) {
      return res.status(400).json({ error: 'Invalid portfolio IDs' });
    }
  }

  const bundle = await Bundle.findByIdAndUpdate(
    req.params.id,
    updates,
    { new: true, runValidators: true }
  );

  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found' });
  }

  res.json(bundle);
});

// @desc    Get all bundles (with portfolio details)
// @route   GET /api/bundles
exports.getAllBundles = asyncHandler(async (req, res) => {
  const bundles = await Bundle.find()
    .populate({
      path: 'portfolios',
      select: 'name description subscriptionFee minInvestment'
    })
    .sort('-createdAt');

  res.json(bundles);
});

// @desc    Get single bundle
// @route   GET /api/bundles/:id
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

// @desc    Delete bundle
// @route   DELETE /api/bundles/:id
exports.deleteBundle = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findByIdAndDelete(req.params.id);
  
  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found' });
  }

  res.json({ message: 'Bundle deleted successfully' });
});
