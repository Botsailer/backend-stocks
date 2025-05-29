const express = require('express');
const router = express.Router();
const faqController = require('../controllers/faqcontroller');
const requireAdmin = require('../middleware/requirreAdmin');
const { body } = require('express-validator');

/**
 * @swagger
 * tags:
 *   name: FAQs
 *   description: Frequently Asked Questions management
 * components:
 *   schemas:
 *     FAQ:
 *       type: object
 *       required:
 *         - question
 *         - answer
 *         - category
 *       properties:
 *         id:
 *           type: string
 *           readOnly: true
 *           example: "5f8d04b3ab35de3b342f7d12"
 *         question:
 *           type: string
 *           minLength: 10
 *           maxLength: 255
 *           example: "How do I start investing?"
 *         answer:
 *           type: object
 *           description: Flexible answer structure (string, array, or nested objects)
 *           example:
 *             section1:
 *               title: "Getting Started"
 *               content: 
 *                 - "Create an account on our platform"
 *                 - "Complete your investor profile"
 *             section2:
 *               title: "Investment Options"
 *               content:
 *                 stocks: "Individual company stocks"
 *                 funds: "Pre-built investment portfolios"
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *           example: ["investing", "beginner"]
 *         category:
 *           type: string
 *           enum: [General, Account, Billing, Technical, Investments, Other]
 *           example: "Investments"
 *         relatedFAQs:
 *           type: array
 *           items:
 *             type: string
 *           example: ["5f8d04b3ab35de3b342f7d13", "5f8d04b3ab35de3b342f7d14"]
 *         lastUpdatedBy:
 *           type: string
 *           readOnly: true
 *           example: "5f8d04b3ab35de3b342f7d15"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           readOnly: true
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           readOnly: true
 *   responses:
 *     FAQNotFound:
 *       description: FAQ not found
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               error:
 *                 type: string
 *               message:
 *                 type: string
 *     FAQValidationError:
 *       description: Validation error
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               error:
 *                 type: string
 *               details:
 *                 type: array
 *                 items:
 *                   type: object
 */

// Validation rules
const faqValidationRules = [
  body('question')
    .trim()
    .isLength({ min: 10, max: 255 })
    .withMessage('Question must be between 10-255 characters'),
  body('answer')
    .exists()
    .withMessage('Answer is required')
    .custom(value => {
      if (value === null || value === undefined) return false;
      if (typeof value === 'string' && value.trim() === '') return false;
      if (Array.isArray(value) && value.length === 0) return false;
      if (typeof value === 'object' && Object.keys(value).length === 0) return false;
      return true;
    })
    .withMessage('Answer cannot be empty'),
  body('tags')
    .optional()
    .isArray({ max: 10 })
    .withMessage('Cannot have more than 10 tags'),
  body('category')
    .isIn(['General', 'Account', 'Billing', 'Technical', 'Investments', 'Other'])
    .withMessage('Invalid category'),
  body('relatedFAQs')
    .optional()
    .isArray()
    .withMessage('Related FAQs must be an array')
];

// ================================
// FAQ CRUD Operations
// ================================

/**
 * @swagger
 * /api/faqs:
 *   post:
 *     summary: Create a new FAQ
 *     tags: [FAQs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FAQ'
 *           examples:
 *             SimpleAnswer:
 *               value:
 *                 question: "How do I reset my password?"
 *                 answer: "Go to the login page and click 'Forgot Password'"
 *                 category: "Account"
 *             NestedAnswer:
 *               value:
 *                 question: "What investment options are available?"
 *                 answer:
 *                   stocks:
 *                     description: "Individual company stocks"
 *                     minimum: "$50"
 *                   portfolios:
 *                     description: "Pre-built investment portfolios"
 *                     minimum: "$1000"
 *                 tags: ["investing", "beginner"]
 *                 category: "Investments"
 *                 relatedFAQs: ["5f8d04b3ab35de3b342f7d13"]
 *     responses:
 *       201:
 *         description: Created FAQ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/FAQ'
 *       400:
 *         $ref: '#/components/responses/FAQValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       409:
 *         description: Duplicate question
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 message:
 *                   type: string
 */
router.post(
  '/',
  requireAdmin,
  faqValidationRules,
  faqController.validateFAQ,
  faqController.createFAQ
);

/**
 * @swagger
 * /api/faqs:
 *   get:
 *     summary: Get all FAQs
 *     tags: [FAQs]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [General, Account, Billing, Technical, Investments, Other]
 *         description: Filter by category
 *       - in: query
 *         name: tag
 *         schema:
 *           type: string
 *         description: Filter by tag
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search text in questions
 *     responses:
 *       200:
 *         description: List of FAQs
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/FAQ'
 */
router.get('/', faqController.getAllFAQs);

/**
 * @swagger
 * /api/faqs/{id}:
 *   get:
 *     summary: Get FAQ by ID
 *     tags: [FAQs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: FAQ ID
 *     responses:
 *       200:
 *         description: FAQ data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/FAQ'
 *       404:
 *         $ref: '#/components/responses/FAQNotFound'
 */
router.get('/:id', faqController.getFAQById);

/**
 * @swagger
 * /api/faqs/{id}:
 *   put:
 *     summary: Update FAQ by ID
 *     tags: [FAQs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: FAQ ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FAQ'
 *           example:
 *             question: "Updated question about investments"
 *             answer:
 *               section1:
 *                 title: "Updated Content"
 *                 points:
 *                   - "Point 1"
 *                   - "Point 2"
 *             tags: ["updated", "investments"]
 *     responses:
 *       200:
 *         description: Updated FAQ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/FAQ'
 *       400:
 *         $ref: '#/components/responses/FAQValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/FAQNotFound'
 */
router.put(
  '/:id',
  requireAdmin,
  faqValidationRules,
  faqController.validateFAQ,
  faqController.updateFAQ
);

/**
 * @swagger
 * /api/faqs/{id}:
 *   delete:
 *     summary: Delete FAQ by ID
 *     tags: [FAQs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: FAQ ID
 *     responses:
 *       200:
 *         description: FAQ deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 deletedId:
 *                   type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/FAQNotFound'
 */
router.delete('/:id', requireAdmin, faqController.deleteFAQ);

// Error handler (should be last)
router.use(faqController.errorHandler);

module.exports = router;