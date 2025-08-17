const express = require('express');
const router = express.Router();
const portfolioCalculationLogger = require('../services/portfolioCalculationLogger');
const Portfolio = require('../models/modelPortFolio');

/**
 * @swagger
 * /api/portfolio-calculation-logs:
 *   get:
 *     summary: Get detailed portfolio calculation logs
 *     description: Retrieve step-by-step portfolio calculation logs for debugging and analysis
 *     tags: [Portfolio Calculation Logs]
 *     parameters:
 *       - in: query
 *         name: level
 *         schema:
 *           type: string
 *           enum: [INFO, DEBUG, ERROR, SUCCESS]
 *         description: Filter logs by level
 *       - in: query
 *         name: step
 *         schema:
 *           type: string
 *         description: Filter logs by calculation step
 *       - in: query
 *         name: portfolioId
 *         schema:
 *           type: string
 *         description: Filter logs by portfolio ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 1000
 *         description: Limit number of log entries returned
 *     responses:
 *       200:
 *         description: Portfolio calculation logs retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 logs:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                       level:
 *                         type: string
 *                       message:
 *                         type: string
 *                       data:
 *                         type: object
 *                 totalLogs:
 *                   type: integer
 *                 filters:
 *                   type: object
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  try {
    const { level, step, portfolioId, limit = 1000 } = req.query;
    
    let logs = await portfolioCalculationLogger.getLogs();
    
    // Apply filters
    if (level) {
      logs = logs.filter(log => log.level === level.toUpperCase());
    }
    
    if (step) {
      logs = logs.filter(log => log.data && log.data.step === step);
    }
    
    if (portfolioId) {
      logs = logs.filter(log => log.data && log.data.portfolioId === portfolioId);
    }
    
    // Limit results
    const totalLogs = logs.length;
    logs = logs.slice(-parseInt(limit));
    
    res.json({
      success: true,
      logs: logs,
      totalLogs: totalLogs,
      filters: {
        level: level || 'all',
        step: step || 'all',
        portfolioId: portfolioId || 'all',
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve calculation logs',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/portfolio-calculation-logs/calculate/{portfolioId}:
 *   post:
 *     summary: Perform detailed portfolio calculation with logging
 *     description: Execute a complete portfolio calculation with step-by-step logging
 *     tags: [Portfolio Calculation Logs]
 *     parameters:
 *       - in: path
 *         name: portfolioId
 *         required: true
 *         schema:
 *           type: string
 *         description: Portfolio ID to calculate
 *     responses:
 *       200:
 *         description: Portfolio calculation completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 result:
 *                   type: object
 *                   properties:
 *                     totalPortfolioValue:
 *                       type: number
 *                     cashBalance:
 *                       type: number
 *                     holdingsValueAtMarket:
 *                       type: number
 *                 message:
 *                   type: string
 *       404:
 *         description: Portfolio not found
 *       500:
 *         description: Calculation failed
 */
