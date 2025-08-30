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
    
    if (!fileUrl && !fileBase64) {
      return res.status(400).json({
        success: false,
        error: "Either fileUrl or fileBase64 is required"
      });
    }
    
    if (!signerEmail || !signerName) {
      return res.status(400).json({
        success: false,
        error: "signerEmail and signerName are required"
      });
    }
    
    const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://ext-gateway.digio.in");
    
    // Resolve PDF base64 data
    const base64Data = await resolvePdfBase64({ fileUrl, fileBase64 });
    if (!base64Data) {
      return res.status(400).json({
        success: false,
        error: "Failed to process PDF file"
      });
    }
    
    // Create document for signing
    const documentPayload = {
      file_data: base64Data,
      file_name: fileName || `Document-${Date.now()}.pdf`,
      signers: [{
        identifier: signerEmail,
        name: signerName,
        email: signerEmail,
        mobile: signerPhone || '',
        reason: reason || "Document Signing",
        sign_page: "all"
      }],
      expire_in_days: 7,
      send_sign_link: false,
      embedded_signing: true
    };
    
    const documentResponse = await digioRequest('POST', `${DIGIO_API_BASE}/v2/document`, documentPayload);
    
    if (!documentResponse || !documentResponse.id) {
      throw new Error('Invalid document creation response from Digio');
    }
    
    // Save record to database
    const record = await DigioSign.create({
      userId,
      documentId: documentResponse.id,
      sessionId: documentResponse.id,
      name: signerName,
      email: signerEmail,
      phone: signerPhone,
      idType: 'document',
      status: 'initiated',
      digioResponse: documentResponse
    });
    
    res.json({
      success: true,
      message: "Document uploaded successfully",
      data: {
        sessionId: record._id,
        documentId: documentResponse.id,
        identifier: signerEmail,
        signUrl: documentResponse.sign_url
      }
    });
    
  } catch (error) {
    console.error('[uploadDocument] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to upload document"
    });
  }
};

/**
 * Verify PAN details using Digio KYC API
 */
exports.verifyPAN = async (req, res) => {
  try {
    const { id_no, name, dob } = req.body;
    
    // Validation
    if (!id_no || !name || !dob) {
      return res.status(400).json({
        success: false,
        error: "id_no, name, and dob are required"
      });
    }
    
    // Validate PAN format
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(id_no)) {
      return res.status(400).json({
        success: false,
        error: "Invalid PAN format. Expected format: ABCDE1234F"
      });
    }
    
    // Validate date format (DD/MM/YYYY)
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dob)) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Expected format: DD/MM/YYYY"
      });
    }
    
    const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://ext-gateway.digio.in");
    
    // Check if Digio is configured
    const DIGIO_CLIENT_ID = await getConfig("DIGIO_CLIENT_ID");
    const DIGIO_CLIENT_SECRET = await getConfig("DIGIO_CLIENT_SECRET");
    
    if (!DIGIO_CLIENT_ID || !DIGIO_CLIENT_SECRET) {
      return res.status(503).json({
        success: false,
        error: "Digio service not configured",
        code: "ACCOUNT_NOT_CONFIGURED",
        message: "PAN verification service is not available",
        suggestion: "Please contact support to enable this feature"
      });
    }
    
    // Call Digio PAN verification API
    const panData = {
      id_no: id_no,
      name: name,
      dob: dob
    };
    
    const response = await digioRequest('POST', `${DIGIO_API_BASE}/v2/pan`, panData);
    
    res.json({
      success: true,
      message: "PAN verification completed",
      data: response
    });
    
  } catch (error) {
    console.error('[verifyPAN] Error:', error);
    
    if (error.message.includes('BAD_REQUEST')) {
      return res.status(400).json({
        success: false,
        error: "Invalid PAN details provided",
        code: "INVALID_PAN_FORMAT",
        message: "The provided PAN number has an invalid format."
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message || "Failed to verify PAN"
    });
  }
};

/**
 * Get current eSign document status or create it if missing
 */
exports.getEsignDocument = async (req, res) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }
    
    // Find existing eSign document
    let esignDoc = await DigioSign.findOne({
      userId: userId,
      idType: 'esign'
    }).sort({ createdAt: -1 });
    
    if (!esignDoc) {
      // Create new eSign document
      const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://ext-gateway.digio.in");
      
      const documentPayload = {
        file_data: "base64_encoded_pdf_data", // Replace with actual PDF
        file_name: "eSign_Consent.pdf",
        signers: [{
          identifier: req.user.email,
          name: req.user.name || req.user.email,
          email: req.user.email,
          reason: "eSign Consent",
          sign_page: "all"
        }],
        expire_in_days: 7,
        send_sign_link: false,
        embedded_signing: true
      };
      
      const documentResponse = await digioRequest('POST', `${DIGIO_API_BASE}/v2/document`, documentPayload);
      
      esignDoc = await DigioSign.create({
        userId,
        documentId: documentResponse.id,
        sessionId: documentResponse.id,
        name: req.user.name || req.user.email,
        email: req.user.email,
        idType: 'esign',
        status: 'initiated',
        digioResponse: documentResponse
      });
    }
    
    res.json({
      success: true,
      data: {
        documentId: esignDoc.documentId,
        status: esignDoc.status,
        createdAt: esignDoc.createdAt
      }
    });
    
  } catch (error) {
    console.error('[getEsignDocument] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get eSign document"
    });
  }
};

