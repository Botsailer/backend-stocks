const Bundle = require('../models/bundle');

exports.createBundle = async (req,res,next) => {
  const b = await Bundle.create(req.body);
  res.status(201).json(b);
};

exports.updateBundle = async (req,res,next) => {
  const b = await Bundle.findByIdAndUpdate(req.params.id, req.body, { new:true });
  if(!b) return res.status(404).json({ error:'Not found' });
  res.json(b);
};

exports.getAllBundles = async (req,res,next) => {
  const b = await Bundle.find().populate('models');
  res.json(b);
};