router.post('/calculate/:portfolioId', async (req, res) => {
  try {
    const { portfolioId } = req.params;
    
    const portfolio = await Portfolio.findById(portfolioId);
    if (!portfolio) {
      return res.status(404).json({
        success: false,
        error: 'Portfolio not found'
      });
    }
    
    const result = await portfolioCalculationLogger.logCompleteCalculation(portfolio);
    
    res.json({
      success: true,
      result: result,
      message: `Detailed calculation completed for portfolio "${portfolio.name}". Check logs for step-by-step details.`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Portfolio calculation failed',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/portfolio-calculation-logs/summary:
 *   get:
 *     summary: Get calculation logs summary
 *     description: Get a summary of recent calculation activities
 *     tags: [Portfolio Calculation Logs]
 *     responses:
 *       200:
 *         description: Logs summary retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalLogs:
 *                       type: integer
 *                     logsByLevel:
 *                       type: object
 *                     recentCalculations:
 *                       type: array
 *                     lastCalculation:
 *                       type: string
 *                       format: date-time
 */
router.get('/summary', async (req, res) => {
  try {
    const logs = await portfolioCalculationLogger.getLogs();
    
    const summary = {
      totalLogs: logs.length,
      logsByLevel: {},
      recentCalculations: [],
      lastCalculation: null
    };
    
    // Count logs by level
    logs.forEach(log => {
      summary.logsByLevel[log.level] = (summary.logsByLevel[log.level] || 0) + 1;
    });
    
    // Find recent calculations (COMPLETION entries)
    const completionLogs = logs
      .filter(log => log.data && log.data.step === 'COMPLETION')
      .slice(-10)
      .map(log => ({
        timestamp: log.timestamp,
        portfolioId: log.data.portfolioId,
        portfolioName: log.data.portfolioName,
        totalValue: log.data.finalValues ? log.data.finalValues.totalPortfolioValue : null
      }));
    
    summary.recentCalculations = completionLogs;
    summary.lastCalculation = completionLogs.length > 0 ? completionLogs[completionLogs.length - 1].timestamp : null;
    
    res.json({
      success: true,
      summary: summary
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve logs summary',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/portfolio-calculation-logs/clear:
 *   delete:
 *     summary: Clear all calculation logs
 *     description: Delete all stored calculation logs
 *     tags: [Portfolio Calculation Logs]
 *     responses:
 *       200:
 *         description: Logs cleared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       500:
 *         description: Failed to clear logs
 */
router.delete('/clear', async (req, res) => {
  try {
    await portfolioCalculationLogger.clearLogs();
    
    res.json({
      success: true,
      message: 'Portfolio calculation logs cleared successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to clear logs',
      message: error.message
    });
  }
});

/**
 * @swagger
 * /api/portfolio-calculation-logs/steps:
 *   get:
 *     summary: Get available calculation steps
 *     description: Get list of all available calculation steps for filtering
 *     tags: [Portfolio Calculation Logs]
 *     responses:
 *       200:
 *         description: Available steps retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 steps:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       step:
 *                         type: string
 *                       description:
 *                         type: string
 */
router.get('/steps', async (req, res) => {
  try {
    const steps = [
      { step: 'INITIALIZATION', description: 'Portfolio calculation started' },
      { step: 'STEP_1_PRICE_FETCH', description: 'Fetching real-time market prices' },
      { step: 'STEP_1_INDIVIDUAL_PRICE', description: 'Individual stock price details' },
      { step: 'STEP_2_MIN_INVESTMENT', description: 'Minimum investment validation' },
      { step: 'STEP_2_FORMULA', description: 'Effective minimum investment formula' },
      { step: 'STEP_2_COMPARISON', description: 'Investment comparison analysis' },
      { step: 'STEP_3_CASH_CALCULATION', description: 'Cash balance calculation' },
      { step: 'STEP_3_EXISTING_CASH', description: 'Using existing cash balance' },
      { step: 'STEP_3_CASH_FORMULA', description: 'Cash balance formula calculation' },
      { step: 'STEP_3_FINAL_CASH', description: 'Final cash balance result' },
      { step: 'STEP_4_HOLDINGS_VALUE', description: 'Holdings value calculation' },
      { step: 'STEP_4_INDIVIDUAL_HOLDING', description: 'Individual holding value details' },
      { step: 'STEP_4_HOLDINGS_SUMMARY', description: 'Holdings summary' },
      { step: 'STEP_5_TOTAL_VALUE', description: 'Total portfolio value calculation' },
      { step: 'STEP_5_FORMULA', description: 'Total portfolio value formula' },
      { step: 'STEP_6_FINAL_SUMMARY', description: 'Final validation and summary' },
      { step: 'STEP_6_VALIDATION', description: 'Validation summary' },
      { step: 'COMPLETION', description: 'Calculation completed successfully' },
      { step: 'CRITICAL_ERROR', description: 'Critical calculation error' }
    ];
    
    res.json({
      success: true,
      steps: steps
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve steps',
      message: error.message
    });
  }
});

module.exports = router;
