const FAQ = require('../models/faqschema');
const { validationResult } = require('express-validator');

const asyncHandler = fn => (req, res, next) => 
  Promise.resolve(fn(req, res, next)).catch(next);

// Validation middleware
exports.validateFAQ = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed',
      details: errors.array() 
    });
  }
  next();
};

exports.createFAQ = asyncHandler(async (req, res) => {
  const { question, answer, tags = [], category = 'General', relatedFAQs = [] } = req.body;
  
  const existingFAQ = await FAQ.findOne({ question });
  if (existingFAQ) {
    return res.status(409).json({ 
      error: 'Duplicate question',
      message: 'FAQ with this question already exists' 
    });
  }

  const faq = new FAQ({
    question,
    answer,
    tags,
    category,
    relatedFAQs,
    lastUpdatedBy: req.user.id
  });

  await faq.save();
  res.status(201).json(faq);
});

exports.getAllFAQs = asyncHandler(async (req, res) => {
  const { category, tag, search } = req.query;
  const filter = {};
  
  if (category) filter.category = category;
  if (tag) filter.tags = tag;
  if (search) filter.$text = { $search: search };
  
  const faqs = await FAQ.find(filter)
    .populate('relatedFAQs', 'question')
    .populate('lastUpdatedBy', 'name email')
    .sort({ createdAt: -1 });

  res.status(200).json(faqs);
});

exports.getFAQById = asyncHandler(async (req, res) => {
  const faq = await FAQ.findById(req.params.id)
    .populate('relatedFAQs', 'question')
    .populate('lastUpdatedBy', 'name email');
  
  if (!faq) {
    return res.status(404).json({ 
      error: 'FAQ not found',
      message: `No FAQ found with ID: ${req.params.id}` 
    });
  }
  
  res.status(200).json(faq);
});

exports.updateFAQ = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updateData = { ...req.body, lastUpdatedBy: req.user.id };
  
  const faq = await FAQ.findByIdAndUpdate(id, updateData, {
    new: true,
    runValidators: true
  })
    .populate('relatedFAQs', 'question')
    .populate('lastUpdatedBy', 'name email');
  
  if (!faq) {
    return res.status(404).json({ 
      error: 'FAQ not found',
      message: `No FAQ found with ID: ${id}` 
    });
  }
  
  res.status(200).json(faq);
});

exports.deleteFAQ = asyncHandler(async (req, res) => {
  const faq = await FAQ.findByIdAndDelete(req.params.id);
  
  if (!faq) {
    return res.status(404).json({ 
      error: 'FAQ not found',
      message: `No FAQ found with ID: ${req.params.id}` 
    });
  }
  
  // Remove references from related FAQs
  await FAQ.updateMany(
    { relatedFAQs: req.params.id },
    { $pull: { relatedFAQs: req.params.id } }
  );
  
  res.status(200).json({ 
    message: 'FAQ deleted successfully',
    deletedId: req.params.id
  });
});

exports.errorHandler = (err, req, res, next) => {
  console.error(`FAQ Error: ${err.message}`);
  
  let status = 500;
  let message = 'Server Error';
  
  if (err.name === 'CastError') {
    status = 400;
    message = 'Invalid ID format';
  } else if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors).map(val => val.message).join(', ');
  } else if (err.code === 11000) {
    status = 409;
    message = 'Duplicate FAQ question detected';
  }
  
  res.status(status).json({
    error: 'FAQ Operation Failed',
    message,
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};