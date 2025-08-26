const express = require("express");
const {
  createEMandate,
  uploadDocument,
  getStatus,
  webhook,
  getUserEMandates,
  cancelEMandate
} = require("../controllers/digioController");
const DigioSign = require("../models/DigioSign");
const passport = require("passport");

const router = express.Router();
const requireAuth = passport.authenticate("jwt", { session: false });

/**
 * @swagger
 * components:
 *   schemas:
 *     EMandateRequest:
 *       type: object
 *       required:
 *         - name
 *         - email
 *         - phone
 *         - mandateAmount
 *       properties:
 *         name:
 *           type: string
 *           description: Full name of the account holder
 *           example: "John Doe"
 *         email:
 *           type: string
 *           format: email
 *           description: Email address
 *           example: "john@example.com"
 *         phone:
 *           type: string
 *           pattern: '^[0-9]{10}$'
 *           description: 10-digit mobile number
 *           example: "9999999999"
 *         mandateAmount:
 *           type: number
 *           minimum: 100
 *           maximum: 50000
 *           description: Maximum debit amount in INR
 *           example: 5000
 *         bankAccount:
 *           type: string
 *           description: Bank account number (optional)
 *           example: "1234567890"
 *         parentName:
 *           type: string
 *           description: Father's/Mother's name
 *           example: "Jane Doe"
 *         address:
 *           type: string
 *           description: Full address
 *           example: "123, Green Street, New Delhi, India"
 *         city:
 *           type: string
 *           description: City name
 *           example: "New Delhi"
 *         aadhaarSuffix:
 *           type: string
 *           pattern: '^[0-9]{4}$'
 *           description: Last 4 digits of Aadhaar
 *           example: "1234"
 * 
 *     EMandateResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         message:
 *           type: string
 *         data:
 *           type: object
 *           properties:
 *             sessionId:
 *               type: string
 *               description: Session ID for tracking
 *             documentId:
 *               type: string
 *               description: Digio document ID
 *             identifier:
 *               type: string
 *               description: Email identifier for signing
 * 
 *     EMandateStatus:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         documentId:
 *           type: string
 *         status:
 *           type: string
 *           enum: [initiated, sent, viewed, signed, completed, expired, declined, failed]
 *         data:
 *           type: object
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
 *   name: E-Mandate
 *   description: Digital e-mandate consent and signing APIs
 */

/**
 * @swagger
 * /digio/document/upload:
 *   post:
 *     summary: Upload PDF document for digital signing
 *     tags: [E-Mandate]
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
 * /digio/emandate/create:
 *   post:
 *     summary: Create e-mandate document for digital signing
 *     tags: [E-Mandate]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EMandateRequest'
 *     responses:
 *       200:
 *         description: E-mandate document created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EMandateResponse'
 *       400:
 *         description: Invalid input parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Server error
 */
router.post("/emandate/create", requireAuth, createEMandate);

/**
 * @swagger
 * /digio/emandate:
 *   get:
 *     summary: Get user's e-mandate history
 *     tags: [E-Mandate]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [initiated, sent, viewed, signed, completed, expired, declined, failed]
 *         description: Filter by status
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Records per page
 *     responses:
 *       200:
 *         description: E-mandate history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     pages:
 *                       type: integer
 *       401:
 *         description: Authentication required
 */
router.get("/emandate", requireAuth, getUserEMandates);

/**
 * @swagger
 * /digio/status/{documentId}:
 *   get:
 *     summary: Get e-mandate document status
 *     tags: [E-Mandate]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID or Session ID
 *         example: "64a1b2c3d4e5f6789012345"
 *     responses:
 *       200:
 *         description: Status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EMandateStatus'
 *       404:
 *         description: Document not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Authentication required
 */
router.get("/status/:documentId", requireAuth, getStatus);

/**
 * @swagger
 * /digio/emandate/{sessionId}/cancel:
 *   post:
 *     summary: Cancel pending e-mandate document
 *     tags: [E-Mandate]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID of the e-mandate
 *         example: "64a1b2c3d4e5f6789012345"
 *     responses:
 *       200:
 *         description: E-mandate cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Cannot cancel signed document
 *       404:
 *         description: Document not found
 *       401:
 *         description: Authentication required
 */
router.post("/emandate/:sessionId/cancel", requireAuth, cancelEMandate);

/**
 * @swagger
 * /digio/webhook:
 *   post:
 *     summary: Webhook endpoint for Digio status updates
 *     tags: [E-Mandate]
 *     description: Internal endpoint for receiving Digio webhook notifications
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               document_id:
 *                 type: string
 *               id:
 *                 type: string
 *               status:
 *                 type: string
 *               event_type:
 *                 type: string
 *               txn_id:
 *                 type: string
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
 *                 message:
 *                   type: string
 */
router.post("/webhook", webhook);

/**
 * @swagger
 * /digio/emandate/check:
 *   get:
 *     summary: Check if user has completed e-mandate
 *     tags: [E-Mandate]
 *     security:
 *       - bearerAuth: []
 *     description: Quick check for payment validation
 *     responses:
 *       200:
 *         description: E-mandate status check
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 hasValidEMandate:
 *                   type: boolean
 *                 latestMandate:
 *                   type: object
 *       401:
 *         description: Authentication required
 */
router.get("/emandate/check", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    
    const latestMandate = await DigioSign.findOne({
      userId: userId,
      idType: 'emandate'
    }).sort({ createdAt: -1 }).select('-digioResponse -webhookData');
    
    const hasValidEMandate = latestMandate && ['signed', 'completed'].includes(latestMandate.status);
    
    res.json({
      success: true,
      hasValidEMandate,
      latestMandate
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to check e-mandate status"
    });
  }
});

/**
 * @swagger
 * /digio/emandate/page:
 *   get:
 *     summary: Serve e-mandate signing page
 *     tags: [E-Mandate]
 *     description: Returns HTML page for e-mandate signing interface
 *     responses:
 *       200:
 *         description: E-mandate signing page
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 */
router.get("/emandate/page", (req, res) => {
  res.render('emandate', { title: 'E-Mandate Consent' });
});

module.exports = router;