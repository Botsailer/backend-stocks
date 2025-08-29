const axios = require("axios");
const DigioSign = require("../models/DigioSign");
const { getConfig } = require("../utils/configSettings");

/**
 * Helper: make HTTP requests to Digio with proper authentication and error handling.
 */
async function digioRequest(method, url, data = {}, headers = {}) {
  try {
    const DIGIO_CLIENT_ID = await getConfig("DIGIO_CLIENT_ID");
    const DIGIO_CLIENT_SECRET = await getConfig("DIGIO_CLIENT_SECRET");
    
    console.log(`[DIGIO] ${method.toUpperCase()} → ${url}`, JSON.stringify(data, null, 2));
    console.log(`[DIGIO] Using credentials - ID: ${DIGIO_CLIENT_ID?.substring(0, 5)}...`);
    
    // Validate credentials
    if (!DIGIO_CLIENT_ID || !DIGIO_CLIENT_SECRET) {
      throw new Error('Digio API credentials not found. Please check DIGIO_CLIENT_ID and DIGIO_CLIENT_SECRET environment variables.');
    }
    
    // Create Basic Auth header
    const basicAuth = Buffer.from(`${DIGIO_CLIENT_ID}:${DIGIO_CLIENT_SECRET}`).toString('base64');
    
    const config = {
      method,
      url,
      data: method.toLowerCase() !== 'get' ? data : undefined,
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...headers
      },
      timeout: 30000,
      validateStatus: function (status) {
        return status < 500;
      }
    };

    if (method.toLowerCase() === 'get' && Object.keys(data).length > 0) {
      config.params = data;
    }

    const response = await axios(config);
    console.log(`[DIGIO] Response Status: ${response.status}`, response.data);
    
    if (response.status >= 400) {
      throw new Error(`Digio API Error: ${response.status} - ${JSON.stringify(response.data)}`);
    }
    
    return response.data;
  } catch (error) {
    console.error(`[DIGIO] Request failed:`, {
      url,
      method,
      data,
      error: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    throw error;
  }
}

// Helper: ensure we have base64 PDF data (download from URL if needed)
async function resolvePdfBase64({ fileUrl, fileBase64 }) {
  if (fileBase64) {
    return fileBase64.replace(/^data:application\/pdf;base64,/, '');
  }
  if (!fileUrl) return null;
  try {
    const resp = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 30000 });
    return Buffer.from(resp.data).toString('base64');
  } catch (e) {
    console.error('[DIGIO] Failed to fetch file from URL for base64 conversion:', { fileUrl, error: e.message });
    return null;
  }
}

/**
 * Upload and create document for signing
 */
exports.uploadDocument = async (req, res) => {
  try {
    console.log('[uploadDocument] Request received:', {
      user: req.user,
      body: req.body,
      headers: req.headers.authorization
    });
    
    const userId = req.user?.id || req.user?._id;
    const { fileUrl, fileName, signerEmail, signerName, signerPhone, reason, fileBase64 } = req.body;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required - user not found"
      });
    }
    
    if ((!fileUrl && !fileBase64) || !signerEmail || !signerName) {
      return res.status(400).json({
        success: false,
        error: "fileUrl or fileBase64, signerEmail, and signerName are required"
      });
    }
    
    const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://ext-gateway.digio.in");

    const base64Data = await resolvePdfBase64({ fileUrl, fileBase64 });
    if (!base64Data) {
      return res.status(400).json({ success: false, error: 'Unable to read PDF content; provide valid fileUrl or fileBase64' });
    }
    
    const documentPayload = {
      file_data: base64Data,
      file_name: fileName || `Document-${Date.now()}.pdf`,
      signers: [{
        identifier: signerEmail,
        name: signerName,
        email: signerEmail,
        mobile: signerPhone || '',
        reason: reason || "Document Signature",
        sign_page: "all"
      }],
      expire_in_days: 7,
      send_sign_link: false,
      embedded_signing: true
    };
    
    console.log(`[DIGIO] API Base: ${DIGIO_API_BASE}`);
    console.log(`[DIGIO] Document payload:`, { ...documentPayload, file_data: `base64(${base64Data.length} bytes)` });
    
    const docResponse = await digioRequest(
      "post",
      `${DIGIO_API_BASE}/v2/client/document/uploadpdf`,
      documentPayload
    );
    
    // Create record
    const record = await DigioSign.create({
      userId,
      name: signerName,
      email: signerEmail,
      phone: signerPhone || '',
      idType: 'document',
      idNumber: docResponse?.id || 'pending',
      documentId: docResponse?.id || docResponse?.document_id,
      digioResponse: { create: docResponse },
      status: 'initiated'
    });
    
    return res.json({
      success: true,
      message: "Document uploaded and ready for signing",
      data: {
        sessionId: record._id.toString(),
        documentId: record.documentId,
        identifier: signerEmail,
        signUrl: docResponse?.sign_url
      }
    });
    
  } catch (err) {
    console.error("[uploadDocument] Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to upload document",
      message: err.message
    });
  }
};

