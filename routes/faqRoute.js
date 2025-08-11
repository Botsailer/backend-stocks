const express = require('express');
const router = express.Router();
const faqController = require('../controllers/faqcontroller');
const requireAdmin = require('../middleware/requirreAdmin');
const { body } = require('express-validator');

/**
 * @swagger
 * tags:
 *   name: FAQs
 *   description: |
 *     Manage Frequently Asked Questions.
 *     
 *     SIMPLE EXPLANATION (for non-technical users):
 *     The "answer" field can look different depending on how you want it to show on the website/app. Just pick ONE style:
 *     1. A single sentence or paragraph (string)
 *     2. A list of bullet points (array of strings)
 *     3. A structured object with named sections (each section can have a title and a list)
 *     4. A detailed object mixing sections, lists, and key/value items
 *     
 *     You don't need to use all formats—choose what feels natural. The system stores what you send and the frontend will render it nicely.
 *     When you delete an FAQ, any references to it inside other FAQs' "relatedFAQs" lists are automatically removed.
 * components:
 *   schemas:
 *     FAQAnswerSection:
 *       type: object
 *       description: One section of a structured answer.
 *       properties:
 *         title:
 *           type: string
 *           description: Short heading for this section.
 *           example: "Getting Started"
 *         content:
 *           description: Either a list of bullet points OR an object with named sub-points.
 *           oneOf:
 *             - type: array
 *               items: { type: string }
 *               example:
 *                 - "Create an account"
 *                 - "Verify your email"
 *             - type: object
 *               additionalProperties: true
 *               example:
 *                 step1: "Create an account"
 *                 step2: "Verify identity"
 *         notes:
 *           type: array
 *           description: Optional extra notices or disclaimers.
 *           items: { type: string }
 *           example:
 *             - "Investing involves risk"
 *             - "Past performance is not a guarantee"
 *     FAQAnswer:
 *       description: |
 *         Flexible answer shape (choose ONE of these). For non-tech editors: just send the style you want; don't wrap it in extra objects.
 *       oneOf:
 *         - type: string
 *           description: Simple sentence or paragraph.
 *           example: "Click 'Forgot Password' and follow the instructions."
 *         - type: array
 *           description: Bullet list. Each item becomes one bullet.
 *           items: { type: string }
 *           example:
 *             - "Open account"
 *             - "Add funds"
 *             - "Choose a plan"
 *         - type: object
 *           description: Sectioned layout or richer structure.
 *           additionalProperties:
 *             oneOf:
 *               - $ref: '#/components/schemas/FAQAnswerSection'
 *               - type: string
 *               - type: array
 *                 items: { type: string }
 *           example:
 *             intro: "Start small and stay consistent."
 *             basics:
 *               title: "First Steps"
 *               content:
 *                 - "Register"
 *                 - "Complete profile"
 *             funding:
 *               title: "Funding"
 *               content:
 *                 step1: "Link bank account"
 *                 step2: "Make first deposit"
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
 *         question:
 *           type: string
 *           description: The question users will see.
 *           minLength: 10
 *           maxLength: 255
 *           example: "How do I start investing?"
 *         answer:
 *           $ref: '#/components/schemas/FAQAnswer'
 *         tags:
 *           type: array
 *           description: Words to help searching / grouping (max 10).
 *           items: { type: string }
 *           example: ["investing", "beginner"]
 *         category:
 *           type: string
 *           description: High-level grouping.
 *           enum: [General, Account, Billing, Technical, Investments, Other]
 *           example: Investments
 *         relatedFAQs:
 *           type: array
 *           description: IDs of other related FAQs (optional cross-links).
 *           items: { type: string }
 *           example: ["66b5e5e2f4f9f4a6e19d0f13"]
 *         lastUpdatedBy:
 *           type: string
 *           readOnly: true
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
 *     FAQValidationError:
 *       description: Validation error
 *     Unauthorized:
 *       description: Missing or invalid token
 *     Forbidden:
 *       description: Not an admin
 */

