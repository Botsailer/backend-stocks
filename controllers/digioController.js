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

    console.log(`[DIGIO] Request config:`, {
      method: config.method,
      url: config.url,
      headers: config.headers,
      dataSize: config.data ? JSON.stringify(config.data).length : 0
    });

    const response = await axios(config);
    console.log(`[DIGIO] Response Status: ${response.status}`, response.data);
    
    if (response.status >= 400) {
      const errorMessage = response.data?.message || `HTTP ${response.status}`;
      const errorCode = response.data?.code || 'UNKNOWN_ERROR';
      const errorDetails = response.data?.details || '';
      
      console.error(`[DIGIO] API Error ${response.status}:`, {
        code: errorCode,
        message: errorMessage,
        details: errorDetails,
        fullResponse: response.data
      });
      
      // Create a more descriptive error
      const enhancedError = new Error(`Digio API Error: ${response.status} - ${JSON.stringify(response.data)}`);
      enhancedError.status = response.status;
      enhancedError.code = errorCode;
      enhancedError.details = errorDetails;
      enhancedError.response = response.data;
      
      throw enhancedError;
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

/**
 * PAN Verification (KEPT AS IS - NO CHANGES)
 */
exports.verifyPAN = async (req, res) => {
  try {
    const { id_no, name, dob } = req.body;
    
    // Validate required fields
    if (!id_no || !name || !dob) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_REQUIRED_FIELDS',
        message: 'Missing required fields: id_no, name, and dob are mandatory.',
        details: {
          id_no: !id_no ? 'PAN number is required' : null,
          name: !name ? 'Name is required' : null,
          dob: !dob ? 'Date of birth is required' : null
        }
      });
    }

    // Validate PAN format (5 letters, 4 digits, 1 letter)
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
    if (!panRegex.test(id_no)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PAN_FORMAT',
        message: 'The provided PAN number has an invalid format. Expected format: ABCDE1234F',
        details: 'PAN should contain 5 uppercase letters, followed by 4 digits, followed by 1 uppercase letter.'
      });
    }

    // Validate date format (DD/MM/YYYY)
    const dobRegex = /^\d{2}\/\d{2}\/\d{4}$/;
    if (!dobRegex.test(dob)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_DOB_FORMAT',
        message: 'The provided date of birth has an invalid format. Expected format: DD/MM/YYYY',
        example: '15/08/1990'
      });
    }

    console.log('[PAN Verification] Request:', { id_no, name, dob });

    // Get Digio configuration
    const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://ext.digio.in:444");
    
    // Prepare the request data
    const requestData = {
      id_no: id_no.toUpperCase(),
      name: name.trim(),
      dob: dob
    };

    console.log('[PAN Verification] Calling Digio API with:', requestData);

    // Call Digio PAN verification API
    const response = await digioRequest('POST', `${DIGIO_API_BASE}/v2/client/kyc/pan_verification`, requestData);

    console.log('[PAN Verification] Digio Response:', response);

    // Return success response
    res.json({
      success: true,
      message: 'PAN verification completed successfully.',
      data: response
    });

  } catch (error) {
    console.error('[PAN Verification] Error:', error);
    
    let errorResponse = {
      success: false,
      code: 'PAN_VERIFICATION_FAILED',
      message: 'PAN verification failed due to an unexpected error.',
      details: error.message
    };

    let statusCode = 500;

    // Handle specific error cases
    if (error.response && error.response.data) {
      const digioError = error.response.data;
      
      if (error.status === 400) {
        errorResponse = {
          success: false,
          code: digioError.code || 'INVALID_REQUEST',
          message: digioError.message || 'Invalid request parameters.',
          details: digioError.details || 'Please check your input data.'
        };
        statusCode = 400;
      } else if (error.status === 401 || error.status === 403) {
        errorResponse = {
          success: false,
          code: 'AUTHENTICATION_FAILED',
          message: 'Authentication with Digio API failed.',
          suggestion: 'Please check your API credentials and account configuration.'
        };
        statusCode = 503;
      } else if (error.status === 404) {
        errorResponse = {
          success: false,
          code: 'PAN_NOT_FOUND',
          message: 'PAN details not found or do not match the provided information.',
          details: 'Please verify the PAN number, name, and date of birth.'
        };
        statusCode = 404;
      }
    }

    // Check if credentials are missing
    if (error.message.includes('credentials not found')) {
      errorResponse = {
        success: false,
        code: 'ACCOUNT_NOT_CONFIGURED',
        message: 'Digio API credentials are not configured.',
        suggestion: 'Please configure DIGIO_CLIENT_ID and DIGIO_CLIENT_SECRET in your environment variables.'
      };
      statusCode = 503;
    }

    res.status(statusCode).json(errorResponse);
  }
};

