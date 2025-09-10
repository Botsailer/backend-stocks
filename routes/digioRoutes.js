const express = require("express");
const multer = require("multer");
const router = express.Router();
const requireAdmin = require("../middleware/requirreAdmin");

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
  createDocumentForSigning,
  verifyEsignForProduct,
  getStatus,
  webhook,
  syncDocument,
  syncAllPending,
  fetchUserSignedDocument
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
 *                 example: "all"
 *               notifySigners:
 *                 type: boolean
 *                 description: Whether to notify signers
 *                 example: true
 *               sendSignLink:
 *                 type: boolean
 *                 description: Whether to send sign link
 *                 example: true
 *               productType:
 *                 type: string
 *                 enum: [Portfolio, Bundle]
 *                 description: Optional product type to associate the eSign with
 *                 example: "Bundle"
 *               productId:
 *                 type: string
 *                 format: objectid
 *                 description: Optional product ID to associate the eSign with
 *                 example: "68c1c39321ad3a7f1f7e1be2"
 *               productName:
 *                 type: string
 *                 description: Optional product name (for convenience)
 *                 example: "Growth Bundle"
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
 *                     signerPhone:
 *                       type: string
 *                     status:
 *                       type: string
 *                       example: "document_created"
 *                     reason:
 *                       type: string
 *                     authenticationUrl:
 *                       type: string
 *                       description: URL for signer to complete eSign process
 *                     signUrl:
 *                       type: string
 *                     expireInDays:
 *                       type: number
 *                     productType:
 *                       type: string
 *                       enum: [Portfolio, Bundle]
 *                     productId:
 *                       type: string
 *                     productName:
 *                       type: string
 *                     pdfSource:
 *                       type: string
 *                       enum: [auto_fetched, existing_template]
 *                       description: Source of the PDF used for signing
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

/**
 * @swagger
 * /digio/esign/verify:
 *   get:
 *     summary: Verify eSign status for a specific product (JIT sync)
 *     tags: [Document Signing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: productType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [Portfolio, Bundle]
 *         description: Product type to check eSign status for
 *         example: "Bundle"
 *       - in: query
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *           format: objectid
 *         description: Product ID to check eSign status for
 *         example: "68c1c39321ad3a7f1f7e1be2"
 *     responses:
 *       200:
 *         description: eSign status fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   description: True if document is signed or completed
 *                 status:
 *                   type: string
 *                   enum: [initiated, sent, viewed, signed, completed, expired, declined, failed]
 *                   description: Current status of the eSign document
 *                 documentId:
 *                   type: string
 *                   description: Digio document ID
 *                 authenticationUrl:
 *                   type: string
 *                   description: URL for completing eSign process (only present when not signed)
 *                 signUrl:
 *                   type: string
 *                   description: Direct signing URL (if available)
 *       400:
 *         description: Missing required productType/productId parameters
 *       401:
 *         description: Authentication required
 *       404:
 *         description: No eSign document found for user/product
 *       500:
 *         description: Server error
 */
router.get('/esign/verify', requireAuth, verifyEsignForProduct);

/**
 * @swagger
 * /digio/status/{sessionId}:
 *   get:
 *     summary: Get Digio document status by sessionId or documentId
 *     tags: [Document Signing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID or Document ID from Digio
 *         example: "doc_123456789"
 *     responses:
 *       200:
 *         description: Document status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     record:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                         userId:
 *                           type: string
 *                         documentId:
 *                           type: string
 *                         sessionId:
 *                           type: string
 *                         status:
 *                           type: string
 *                           enum: ["initiated", "sent", "viewed", "signed", "completed", "expired", "declined", "failed"]
 *                         signedAt:
 *                           type: string
 *                           format: date-time
 *                         signedDocumentUrl:
 *                           type: string
 *                     remote:
 *                       type: object
 *                       description: Latest status from Digio API
 *                     remoteError:
 *                       type: string
 *                       description: Error message if remote API call failed
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Document not found
 */
router.get('/status/:sessionId', requireAuth, getStatus);

/**
 * @swagger
 * /digio/webhook:
 *   post:
 *     summary: Webhook endpoint for Digio notifications
 *     tags: [Document Signing]
 *     description: |
 *       This endpoint receives webhook notifications from Digio when document status changes.
 *       Configure this URL in your Digio dashboard: https://your-domain.com/digio/webhook
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               event:
 *                 type: string
 *                 enum: ["document.sent", "document.viewed", "document.signed", "document.completed", "document.expired", "document.declined", "document.failed"]
 *                 example: "document.signed"
 *               document_id:
 *                 type: string
 *                 example: "doc_123456789"
 *               session_id:
 *                 type: string
 *                 example: "doc_123456789"
 *               status:
 *                 type: string
 *                 example: "signed"
 *               signer_details:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   email:
 *                     type: string
 *                   phone:
 *                     type: string
 *               signed_document_url:
 *                 type: string
 *               timestamp:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Webhook processed successfully"
 *                 recordId:
 *                   type: string
 *                 previousStatus:
 *                   type: string
 *                 newStatus:
 *                   type: string
 *                 event:
 *                   type: string
 */
router.post('/webhook', webhook);

/**
 * @swagger
 * /digio/sync/{documentId}:
 *   post:
 *     summary: Manually sync specific document status
 *     tags: [Document Signing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID to sync
 *         example: "doc_123456789"
 *     responses:
 *       200:
 *         description: Document synced successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 document:
 *                   type: object
 *                   description: Updated document record
 *                 oldStatus:
 *                   type: string
 *                 newStatus:
 *                   type: string
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Document not found
 *       500:
 *         description: Sync failed
 */
router.post('/sync/:documentId', requireAuth, syncDocument);

/**
 * @swagger
 * /digio/sync-all:
 *   post:
 *     summary: Manually sync all pending documents
 *     tags: [Document Signing]
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       Manually trigger the cron job to sync all pending documents.
 *       This endpoint is useful for testing or when you need immediate status updates.
 *     responses:
 *       200:
 *         description: Sync completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Document sync completed"
 *                 processed:
 *                   type: number
 *                   description: Number of documents processed
 *                 updated:
 *                   type: number
 *                   description: Number of documents updated
 *                 errors:
 *                   type: number
 *                   description: Number of errors encountered
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Sync failed
 */
router.post('/sync-all', requireAuth, syncAllPending);

/**
 * @swagger
 * /api/digio/admin/user/{userId}/document:
 *   get:
 *     tags: [Digio]
 *     summary: Admin endpoint to fetch a user's signed document
 *     description: |
 *       Admin-only endpoint to fetch a user's signed document from Digio.
 *       Note: This incurs a cost per document fetch, use judiciously.
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the user whose document to fetch
 *       - in: query
 *         name: documentId
 *         schema:
 *           type: string
 *         description: Optional. Specific document ID to fetch. If not provided, fetches the latest signed document.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Returns the signed PDF document
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Invalid request parameters
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Not an admin
 *       404:
 *         description: User or document not found
 *       500:
 *         description: Server error or Digio API error
 */
router.get('/admin/user/:userId/document', requireAdmin, fetchUserSignedDocument);

module.exports = router;
