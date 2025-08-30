const express = require("express");
const {
  uploadDocument,
  verifyPAN,
  getEsignDocument,
  initiateAadhaarEsign,
  submitEsignOtp,
  uploadTemplateDocument
} = require("../controllers/digioController");
const passport = require("passport");

const router = express.Router();
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
 *     ESIGNInitiateRequest:
 *       type: object
 *       required:
 *         - documentId
 *         - aadhaarSuffix
 *       properties:
 *         documentId:
 *           type: string
 *         aadhaarSuffix:
 *           type: string
 *           pattern: '^[0-9]{4}$'
 *
 *     ESIGNOtpVerifyRequest:
 *       type: object
 *       required:
 *         - documentId
 *         - otp
 *         - transactionId
 *       properties:
 *         documentId:
 *           type: string
 *         otp:
 *           type: string
 *           pattern: '^[0-9]{6}$'
 *         transactionId:
 *           type: string
 * 
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
 *   - name: eSign
 *     description: Aadhaar eSign endpoints
 *   - name: Document Signing
 *     description: Digital document signing services
 */

/** eSign endpoints */
/**
 * @swagger
 * /digio/esign/document:
 *   get:
 *     summary: Get current eSign document status or create it if missing
 *     tags: [eSign]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: eSign document status
 */
router.get('/esign/document', requireAuth, getEsignDocument);

/**
 * @swagger
 * /digio/esign/aadhaar/init:
 *   post:
 *     summary: Initiate Aadhaar eSign using last 4 digits
 *     tags: [eSign]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ESIGNInitiateRequest'
 *     responses:
 *       200:
 *         description: Initiated
 */
router.post('/esign/aadhaar/init', requireAuth, initiateAadhaarEsign);

/**
 * @swagger
 * /digio/esign/aadhaar/otp:
 *   post:
 *     summary: Submit OTP to complete Aadhaar eSign
 *     tags: [eSign]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ESIGNOtpVerifyRequest'
 *     responses:
 *       200:
 *         description: Signed
 */
router.post('/esign/aadhaar/otp', requireAuth, submitEsignOtp);

/**
 * @swagger
 * /digio/esign/template/upload:
 *   post:
 *     summary: Upload a PDF (URL or base64) to Digio and get documentId
 *     tags: [eSign]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fileUrl:
 *                 type: string
 *                 description: Public URL of PDF
 *               fileBase64:
 *                 type: string
 *                 description: Base64-encoded PDF (data:application/pdf;base64,...) if not using URL
 *               fileName:
 *                 type: string
 *               signerEmail:
 *                 type: string
 *               signerName:
 *                 type: string
 *               signerPhone:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Uploaded and created Digio document
 */
router.post('/esign/template/upload', requireAuth, uploadTemplateDocument);

/**
 * @swagger
 * /digio/document/upload:
 *   post:
 *     summary: Upload PDF document for digital signing
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
 *               - fileUrl
 *               - signerEmail
 *               - signerName
 *             properties:
 *               fileUrl:
 *                 type: string
 *                 format: uri
 *                 description: URL of the PDF document to be signed
 *                 example: "https://example.com/document.pdf"
 *               fileName:
 *                 type: string
 *                 description: Name for the document
 *                 example: "Agreement.pdf"
 *               signerEmail:
 *                 type: string
 *                 format: email
 *                 description: Email of the signer
 *                 example: "john@example.com"
 *               signerName:
 *                 type: string
 *                 description: Name of the signer
 *                 example: "John Doe"
 *               signerPhone:
 *                 type: string
 *                 description: Phone number of the signer
 *                 example: "9999999999"
 *               reason:
 *                 type: string
 *                 description: Reason for signing
 *                 example: "Agreement Signature"
 *     responses:
 *       200:
 *         description: Document uploaded successfully
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
 *                     sessionId:
 *                       type: string
 *                     documentId:
 *                       type: string
 *                     identifier:
 *                       type: string
 *                     signUrl:
 *                       type: string
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Authentication required
 */
router.post("/document/upload", requireAuth, uploadDocument);

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

module.exports = router;