/**
 * Initiate Aadhaar eSign using last 4 digits
 */
exports.initiateAadhaarEsign = async (req, res) => {
  try {
    const { documentId, aadhaarSuffix } = req.body;
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }
    
    if (!documentId || !aadhaarSuffix) {
      return res.status(400).json({
        success: false,
        error: "documentId and aadhaarSuffix are required"
      });
    }
    
    if (!/^[0-9]{4}$/.test(aadhaarSuffix)) {
      return res.status(400).json({
        success: false,
        error: "aadhaarSuffix must be 4 digits"
      });
    }
    
    const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://ext-gateway.digio.in");
    
    const esignPayload = {
      document_id: documentId,
      signer: {
        identifier: req.user.email,
        name: req.user.name || req.user.email,
        email: req.user.email
      },
      aadhaar_suffix: aadhaarSuffix
    };
    
    const response = await digioRequest('POST', `${DIGIO_API_BASE}/v2/esign/aadhaar/init`, esignPayload);
    
    res.json({
      success: true,
      message: "Aadhaar eSign initiated",
      data: response
    });
    
  } catch (error) {
    console.error('[initiateAadhaarEsign] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to initiate Aadhaar eSign"
    });
  }
};

/**
 * Submit OTP to complete Aadhaar eSign
 */
exports.submitEsignOtp = async (req, res) => {
  try {
    const { documentId, otp, transactionId } = req.body;
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }
    
    if (!documentId || !otp || !transactionId) {
      return res.status(400).json({
        success: false,
        error: "documentId, otp, and transactionId are required"
      });
    }
    
    if (!/^[0-9]{6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        error: "OTP must be 6 digits"
      });
    }
    
    const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://ext-gateway.digio.in");
    
    const otpPayload = {
      document_id: documentId,
      transaction_id: transactionId,
      otp: otp
    };
    
    const response = await digioRequest('POST', `${DIGIO_API_BASE}/v2/esign/aadhaar/otp`, otpPayload);
    
    // Update document status
    await DigioSign.findOneAndUpdate(
      { documentId: documentId },
      { status: 'signed', digioResponse: response }
    );
    
    res.json({
      success: true,
      message: "Aadhaar eSign completed",
      data: response
    });
    
  } catch (error) {
    console.error('[submitEsignOtp] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to submit OTP"
    });
  }
};

/**
 * Upload a PDF (URL or base64) to Digio and get documentId
 */
exports.uploadTemplateDocument = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { fileUrl, fileBase64, fileName, signerEmail, signerName, signerPhone, reason } = req.body;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }
    
    if (!fileUrl && !fileBase64) {
      return res.status(400).json({
        success: false,
        error: "Either fileUrl or fileBase64 is required"
      });
    }
    
    if (!signerEmail || !signerName) {
      return res.status(400).json({
        success: false,
        error: "signerEmail and signerName are required"
      });
    }
    
    const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://ext-gateway.digio.in");
    
    // Resolve PDF base64 data
    const base64Data = await resolvePdfBase64({ fileUrl, fileBase64 });
    if (!base64Data) {
      return res.status(400).json({
        success: false,
        error: "Failed to process PDF file"
      });
    }
    
    // Create document for signing
    const documentPayload = {
      file_data: base64Data,
      file_name: fileName || `Template-${Date.now()}.pdf`,
      signers: [{
        identifier: signerEmail,
        name: signerName,
        email: signerEmail,
        mobile: signerPhone || '',
        reason: reason || "Document Signing",
        sign_page: "all"
      }],
      expire_in_days: 7,
      send_sign_link: false,
      embedded_signing: true
    };
    
    const documentResponse = await digioRequest('POST', `${DIGIO_API_BASE}/v2/document`, documentPayload);
    
    if (!documentResponse || !documentResponse.id) {
      throw new Error('Invalid document creation response from Digio');
    }
    
    // Save record to database
    const record = await DigioSign.create({
      userId,
      documentId: documentResponse.id,
      sessionId: documentResponse.id,
      name: signerName,
      email: signerEmail,
      phone: signerPhone,
      idType: 'template',
      status: 'initiated',
      digioResponse: documentResponse
    });
    
    res.json({
      success: true,
      message: "Template document uploaded successfully",
      data: {
        sessionId: record._id,
        documentId: documentResponse.id,
        identifier: signerEmail,
        signUrl: documentResponse.sign_url
      }
    });
    
  } catch (error) {
    console.error('[uploadTemplateDocument] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to upload template document"
    });
  }
};