/**
 * Create e-mandate document for signing (simplified for e-mandate use case)
 */
exports.createEMandate = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { name, email, phone, mandateAmount, bankAccount } = req.body;
    
    // Validation
    if (!userId) {
      return res.status(401).json({ 
        success: false,
        error: "Authentication required" 
      });
    }
    
    if (!name || !email || !phone || !mandateAmount) {
      return res.status(400).json({ 
        success: false,
        error: "name, email, phone, and mandateAmount are required" 
      });
    }
    
    // Validate mandate amount
    if (mandateAmount < 100 || mandateAmount > 50000) {
      return res.status(400).json({ 
        success: false,
        error: "Mandate amount must be between ₹100 and ₹50,000" 
      });
    }
    
    // Validate phone number
    if (!/^[0-9]{10}$/.test(phone)) {
      return res.status(400).json({ 
        success: false,
        error: "Phone number must be 10 digits" 
      });
    }
    
    // Check if user already has a pending/active e-mandate
    const existingMandate = await DigioSign.findOne({
      userId: userId,
      status: { $in: ['initiated', 'sent', 'viewed', 'signed', 'completed'] },
      idType: 'emandate'
    });
    
    if (existingMandate) {
      return res.status(409).json({ 
        success: false,
        error: "You already have an active e-mandate. Please complete or cancel it first.",
        existingMandate: {
          sessionId: existingMandate._id,
          status: existingMandate.status,
          createdAt: existingMandate.createdAt
        }
      });
    }

    const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://ext-gateway.digio.in");
    
    // Create record for tracking
    const record = await DigioSign.create({ 
      userId,
      name, 
      email, 
      phone, 
      idType: 'emandate',
      idNumber: bankAccount || 'pending',
      mandateAmount,
      kycVerified: false,
      status: 'initiated'
    });

    // Create document for signing with file upload (ensure file_data)
    const consentUrl = "https://s3.eu-north-1.amazonaws.com/rangaone.finance/DIgio_Documentation/aadhaar_esign_consent.pdf";
    const base64Data = await resolvePdfBase64({ fileUrl: consentUrl });
    if (!base64Data) {
      return res.status(500).json({ success: false, error: 'Failed to fetch consent PDF for e-mandate' });
    }

    const documentPayload = {
      file_data: base64Data,
      file_name: `E-Mandate-${name.replace(/\s+/g, '_')}-${Date.now()}.pdf`,
      signers: [{
        identifier: email,
        name: name,
        email: email,
        mobile: phone,
        reason: "E-Mandate Consent for Subscription",
        sign_page: "all"
      }],
      expire_in_days: 7,
      send_sign_link: false, // We'll use SDK
      embedded_signing: true
    };

    const docResponse = await digioRequest(
      "post",
      `${DIGIO_API_BASE}/v2/client/document/uploadpdf`,
      documentPayload
    );

    record.documentId = docResponse?.id || docResponse?.document_id;
    record.digioResponse = { create: docResponse };
    await record.save();

    return res.json({
      success: true,
      message: "E-mandate document created successfully",
      data: {
        sessionId: record._id.toString(),
        documentId: record.documentId,
        identifier: email
      }
    });
    
  } catch (err) {
    console.error("[createEMandate] Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to create e-mandate document",
      message: err.message
    });
  }
};