/**
 * Upload PDF file and convert to base64 for Digio signing
 * This creates a reusable template - no signer details needed
 */
exports.uploadPdfForSigning = async (req, res) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }
    
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "PDF file is required"
      });
    }
    
    // Validate file type
    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({
        success: false,
        error: "Only PDF files are allowed"
      });
    }
    
    // Convert PDF to base64
    const pdfBuffer = req.file.buffer;
    const base64Data = pdfBuffer.toString('base64');
    
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `template_${userId}_${timestamp}.pdf`;
    
    // Delete existing records for this user (keep only latest template)
    await DigioSign.deleteMany({ userId });
    
    // Save to DigioSign collection - minimal data, just the template
    const record = await DigioSign.create({
      userId,
      documentId: null, // Will be set when document is created for signing
      sessionId: null,
      name: "Template", // Placeholder - real name provided during signing
      email: "template@placeholder.com", // Placeholder - real email provided during signing  
      phone: "0000000000", // Placeholder - real phone provided during signing
      idType: 'pdf_uploaded',
      idNumber: userId,
      status: 'template_uploaded',
      fileBase64: base64Data,
      fileName: fileName,
      fileSize: pdfBuffer.length,
      createdAt: new Date()
    });
    
    res.json({
      success: true,
      message: "PDF template uploaded and converted to base64 successfully",
      data: {
        recordId: record._id,
        fileName: fileName,
        fileSize: pdfBuffer.length,
        base64Length: base64Data.length,
        status: 'template_ready',
        nextStep: "Use /document/create endpoint with signer details to create document for signing"
      }
    });
    
  } catch (error) {
    console.error('[uploadPdfForSigning] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to upload PDF template"
    });
  }
};

/**
 * Force refetch PDF from ESIGN_PDF_URL and convert to base64
 * This creates a reusable template - no signer details needed
 */
exports.refetchPdfFromUrl = async (req, res) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }
    
    // Get PDF URL from config
    const pdfUrl = await getConfig("ESIGN_PDF_URL");
    if (!pdfUrl) {
      return res.status(503).json({
        success: false,
        error: "ESIGN_PDF_URL not configured",
        code: "URL_NOT_CONFIGURED"
      });
    }
    
    console.log(`[DIGIO] Fetching PDF from URL: ${pdfUrl}`);
    
    // Download PDF from URL
    const response = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DigioBot/1.0)'
      }
    });
    
    if (response.status !== 200) {
      throw new Error(`Failed to download PDF: HTTP ${response.status}`);
    }
    
    // Convert to base64
    const pdfBuffer = Buffer.from(response.data);
    const base64Data = pdfBuffer.toString('base64');
    
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `template_from_config_${userId}_${timestamp}.pdf`;
    
    // Delete ALL existing records for this user
    await DigioSign.deleteMany({ userId });
    
    // Create new record - minimal data, just the template
    const record = await DigioSign.create({
      userId,
      documentId: null,
      sessionId: null,
      name: "Template", // Placeholder
      email: "template@placeholder.com", // Placeholder
      phone: "0000000000", // Placeholder
      idType: 'pdf_refetched',
      idNumber: userId,
      status: 'template_refetched',
      fileBase64: base64Data,
      fileName: fileName,
      fileSize: pdfBuffer.length,
      sourceUrl: pdfUrl,
      createdAt: new Date()
    });
    
    res.json({
      success: true,
      message: "PDF template refetched and converted to base64 successfully",
      data: {
        recordId: record._id,
        fileName: fileName,
        fileSize: pdfBuffer.length,
        base64Length: base64Data.length,
        sourceUrl: pdfUrl,
        status: 'template_ready',
        message: "Template ready for document creation with signer details"
      }
    });
    
  } catch (error) {
    console.error('[refetchPdfFromUrl] Error:', error);
    
    let errorMessage = error.message || "Failed to refetch PDF template";
    let statusCode = 500;
    
    if (error.code === 'URL_NOT_CONFIGURED') {
      errorMessage = "PDF URL not configured. Please set ESIGN_PDF_URL in configuration.";
      statusCode = 503;
    } else if (error.response?.status === 404) {
      errorMessage = "PDF file not found at the configured URL.";
      statusCode = 404;
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      code: error.code || 'FETCH_FAILED'
    });
  }
};

