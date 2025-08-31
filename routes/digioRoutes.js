const express = require("express");
const multer = require("multer");
const router = express.Router();

// Configure multer for PDF uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

const {
  verifyPAN,
  uploadPdfForSigning,
  refetchPdfFromUrl,
  getLatestPdfData,
  createDocumentForSigning
} = require("../controllers/digioController");
const passport = require("passport");

const requireAuth = (req, res, next) => {
  console.log('[Auth Middleware] Headers:', req.headers.authorization);
  passport.authenticate("jwt", { session: false }, (err, user, info) => {
    console.log('[Auth Middleware] Result:', { err, user: !!user, info });
    if (err) return next(err);
    if (!user) return res.status(401).json({ success: false, error: 'Unauthorized', info });
    req.user = user;
    next();
  })(req, res, next);
};

/**
 * @swagger
 * components:
 *   schemas:
 *     PANVerificationRequest:
 *       type: object
 *       required:
 *         - id_no
 *         - name
 *         - dob
 *       properties:
 *         id_no:
 *           type: string
 *           pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$'
 *           description: PAN number in uppercase
 *           example: "ABCDE1234F"
 *         name:
 *           type: string
 *           description: Full name as per PAN
 *           example: "John Doe"
 *         dob:
 *           type: string
 *           pattern: '^\d{2}\/\d{2}\/\d{4}$'
 *           description: Date of birth in DD/MM/YYYY format
 *           example: "15/08/1990"
 * 
 *     PANVerificationResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         message:
 *           type: string
 *         data:
 *           type: object
 *           description: PAN verification data from Digio API
 * 
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         error:
 *           type: string
 *         message:
 *           type: string
 */

/**
 * @swagger
 * tags:
 *   - name: KYC
 *     description: Know Your Customer verification services
 *   - name: PDF Operations
 *     description: PDF upload and management
 *   - name: Document Signing
 *     description: Digital document signing services
 */

/**
 * @swagger
 * /digio/pan/verify:
 *   post:
 *     summary: Verify PAN details using Digio KYC API
 *     tags: [KYC]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PANVerificationRequest'
 *     responses:
 *       200:
 *         description: PAN details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PANVerificationResponse'
 *       400:
 *         description: Invalid input parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: "INVALID_PAN_FORMAT"
 *                 message:
 *                   type: string
 *                   example: "The provided PAN number has an invalid format."
 *       401:
 *         description: Authentication required
 *       503:
 *         description: Service not configured
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: "ACCOUNT_NOT_CONFIGURED"
 *                 message:
 *                   type: string
 *                 suggestion:
 *                   type: string
 */
router.post("/pan/verify", requireAuth, verifyPAN);

/**
 * @swagger
 * /digio/pdf/upload:
 *   post:
 *     summary: Upload PDF file and convert to base64 for Digio signing
 *     tags: [PDF Operations]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: PDF file to upload
 *     responses:
 *       200:
 *         description: PDF uploaded and converted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     recordId:
 *                       type: string
 *                     fileName:
 *                       type: string
 *                     fileSize:
 *                       type: number
 *                     base64Length:
 *                       type: number
 *                     nextStep:
 *                       type: string
 *       400:
 *         description: Invalid file or no file provided
 *       401:
 *         description: Authentication required
 */
router.post('/pdf/upload', requireAuth, upload.single('file'), uploadPdfForSigning);

/**
 * @swagger
 * /digio/pdf/refetch:
 *   post:
 *     summary: Force refetch PDF from ESIGN_PDF_URL and convert to base64
 *     tags: [PDF Operations]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: PDF refetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     recordId:
 *                       type: string
 *                     fileName:
 *                       type: string
 *                     fileSize:
 *                       type: number
 *                     base64Length:
 *                       type: number
 *                     sourceUrl:
 *                       type: string
 *                     message:
 *                       type: string
 *       401:
 *         description: Authentication required
 *       503:
 *         description: PDF URL not configured
 */
router.post('/pdf/refetch', requireAuth, refetchPdfFromUrl);

/**
 * @swagger
 * /digio/pdf/data:
 *   get:
 *     summary: Get the latest PDF base64 data for the user
 *     tags: [PDF Operations]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: PDF data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     recordId:
 *                       type: string
 *                     fileName:
 *                       type: string
 *                     fileSize:
 *                       type: number
 *                     base64Length:
 *                       type: number
 *                     idType:
 *                       type: string
 *                     status:
 *                       type: string
 *                     createdAt:
 *                       type: string
 *                     base64Data:
 *                       type: string
 *       401:
 *         description: Authentication required
 *       404:
 *         description: No PDF data found
 */
router.get('/pdf/data', requireAuth, getLatestPdfData);

/**
 * @swagger
 * /digio/document/create:
 *   post:
 *     summary: Create document for signing using Digio API (Based on Postman collection)
 *     tags: [Document Signing]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signerEmail
 *               - signerName
 *             properties:
 *               signerEmail:
 *                 type: string
 *                 format: email
 *                 description: Email of the signer
 *                 example: "user@example.com"
 *               signerName:
 *                 type: string
 *                 description: Name of the signer
 *                 example: "John Doe"
 *               signerPhone:
 *                 type: string
 *                 description: Phone number of the signer (optional)
 *                 example: "1234567890"
 *               reason:
 *                 type: string
 *                 description: Reason for signing (optional)
 *                 example: "Document Agreement"
 *               expireInDays:
 *                 type: number
 *                 description: Number of days until document expires
 *                 example: 10
 *               displayOnPage:
 *                 type: string
 *                 description: Display preference
 *                 example: "Custom"
 *               notifySigners:
 *                 type: boolean
 *                 description: Whether to notify signers
 *                 example: true
 *               sendSignLink:
 *                 type: boolean
 *                 description: Whether to send sign link
 *                 example: true
 *     responses:
 *       200:
 *         description: Document created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     recordId:
 *                       type: string
 *                     documentId:
 *                       type: string
 *                     fileName:
 *                       type: string
 *                     signerEmail:
 *                       type: string
 *                     signerName:
 *                       type: string
 *                     signUrl:
 *                       type: string
 *                     expireInDays:
 *                       type: number
 *       400:
 *         description: Invalid input parameters
 *       401:
 *         description: Authentication required
 *       404:
 *         description: No PDF data found
 *       503:
 *         description: Digio API not configured
 */
router.post('/document/create', requireAuth, createDocumentForSigning);

module.exports = router;