/**
 * Get signing status and update record
 */
exports.getStatus = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { documentId } = req.params;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }
    
    if (!documentId) {
      return res.status(400).json({
        success: false,
        error: "documentId is required"
      });
    }

    const record = await DigioSign.findOne({ 
      $or: [
        { _id: documentId },
        { documentId: documentId }
      ],
      userId: userId // Ensure user can only access their own documents
    });

    if (!record) {
      return res.status(404).json({
        success: false,
        error: "Document not found"
      });
    }

    const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://ext-gateway.digio.in");
    
    try {
      const statusData = await digioRequest(
        "get",
        `${DIGIO_API_BASE}/v2/client/document/${encodeURIComponent(record.documentId || documentId)}`
      );
      
      // Update record with latest status and signed URL if available
      const latestStatus = statusData?.status || statusData?.document_status;
      const possibleSignedUrl = statusData?.signed_document_url || statusData?.signed_file_url || statusData?.signed_pdf || statusData?.download_url;

      const updatedRecord = await DigioSign.findOneAndUpdate(
        { _id: record._id },
        { 
          status: latestStatus,
          ...(possibleSignedUrl ? { signedDocumentUrl: possibleSignedUrl } : {}),
          digioResponse: { ...record.digioResponse, status: statusData }
        },
        { new: true }
      );

      return res.json({
        success: true,
        documentId: record.documentId || documentId, 
        status: latestStatus,
        data: updatedRecord,
        raw: statusData 
      });
    } catch (error) {
      console.error("[getStatus] Status fetch failed:", error);
      return res.status(400).json({
        success: false,
        error: "Failed to fetch document status",
        details: error.message
      });
    }
  } catch (err) {
    console.error("[getStatus] Error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: err.message
    });
  }
};

/**
 * Webhook handler for Digio callbacks
 */
exports.webhook = async (req, res) => {
  try {
    console.log("[Digio Webhook] Received:", JSON.stringify(req.body, null, 2));
    
    const { document_id, id, status, event_type } = req.body;
    const docId = document_id || id;
    
    if (!docId) {
      console.error("[Digio Webhook] No document ID found in webhook data");
      return res.status(400).json({
        success: false,
        error: "document_id or id is required in webhook data"
      });
    }

    const updatedRecord = await DigioSign.findOneAndUpdate(
      { documentId: docId },
      { 
        status: status,
        webhookData: req.body,
        lastWebhookAt: new Date(),
        ...(status === 'signed' && { signedAt: new Date() }),
        ...(req.body.signed_document_url ? { signedDocumentUrl: req.body.signed_document_url } : {})
      },
      { new: true }
    );

    if (!updatedRecord) {
      console.warn(`[Digio Webhook] No record found for document ID: ${docId}`);
      return res.json({
        success: true,
        message: "Webhook received but no matching record found"
      });
    }

    console.log(`[Digio Webhook] Updated record ${updatedRecord._id} with status: ${status}`);
    
    return res.json({
      success: true,
      message: "Webhook processed successfully"
    });
  } catch (err) {
    console.error("[webhook] Error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: err.message
    });
  }
};

/**
 * Get user's e-mandate history
 */
exports.getUserEMandates = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { status, page = 1, limit = 10 } = req.query;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }
    
    // Build filter
    const filter = { userId, idType: 'emandate' };
    if (status) filter.status = status;
    
    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await DigioSign.countDocuments(filter);
    
    // Fetch documents
    const mandates = await DigioSign.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('-digioResponse -webhookData');
    
    return res.json({
      success: true,
      data: mandates,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    console.error("[getUserEMandates] Error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: err.message
    });
  }
};

/**
 * Cancel pending e-mandate
 */
