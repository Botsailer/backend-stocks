const Bundle = require('../models/Bundle');
const Portfolio = require('../models/modelPortFolio');

exports.createBundle = async (req, res, next) => {
  try {
    const { portfolios, ...rest } = req.body;
    
    // Validate portfolios exist
    const portfolioExists = await Portfolio.countDocuments({ 
      _id: { $in: portfolios } 
    });
    
    if (portfolioExists !== portfolios.length) {
      return res.status(400).json({ 
        error: 'One or more portfolios not found' 
      });
    }

    const bundle = await Bundle.create({
      ...rest,
      portfolios
    });

    res.status(201).json(bundle);
  } catch (error) {
    next(error);
  }
};

exports.updateBundle = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { portfolios, ...rest } = req.body;

    const updateData = { ...rest };
    
    if (portfolios) {
      // Validate portfolios exist
      const portfolioExists = await Portfolio.countDocuments({ 
        _id: { $in: portfolios } 
      });
      
      if (portfolioExists !== portfolios.length) {
        return res.status(400).json({ 
          error: 'One or more portfolios not found' 
        });
      }
      updateData.portfolios = portfolios;
    }

    const bundle = await Bundle.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('portfolios');

    if (!bundle) {
      return res.status(404).json({ error: 'Bundle not found' });
    }

    res.json(bundle);
  } catch (error) {
    next(error);
  }
};

exports.getAllBundles = async (req, res, next) => {
  try {
    const bundles = await Bundle.find()
      .populate({
        path: 'portfolios',
        select: 'name description subscriptionFee minInvestment durationMonths'
      })
      .sort('-createdAt');

    res.json(bundles);
  } catch (error) {
    next(error);
  }
};
