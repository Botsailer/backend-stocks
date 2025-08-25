const express = require("express");
const {
  startKyc,
  verifyAadhaarKyc,
  confirmKycAndESign,
  getStatus,
  webhook,
  listAll,
  getRecord
} = require("../controllers/digioController");
const requireAdmin = require("../middleware/requirreAdmin");

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     KYCStartRequest:
 *       type: object
 *       required:
 *         - name
 *         - email
 *         - phone
 *         - idType
 *         - idNumber
 *       properties:
 *         name:
 *           type: string
 *           description: Full name of the person
 *           example: "John Doe"
 *         email:
 *           type: string
 *           format: email
 *           description: Email address
 *           example: "john@example.com"
 *         phone:
 *           type: string
 *           description: Mobile number (10 digits)
 *           example: "9999999999"
 *         idType:
 *           type: string
 *           enum: [aadhaar, pan]
 *           description: Type of ID verification
 *           example: "aadhaar"
 *         idNumber:
 *           type: string
 *           description: Aadhaar number (12 digits) or PAN (ABCDE1234F format)
 *           example: "123412341234"
 * 
 *     KYCStartResponse:
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
 *             reference_id:
 *               type: string
 * 
 *     OTPVerifyRequest:
 *       type: object
 *       required:
 *         - sessionId
 *         - otp
 *       properties:
 *         sessionId:
 *           type: string
 *           description: Session ID received from KYC start
 *           example: "68ab0f75b3beb3f49ccfefaa"
 *         otp:
 *           type: string
 *           description: 6-digit OTP received on Aadhaar registered mobile
 *           example: "123456"
 * 
 *     ESignRequest:
 *       type: object
 *       required:
 *         - fileUrl
 *       properties:
 *         fileUrl:
 *           type: string
 *           format: uri
 *           description: URL of the PDF document to be signed
 *           example: "https://example.com/mydoc.pdf"
 *         documentTitle:
 *           type: string
 *           description: Title of the document
 *           example: "Service Agreement"
 *         reason:
 *           type: string
 *           description: Reason for signing
 *           example: "Agreement Signature"
 * 
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         error:
 *           type: string
 *           description: Error message
 *         details:
 *           type: string
 *           description: Additional error details
 */

/**
 * @swagger
 * tags:
 *   name: Digio eSign & KYC
 *   description: Complete KYC and eSign workflow with Aadhaar/PAN verification
 */

/**
 * @swagger
 * /digio/kyc/start:
 *   post:
 *     summary: Initiate KYC process (Aadhaar OTP or PAN verification)
 *     tags: [Digio eSign & KYC]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/KYCStartRequest'
 *           examples:
 *             aadhaar:
 *               summary: Aadhaar KYC
 *               value:
 *                 name: "John Doe"
 *                 email: "john@example.com"
 *                 phone: "9999999999"
 *                 idType: "aadhaar"
 *                 idNumber: "123412341234"
 *             pan:
 *               summary: PAN KYC
 *               value:
 *                 name: "John Doe"
 *                 email: "john@example.com"
 *                 phone: "9999999999"
 *                 idType: "pan"
 *                 idNumber: "ABCDE1234F"
 *     responses:
 *       200:
 *         description: KYC initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/KYCStartResponse'
 *       400:
 *         description: Invalid input or verification failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 */
router.post("/kyc/start", startKyc);

/**
 * @swagger
 * /digio/kyc/verify:
 *   post:
 *     summary: Verify Aadhaar OTP to complete KYC
 *     tags: [Digio eSign & KYC]
 *     description: Complete Aadhaar KYC by providing the OTP received on registered mobile number
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OTPVerifyRequest'
 *     responses:
 *       200:
 *         description: Aadhaar KYC completed successfully
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
 *       400:
 *         description: Invalid OTP or session
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Session not found
 */
router.post("/kyc/verify", verifyAadhaarKyc);

/**
 * @swagger
 * /digio/esign/{documentId}:
 *   post:
 *     summary: Initiate eSign process after successful KYC
 *     tags: [Digio eSign & KYC]
 *     description: Upload a PDF document for digital signing after KYC verification
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID from KYC process
 *         example: "68ab0f75b3beb3f49ccfefaa"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ESignRequest'
 *     responses:
 *       201:
 *         description: eSign request created successfully
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
 *                     sign_url:
 *                       type: string
 *                       description: URL for signing the document
 *       400:
 *         description: KYC not verified or invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Record not found
 */
router.post("/esign/:documentId", confirmKycAndESign);

/**
 * @swagger
 * /digio/status/{documentId}:
 *   get:
 *     summary: Get current status of eSign document
 *     tags: [Digio eSign & KYC]
 *     description: Check the current status of a document in the signing process
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID or Session ID
 *         example: "68ab0f75b3beb3f49ccfefaa"
 *     responses:
 *       200:
 *         description: Status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 documentId:
 *                   type: string
 *                 status:
 *                   type: string
 *                   description: Current document status
 *                   enum: [initiated, sent, viewed, signed, completed, expired, declined]
 *                 data:
 *                   type: object
 *                 raw:
 *                   type: object
 *                   description: Raw response from Digio API
 *       404:
 *         description: Document not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/status/:documentId", getStatus);

/**
 * @swagger
 * /digio/record/{recordId}:
 *   get:
 *     summary: Get detailed information about a specific record
 *     tags: [Digio eSign & KYC]
 *     description: Retrieve complete details of a KYC/eSign record
 *     parameters:
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *         description: Record ID
 *         example: "68ab0f75b3beb3f49ccfefaa"
 *     responses:
 *       200:
 *         description: Record details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       404:
 *         description: Record not found
 */
router.get("/record/:recordId", getRecord);

/**
 * @swagger
 * /digio/webhook:
 *   post:
 *     summary: Webhook endpoint for Digio status updates
 *     tags: [Digio eSign & KYC]
 *     description: Endpoint to receive automatic status updates from Digio when document status changes
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
 * /digio:
 *   get:
 *     summary: List all Digio records (Admin only)
 *     tags: [Digio eSign & KYC]
 *     description: Get paginated list of all KYC/eSign records with optional filtering
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by document status
 *         example: "completed"
 *       - in: query
 *         name: idType
 *         schema:
 *           type: string
 *           enum: [aadhaar, pan]
 *         description: Filter by ID type
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Number of records per page
 *     responses:
 *       200:
 *         description: Records retrieved successfully
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
 *         description: Unauthorized - Admin access required
 */
router.get("/", requireAdmin, listAll);

module.exports = router;