exports.cancelEMandate = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { sessionId } = req.params;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }
    
    const mandate = await DigioSign.findOne({
      _id: sessionId,
      userId: userId,
      idType: 'emandate'
    });
    
    if (!mandate) {
      return res.status(404).json({
        success: false,
        error: "E-mandate not found"
      });
    }
    
    // Check if can be cancelled
    if (['signed', 'completed'].includes(mandate.status)) {
      return res.status(400).json({
        success: false,
        error: "Cannot cancel a signed e-mandate"
      });
    }
    
    if (['expired', 'declined', 'failed'].includes(mandate.status)) {
      return res.status(400).json({
        success: false,
        error: "E-mandate is already " + mandate.status
      });
    }
    
    // Update status to cancelled
    mandate.status = 'declined';
    mandate.lastError = 'Cancelled by user';
    await mandate.save();
    
    return res.json({
      success: true,
      message: "E-mandate cancelled successfully"
    });
  } catch (err) {
    console.error("[cancelEMandate] Error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: err.message
    });
  }
};

/**
 * Verify PAN details using Digio KYC API
 */
exports. verifyPAN = async (req, res) => {
  try {
    const { id_no, name, dob } = req.body;

    // 1. Input Validation
    if (!id_no || !name || !dob) {
      return res.status(400).json({
        code: 'MISSING_PARAMETERS',
        message: 'id_no, name, and dob are required.'
      });
    }

    const idNoUpper = id_no.toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(idNoUpper)) {
      return res.status(400).json({
        code: 'INVALID_PAN_FORMAT',
        message: 'The provided PAN number has an invalid format.'
      });
    }

    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dob)) {
      return res.status(400).json({
        code: 'INVALID_DOB_FORMAT',
        message: 'The date of birth format must be DD/MM/YYYY.'
      });
    }

    // 2. Get configuration
    const DIGIO_PAN_BASE_URL = await getConfig("DIGIO_API_BASE", "https://api.digio.in");
    const DIGIO_PAN_ENDPOINT = await getConfig("DIGIO_PAN_ENDPOINT", "/v3/client/kyc/fetch_id_data/PAN");

    // 3. Prepare request payload
    const payload = {
      id_no: idNoUpper,
      name,
      dob,
      unique_request_id: `REQ_${Date.now()}`
    };

    const fullApiUrl = `${DIGIO_PAN_BASE_URL}${DIGIO_PAN_ENDPOINT}`;
    console.log(`[PAN_VERIFY] Attempting to verify PAN at: ${fullApiUrl}`);

    // 4. Make API Call using existing helper
    const responseData = await digioRequest("post", fullApiUrl, payload, {
      timeout: 15000
    });

    
    return res.status(200).json({
      success: true,
      message: 'PAN details retrieved successfully.',
      data: responseData
    });

  } catch (error) {
    console.error('[PAN_VERIFY] Digio API Error:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });

    const status = error.response?.status || 500;
    const errorData = error.response?.data;

    // Specific handling for the "Not Configured" error
    if (status === 500 && errorData?.code === 'SYSTEM_ERROR' && errorData?.message === 'Credentials not configured for this Id') {
      return res.status(503).json({
        code: 'ACCOUNT_NOT_CONFIGURED',
        message: "Your Digio account is not enabled for this PAN verification service.",
        suggestion: "This is an account configuration issue, not a code issue. Please contact Digio support and ask them to enable the KRA/PAN service for your Client ID.",
        digio_transaction_id: errorData.details
      });
    }

    // Friendly message for common name mismatch
    const rawMessage = (errorData?.message || '').toString().toLowerCase();
    const looksLikeNameMismatch = ['name mismatch','name does not match','name not matching','mismatch in name']
      .some(s => rawMessage.includes(s));
    const friendlyMessage = looksLikeNameMismatch
      ? 'PAN and DOB look correct, but the name did not match. Please enter your full legal name exactly as on PAN, including middle name if any.'
      : (errorData?.message || 'An unexpected error occurred.');

    // Generic error handler for other issues
    return res.status(status).json({
      code: errorData?.code || (looksLikeNameMismatch ? 'NAME_MISMATCH' : 'API_REQUEST_FAILED'),
      message: friendlyMessage,
      details: errorData?.details || error.message
    });
  }
};

/**
 * eSign: Get current document and status for the user
 * - If signed, return signedDocumentUrl
 * - If not present, auto-create from configured PDF
 */