/**
 * Get the latest PDF base64 data for the user
 */
exports.getLatestPdfData = async (req, res) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }
    
    // Find the latest record for this user
    const record = await DigioSign.findOne({ userId })
      .sort({ createdAt: -1 });
    
    if (!record) {
      return res.status(404).json({
        success: false,
        error: "No PDF data found for this user",
        code: "NO_PDF_DATA"
      });
    }
    
    if (!record.fileBase64) {
      return res.status(404).json({
        success: false,
        error: "PDF base64 data not found in record",
        code: "NO_BASE64_DATA"
      });
    }
    
    res.json({
      success: true,
      data: {
        recordId: record._id,
        fileName: record.fileName,
        fileSize: record.fileSize,
        base64Length: record.fileBase64.length,
        idType: record.idType,
        status: record.status,
        createdAt: record.createdAt,
        base64Data: record.fileBase64
      }
    });
    
  } catch (error) {
    console.error('[getLatestPdfData] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get PDF data"
    });
  }
};

/**
 * Create document for signing using stored PDF template + signer details
 */
exports.createDocumentForSigning = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { 
      signerEmail, 
      signerName, 
      signerPhone, 
      reason = "Document Signing",
      expireInDays = 10,
      displayOnPage = "All", // Note: Digio uses "All" not "Custom"
      notifySigners = true,
      sendSignLink = true
    } = req.body;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }
    
    if (!signerEmail || !signerName) {
      return res.status(400).json({
        success: false,
        error: "signerEmail and signerName are required for document creation"
      });
    }
    
    // Get the latest PDF template for this user
    const template = await DigioSign.findOne({ userId })
      .sort({ createdAt: -1 });
    
    if (!template || !template.fileBase64) {
      return res.status(404).json({
        success: false,
        error: "No PDF template found. Please upload a PDF first using /pdf/upload or /pdf/refetch endpoint.",
        code: "NO_PDF_TEMPLATE"
      });
    }
    
    // Get Digio configuration
    const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://ext.digio.in:444");
    
    // Prepare payload exactly as per Postman collection
    const documentPayload = {
      signers: [{
        identifier: signerEmail, // Use email as identifier
        name: signerName,
        sign_type: "aadhaar",
        reason: reason
      }],
      expire_in_days: expireInDays,
      display_on_page: displayOnPage,
      notify_signers: notifySigners,
      send_sign_link: sendSignLink,
      file_name: template.fileName,
      file_data: template.fileBase64
    };
    
    // If phone is provided, you can use it as identifier instead
    if (signerPhone) {
      documentPayload.signers[0].identifier = signerPhone;
    }
    
    console.log(`[DIGIO] Creating document for signing with payload:`, {
      fileName: template.fileName,
      signerEmail,
      signerName,
      signerPhone
    });
    
    // Call Digio API using the correct endpoint
    const response = await digioRequest('POST', `${DIGIO_API_BASE}/v2/client/document/uploadpdf`, documentPayload);
    
    if (!response || !response.id) {
      throw new Error('Invalid document creation response from Digio');
    }
    
    // Update template record with actual document details
    await DigioSign.findByIdAndUpdate(template._id, {
      documentId: response.id,
      sessionId: response.id,
      name: signerName,
      email: signerEmail,
      phone: signerPhone || "0000000000",
      status: 'document_created',
      digioResponse: response,
      updatedAt: new Date()
    });
    
    res.json({
      success: true,
      message: "Document created successfully for signing",
      data: {
        recordId: template._id,
        documentId: response.id,
        fileName: template.fileName,
        signerEmail: signerEmail,
        signerName: signerName,
        signerPhone: signerPhone,
        signUrl: response.sign_url || null,
        expireInDays: expireInDays,
        digioResponse: response
      }
    });
    
  } catch (error) {
    console.error('[createDocumentForSigning] Error:', error);
    
    let errorMessage = error.message || "Failed to create document for signing";
    let statusCode = 500;
    
    if (error.code === 'NO_PDF_TEMPLATE') {
      errorMessage = "No PDF template found. Please upload a PDF first.";
      statusCode = 404;
    } else if (error.message && error.message.includes('credentials not found')) {
      errorMessage = "Digio API credentials not configured properly.";
      statusCode = 503;
    } else if (error.response && error.response.status === 404) {
      errorMessage = "Digio API endpoint not found. Please check the API URL.";
      statusCode = 404;
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      code: error.code || 'CREATION_FAILED',
      details: error.response || error.details
    });
  }
};