// Validation rules (create requires mandatory fields)
const createFAQValidationRules = [
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

// Patch rules (all optional, validate only if present)
const patchFAQValidationRules = [
  body('question')
    .optional()
    .trim()
    .isLength({ min: 10, max: 255 })
    .withMessage('Question must be between 10-255 characters'),
  body('answer')
    .optional()
    .custom(value => {
      if (value === null) return false;
      if (typeof value === 'string' && value.trim() === '') return false;
      if (Array.isArray(value) && value.length === 0) return false;
      if (typeof value === 'object' && Object.keys(value).length === 0) return false;
      return true;
    })
    .withMessage('Answer cannot be empty when provided'),
  body('tags')
    .optional()
    .isArray({ max: 10 })
    .withMessage('Cannot have more than 10 tags'),
  body('category')
    .optional()
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
 *     description: |
 *       Provide a question, a category, and an answer using ONE of the supported answer styles shown in the examples.
 *       Non-technical guide:
 *       - If unsure, just send a simple string.
 *       - Use a list for step-by-step answers.
 *       - Use sections for longer guides.
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
 *             simpleText:
 *               summary: Single sentence answer
 *               value:
 *                 question: "How do I reset my password?"
 *                 answer: "Click 'Forgot Password' on the login screen and follow the email instructions."
 *                 category: Account
 *             bulletList:
 *               summary: Bullet list answer
 *               value:
 *                 question: "What are the first steps to start investing?"
 *                 answer:
 *                   - "Create your account"
 *                   - "Verify identity"
 *                   - "Add funds"
 *                   - "Pick your first portfolio"
 *                 category: Investments
 *                 tags: ["investing", "beginner"]
 *             sectionedBasic:
 *               summary: Simple sections (each has title + list)
 *               value:
 *                 question: "What investment options are available?"
 *                 answer:
 *                   equities:
 *                     title: "Stocks"
 *                     content:
 *                       - "Domestic stocks"
 *                       - "International stocks"
 *                   funds:
 *                     title: "Managed Products"
 *                     content:
 *                       - "Model Portfolios"
 *                       - "Index Strategies"
 *                 category: Investments
 *             mixedAdvanced:
 *               summary: Mixed free-form object (sections + intro)
 *               value:
 *                 question: "Explain platform fees"
 *                 answer:
 *                   intro: "We keep fees transparent."
 *                   management:
 *                     title: "Management Fee"
 *                     content:
 *                       - "Charged monthly"
 *                       - "Stops if portfolio inactive"
 *                   performance:
 *                     title: "Performance Fee"
 *                     content:
 *                       step1: "Applies only to premium plan"
 *                       step2: "Only after profit threshold"
 *                 category: Billing
 *                 tags: ["fees", "billing"]
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
  createFAQValidationRules,
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
 *   patch:
 *     summary: Partially update FAQ by ID
 *     description: |
 *       Send only the fields you want to change. Answer format rules are the same as creation.
 *       Non-technical hint: If you only want to change the tags, just send `{ "tags": ["new"] }`.
 *     tags: [FAQs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               question: { type: string }
 *               answer: { $ref: '#/components/schemas/FAQAnswer' }
 *               tags: { type: array, items: { type: string } }
 *               category: { type: string }
 *               relatedFAQs: { type: array, items: { type: string } }
 *           examples:
 *             updateQuestionOnly:
 *               summary: Only change the question text
 *               value:
 *                 question: "How do I change my password now?"
 *             switchToList:
 *               summary: Replace existing answer with a bullet list
 *               value:
 *                 answer:
 *                   - "Open settings"
 *                   - "Click Security"
 *                   - "Choose Change Password"
 *             listToSections:
 *               summary: Convert list answer into structured sections
 *               value:
 *                 answer:
 *                   basics:
 *                     title: "Basics"
 *                     content:
 *                       - "Choose strong password"
 *                       - "Enable 2FA"
 *                   recovery:
 *                     title: "Recovery"
 *                     content:
 *                       step1: "Add backup email"
 *                       step2: "Store codes safely"
 *             addTags:
 *               summary: Only update tags
 *               value:
 *                 tags: ["account", "security"]
 *     responses:
 *       200:
 *         description: Updated FAQ
 *       400:
 *         $ref: '#/components/responses/FAQValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/FAQNotFound'
 */
router.patch(
  '/:id',
  requireAdmin,
  patchFAQValidationRules,
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