exports.getEsignDocument = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const DIGIO_API_BASE = await getConfig('DIGIO_API_BASE', 'https://ext-gateway.digio.in');
    const DEFAULT_PDF_URL = await getConfig('ESIGN_PDF_URL', 'https://s3.eu-north-1.amazonaws.com/rangaone.finance/DIgio_Documentation/aadhaar_esign_consent.pdf');

    // Find latest esign/document record
    let record = await DigioSign.findOne({ userId, idType: { $in: ['esign','document'] } }).sort({ createdAt: -1 });

    if (record && ['signed','completed'].includes(record.status) && record.signedDocumentUrl) {
      return res.json({ success: true, status: record.status, documentId: record.documentId, signedDocumentUrl: record.signedDocumentUrl });
    }

    if (!record) {
      // Create a new document for eSign
      const user = req.user;
      const fileName = `Consent-${(user.fullName || user.username || 'User').replace(/\s+/g,'_')}-${Date.now()}.pdf`;
      const payload = {
        file_url: DEFAULT_PDF_URL,
        file_name: fileName,
        signers: [{
          identifier: user.email,
          name: user.fullName || user.username || user.email,
          email: user.email,
          mobile: user.phone || '',
          reason: 'User eSign Consent',
          sign_page: 'all'
        }],
        expire_in_days: 7,
        send_sign_link: false,
        embedded_signing: true
      };
      const docResponse = await digioRequest('post', `${DIGIO_API_BASE}/v2/client/document/uploadpdf`, payload);
      record = await DigioSign.create({
        userId,
        name: user.fullName || user.username || user.email,
        email: user.email,
        phone: user.phone || '',
        idType: 'esign',
        idNumber: docResponse?.id || 'pending',
        documentId: docResponse?.id || docResponse?.document_id,
        digioResponse: { create: docResponse },
        status: 'initiated'
      });
    }

    // Return current status
    return res.json({ success: true, status: record.status, documentId: record.documentId });
  } catch (err) {
    console.error('[getEsignDocument] Error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch eSign document', message: err.message });
  }
};

/**
 * eSign: Initiate Aadhaar eSign (user provides last 4 digits)
 */
exports.initiateAadhaarEsign = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const { aadhaarSuffix, documentId } = req.body;
    if (!/^\d{4}$/.test(aadhaarSuffix || '')) return res.status(400).json({ success: false, error: 'aadhaarSuffix must be last 4 digits' });

    const DIGIO_API_BASE = await getConfig('DIGIO_API_BASE', 'https://ext.digio.in:444');
    const INIT_PATH = await getConfig('ESIGN_AADHAAR_INIT_PATH', '/v3/client/esign/aadhaar/init');

    const record = await DigioSign.findOne({ userId, documentId: documentId }).sort({ createdAt: -1 });
    if (!record) return res.status(404).json({ success: false, error: 'Document not found' });

    const payload = { document_id: record.documentId, identifier: aadhaarSuffix };
    const initResp = await digioRequest('post', `${DIGIO_API_BASE}${INIT_PATH}`, payload);

    // Persist minimal data
    await DigioSign.updateOne({ _id: record._id }, { $set: { digioResponse: { ...record.digioResponse, esignInit: initResp }, status: 'sent' } });

    return res.json({ success: true, message: 'Aadhaar eSign initiated', data: { transactionId: initResp?.txn_id || initResp?.transaction_id, documentId: record.documentId } });
  } catch (err) {
    console.error('[initiateAadhaarEsign] Error:', err);
    return res.status(400).json({ success: false, error: 'Failed to initiate Aadhaar eSign', message: err.message });
  }
};

/**
 * eSign: Submit OTP to complete signing
 */
