const asyncHandler = require('express-async-handler');
const portfolioService = require('../services/portfolioservice');
const Portfolio = require('../models/modelPortFolio');

exports.getPortfolioChart = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { period = '1m' } = req.query;
  
  const periodMap = {
    '1w': 7,
    '1m': 30,
    '3m': 90,
    '6m': 180,
    '1y': 365,
    'all': 365 * 5 // 5 years
  };
  
  const days = periodMap[period] || 30;
  
  // Always update with latest prices before generating chart
  await portfolioService.updatePortfolioValue(id);
  const chartData = await portfolioService.generateChartData(id, days);
  
  res.status(200).json({
    status: 'success',
    portfolioId: id,
    dataPoints: chartData.length,
    chartData
  });
});

exports.getRealTimeValue = asyncHandler(async (req, res) => {
  const portfolio = await Portfolio.findById(req.params.id);
  if (!portfolio) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  const realTimeValue = await portfolioService.calculateRealTimeValue(portfolio);
  
  res.status(200).json({
    portfolioId: portfolio._id,
    currentValue: realTimeValue,
    lastUpdated: new Date()
  });
});