exports.submitEsignOtp = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const { otp, documentId, transactionId } = req.body;
    if (!/^\d{6}$/.test(otp || '')) return res.status(400).json({ success: false, error: 'otp must be 6 digits' });

    const DIGIO_API_BASE = await getConfig('DIGIO_API_BASE', 'https://ext.digio.in:444');
    const VERIFY_PATH = await getConfig('ESIGN_AADHAAR_VERIFY_PATH', '/v3/client/esign/aadhaar/otp/verify');

    const record = await DigioSign.findOne({ userId, documentId: documentId });
    if (!record) return res.status(404).json({ success: false, error: 'Document not found' });

    const payload = { document_id: record.documentId, otp, txn_id: transactionId };
    const verifyResp = await digioRequest('post', `${DIGIO_API_BASE}${VERIFY_PATH}`, payload);

    const latestStatus = verifyResp?.status || 'signed';
    const possibleSignedUrl = verifyResp?.signed_document_url || verifyResp?.download_url || verifyResp?.signed_pdf;

    const updated = await DigioSign.findOneAndUpdate(
      { _id: record._id },
      { $set: { status: latestStatus, signedDocumentUrl: possibleSignedUrl, signedAt: new Date(), digioResponse: { ...record.digioResponse, esignVerify: verifyResp } } },
      { new: true }
    );

    return res.json({ success: true, message: 'Document signed successfully', data: { status: updated.status, signedDocumentUrl: updated.signedDocumentUrl } });
  } catch (err) {
    console.error('[submitEsignOtp] Error:', err);
    return res.status(400).json({ success: false, error: 'Failed to verify OTP', message: err.message });
  }
};

/**
 * Upload a PDF to Digio to create a reusable document (template-like)
 * Accepts either fileUrl or fileBase64. If base64, saves locally under public/uploads.
 * Returns the Digio documentId to be used in subsequent flows.
 */
exports.uploadTemplateDocument = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });

    const { fileUrl, fileBase64, fileName, signerEmail, signerName, signerPhone, reason } = req.body;

    let resolvedFileUrl = fileUrl;

    if (!resolvedFileUrl && fileBase64) {
      // Save base64 to local public/uploads and construct absolute URL
      const path = require('path');
      const fs = require('fs');

      const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const safeName = (fileName && fileName.endsWith('.pdf') ? fileName : `Document-${Date.now()}.pdf`).replace(/[^a-zA-Z0-9_.-]/g, '_');

      const base64Data = fileBase64.replace(/^data:application\/pdf;base64,/, '');
      const filePath = path.join(uploadsDir, safeName);
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

      const APP_BASE_URL = await getConfig('APP_BASE_URL');
      if (!APP_BASE_URL) {
        return res.status(500).json({ success: false, error: 'APP_BASE_URL not configured. Set it to your server base URL to serve uploaded files.' });
      }
      resolvedFileUrl = `${APP_BASE_URL.replace(/\/$/, '')}/uploads/${encodeURIComponent(safeName)}`;
    }

    if (!resolvedFileUrl) {
      return res.status(400).json({ success: false, error: 'Provide either fileUrl or fileBase64' });
    }

    const DIGIO_API_BASE = await getConfig('DIGIO_API_BASE', 'https://ext-gateway.digio.in');

    const base64Data = await resolvePdfBase64({ fileUrl: resolvedFileUrl });
    if (!base64Data) {
      return res.status(400).json({ success: false, error: 'Unable to read PDF content from provided fileUrl' });
    }

    const payload = {
      file_data: base64Data,
      file_name: fileName || `Document-${Date.now()}.pdf`,
      signers: [{
        identifier: signerEmail || req.user.email,
        name: signerName || req.user.fullName || req.user.username || req.user.email,
        email: signerEmail || req.user.email,
        mobile: signerPhone || req.user.phone || '',
        reason: reason || 'Document Signature',
        sign_page: 'all'
      }],
      expire_in_days: 30,
      send_sign_link: false,
      embedded_signing: true
    };

    const docResponse = await digioRequest('post', `${DIGIO_API_BASE}/v2/client/document/uploadpdf`, payload);

    // Store minimal record for reuse/reference
    const record = await DigioSign.create({
      userId,
      name: payload.signers[0].name,
      email: payload.signers[0].email,
      phone: payload.signers[0].mobile,
      idType: 'document',
      idNumber: docResponse?.id || 'pending',
      documentId: docResponse?.id || docResponse?.document_id,
      digioResponse: { create: docResponse },
      status: 'initiated'
    });

    return res.json({ success: true, message: 'Template document uploaded to Digio', data: { documentId: record.documentId, sessionId: record._id.toString() } });
  } catch (err) {
    console.error('[uploadTemplateDocument] Error:', err);
    return res.status(500).json({ success: false, error: 'Failed to upload template document', message: err.message });
  }
};