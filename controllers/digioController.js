const axios = require("axios");
const DigioSign = require("../models/DigioSign");
const User = require("../models/user");
const { getConfig } = require("../utils/configSettings");
const { processWebhook, validateWebhookSignature, syncPendingDocuments, syncDocument } = require("../services/digioWebhookService");
const pdfFormFiller = require("../services/pdfFormFiller");

/**
 * Admin controller to fetch a user's signed document from Digio
 * Note: This endpoint requires admin privileges and costs money per document fetch
 */
exports.fetchUserSignedDocument = async (req, res) => {
  const { userId } = req.params;
  const { documentId } = req.query;

  try {
    const logger = req.app.get('logger') || console;
    
    // Input validation
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId is required"
      });
    }

    // Find the signing record
    let signingRecord;
    try {
      if (documentId) {
        // If documentId provided, fetch that specific record
        signingRecord = await DigioSign.findOne({
          userId,
          documentId,
          isTemplate: false,
          status: { $in: ['signed', 'completed'] }
        }).sort({ signedAt: -1 });
      } else {
        // Otherwise get the latest signed document for this user
        signingRecord = await DigioSign.findOne({
          userId,
          isTemplate: false,
          status: { $in: ['signed', 'completed'] }
        }).sort({ signedAt: -1 });
      }

      if (!signingRecord) {
        return res.status(404).json({
          success: false,
          error: documentId 
            ? `No signed document found with ID ${documentId} for user ${userId}` 
            : `No signed documents found for user ${userId}`
        });
      }
    } catch (dbError) {
      logger.error('Database error fetching signing record:', {
        error: dbError.message,
        userId,
        documentId
      });
      return res.status(500).json({
        success: false,
        error: "Failed to fetch signing record"
      });
    }

    // Get Digio credentials
    const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://ext.digio.in:444");
    const DIGIO_CLIENT_ID = await getConfig("DIGIO_CLIENT_ID");
    const DIGIO_CLIENT_SECRET = await getConfig("DIGIO_CLIENT_SECRET");

    if (!DIGIO_CLIENT_ID || !DIGIO_CLIENT_SECRET) {
      logger.error('Missing Digio credentials');
      return res.status(500).json({
        success: false,
        error: "Digio configuration error"
      });
    }

    // Create Basic auth token
    const authToken = Buffer.from(`${DIGIO_CLIENT_ID}:${DIGIO_CLIENT_SECRET}`).toString('base64');

    try {
      // Make request to Digio
      const response = await axios({
        method: 'GET',
        url: `${DIGIO_API_BASE}/v2/client/document/download/${signingRecord.documentId}`,
        headers: {
          'Authorization': `Basic ${authToken}`,
          'Accept': 'application/pdf'
        },
        responseType: 'arraybuffer'
      });

      // Set appropriate headers
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${signingRecord.fileName || 'signed-document.pdf'}"`);
      
      // Send the PDF
      res.send(response.data);

      // Log successful fetch
      logger.info('Admin fetched signed document', {
        adminId: req.user._id,
        userId,
        documentId: signingRecord.documentId,
        size: response.data.length
      });

    } catch (apiError) {
      logger.error('Error fetching from Digio API:', {
        error: apiError.message,
        documentId: signingRecord.documentId,
        response: apiError.response?.data 
          ? Buffer.from(apiError.response.data).toString()
          : undefined
      });
      
      // Check for specific error cases
      if (apiError.response?.status === 404) {
        return res.status(404).json({
          success: false,
          error: "Document not found in Digio"
        });
      } else if (apiError.response?.status === 401 || apiError.response?.status === 403) {
        return res.status(500).json({
          success: false,
          error: "Authentication failed with Digio API"
        });
      }

      return res.status(500).json({
        success: false,
        error: "Failed to download document from Digio"
      });
    }

  } catch (error) {
    const logger = req.app.get('logger') || console;
    logger.error('Unexpected error in fetchUserSignedDocument:', {
      error: error.message,
      stack: error.stack,
      userId,
      documentId
    });
    
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
};

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
 * PAN Verification (MODIFIED LOGIC)
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
    const response = await digioRequest('POST', `${DIGIO_API_BASE}/v3/client/kyc/fetch_id_data/PAN`, requestData);

    console.log('[PAN Verification] Digio Response:', response);

    // Custom logic for success/failure
    const nameMatch = response.name_as_per_pan_match === true;
    const dobMatch = response.date_of_birth_match === true;

    if (nameMatch && dobMatch) {
      return res.json({
        success: true,
        message: 'PAN verification completed successfully.',
        data: response
      });
    } else if (!nameMatch && dobMatch) {
      return res.json({
        success: false,
        code: 'NAME_MISMATCH',
        message: 'Please enter your full name including middle name as per your PAN card.',
        data: response
      });
    } else {
      return res.json({
        success: false,
        code: 'DETAILS_MISMATCH',
        message: 'Name and date of birth do not match PAN records.',
        data: response
      });
    }

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
    
    // Delete existing PDF templates for this user (keep only latest template)
    await DigioSign.deleteMany({ userId, isTemplate: true });
    
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
      isTemplate: true, // Mark as template
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
    
    // Delete existing PDF templates for this user (keep only latest template)
    await DigioSign.deleteMany({ userId, isTemplate: true });
    
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
      isTemplate: true, // Mark as template
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
    let template = await DigioSign.findOne({ userId, isTemplate: true })
      .sort({ createdAt: -1 });
    
    // If no template exists, fetch PDF from ESIGN_PDF_URL automatically
    if (!template) {
      console.log('[DIGIO] No PDF template found, fetching from ESIGN_PDF_URL...');
      
      try {
        // Get PDF URL from config
        const pdfUrl = await getConfig("ESIGN_PDF_URL");
        if (!pdfUrl) {
          return res.status(503).json({
            success: false,
            error: "ESIGN_PDF_URL not configured. Please set ESIGN_PDF_URL in your environment variables.",
            code: "URL_NOT_CONFIGURED"
          });
        }
        
        console.log(`[DIGIO] Fetching PDF from URL: ${pdfUrl}`);
        
        // Download PDF from URL
        const pdfResponse = await axios.get(pdfUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; DigioBot/1.0)'
          }
        });
        
        if (pdfResponse.status !== 200) {
          throw new Error(`Failed to download PDF: HTTP ${pdfResponse.status}`);
        }
        
        // Convert to base64
        const pdfBuffer = Buffer.from(pdfResponse.data);
        const base64Data = pdfBuffer.toString('base64');
        
        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `template_auto_${userId}_${timestamp}.pdf`;
        
        // Fetch user's phone number for template
        const user = await User.findById(userId);
        if (!user || !user.phone) {
          throw new Error('User phone number not found. Cannot create template without phone number.');
        }
        
        // Create new template record
        template = await DigioSign.create({
          userId,
          documentId: null,
          sessionId: null,
          name: "Auto-generated Template",
          email: user.email || "system@rangaone.finance",
          phone: user.phone, // Use real phone number from user
          idType: 'pdf_auto_fetched',
          idNumber: userId.toString(),
          status: 'template_ready',
          fileBase64: base64Data,
          fileName: fileName,
          fileSize: pdfBuffer.length,
          sourceUrl: pdfUrl,
          isTemplate: true,
          createdAt: new Date()
        });
        
        console.log('[DIGIO] Auto-created PDF template:', template._id);
        
      } catch (fetchError) {
        console.error('[DIGIO] Failed to auto-fetch PDF:', fetchError);
        return res.status(503).json({
          success: false,
          error: "No PDF template found and unable to fetch from ESIGN_PDF_URL automatically.",
          code: "AUTO_FETCH_FAILED",
          details: fetchError.message
        });
      }
    }
    
    // Validate template has PDF data
    if (!template || !template.fileBase64) {
      return res.status(404).json({
        success: false,
        error: "PDF template found but missing base64 data. Please try again or upload a PDF manually.",
        code: "INVALID_TEMPLATE_DATA"
      });
    }
    
    // Get Digio configuration
    const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://ext.digio.in:444");
    
    // 🚀 PERSONALIZE PDF WITH USER DATA
    let personalizedPdfBase64 = template.fileBase64;
    let personalizedFileName = template.fileName;
    
    try {
      console.log('[DIGIO] Personalizing PDF with user data...');
      
      // Get full user data for PDF personalization
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: "User not found for PDF personalization"
        });
      }
      
      // Convert base64 to buffer for processing
      const templateBuffer = Buffer.from(template.fileBase64, 'base64');
      
      // Fill PDF form with user data
      const personalizedPdfBuffer = await pdfFormFiller.fillPdfForm(templateBuffer, user);
      
      // Convert back to base64
      personalizedPdfBase64 = personalizedPdfBuffer.toString('base64');
      
      // Update filename to indicate personalization
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      personalizedFileName = `personalized_${user.username || user._id}_${timestamp}.pdf`;
      
      console.log('[DIGIO] PDF personalized successfully', {
        userId: user._id,
        userName: user.fullName || user.username,
        originalSize: templateBuffer.length,
        personalizedSize: personalizedPdfBuffer.length
      });
      
    } catch (personalizationError) {
      console.warn('[DIGIO] PDF personalization failed, using original template:', personalizationError.message);
      // Continue with original template if personalization fails
    }
    
    // Prepare payload exactly as per Postman collection
    const documentPayload = {
      signers: [{
        identifier: signerEmail, 
        name: signerName,
        sign_type: "aadhaar",
        reason: reason
      }],
      expire_in_days: expireInDays,
      display_on_page: displayOnPage,
      notify_signers: notifySigners,
      generate_access_token: true,
      include_authentication_url: true,
      customer_notification_mode:"all",
      send_sign_link: sendSignLink,
      file_name: personalizedFileName,
      file_data: personalizedPdfBase64
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
    
    // Create a new DigioSign record for this signing document (don't modify template)
    const signingRecord = await DigioSign.create({
      userId,
      documentId: response.id,
      sessionId: response.id,
      name: signerName,
      email: signerEmail,
      phone: signerPhone || "0000000000",
      idType: 'document_signing',
      idNumber: signerEmail, // Use signer email as identifier
      status: 'document_created',
      digioResponse: response,
      isTemplate: false, // This is a signing document, not a template
      // optional product reference for per-product eSign tracking
      productType: req.body.productType || req.query.productType || null,
      productId: req.body.productId || req.query.productId || null,
      productName: req.body.productName || req.query.productName || null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    res.json({
      success: true,
      message: template.sourceUrl ? "Document created successfully for signing (PDF auto-fetched)" : "Document created successfully for signing",
      data: {
        recordId: signingRecord._id,
        documentId: response.id,
        fileName: template.fileName,
        signerEmail: signerEmail,
        signerName: signerName,
        signerPhone: signerPhone,
        status: 'document_created',
        reason: reason,
        authenticationUrl: response.authentication_url || null,
        signUrl: response.sign_url || null,
        expireInDays: expireInDays,
        digioResponse: response,
        pdfSource: template.sourceUrl ? 'auto_fetched' : 'existing_template'
      }
    });
    
  } catch (error) {
    console.error('[createDocumentForSigning] Error:', error);
    
    let errorMessage = error.message || "Failed to create document for signing";
    let statusCode = 500;
    
    if (error.code === 'AUTO_FETCH_FAILED') {
      errorMessage = "Unable to automatically fetch PDF template from ESIGN_PDF_URL.";
      statusCode = 503;
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
      details: error.response ? {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      } : error.details || error.message
    });
  }
};

/**
 * Verify eSign status for a specific product by just-in-time syncing the latest doc
 * GET /digio/esign/verify?productType=...&productId=...
 */
exports.verifyEsignForProduct = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { productType, productId } = req.query;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    if (!productType || !productId) return res.status(400).json({ success: false, error: 'Missing productType/productId' });

    // Find the most recent doc for this user+product
    let doc = await DigioSign.findOne({ userId, productType, productId, isTemplate: false }).sort({ createdAt: -1 });
    if (!doc) {
      // Fallback: latest user's doc
      doc = await DigioSign.findOne({ userId, isTemplate: false }).sort({ createdAt: -1 });
    }
    if (!doc) return res.status(404).json({ success: false, error: 'No eSign document found' });

    // If already completed
    if (['signed', 'completed'].includes(doc.status)) {
      return res.json({ 
        success: true, 
        status: doc.status, 
        documentId: doc.documentId,
        authenticationUrl: doc.digioResponse?.authentication_url || null,
        signUrl: doc.digioResponse?.sign_url || null
      });
    }

    // JIT sync
    try {
      const { syncDocument } = require('../services/digioWebhookService');
      const syncResult = await syncDocument(doc.documentId);
      const updated = syncResult?.document || doc;
      const ok = ['signed', 'completed'].includes(updated.status);

      // Optionally fetch remote for auth URL if still not signed
      let authenticationUrl = doc.digioResponse?.authentication_url || null;
      let signUrl = doc.digioResponse?.sign_url || null;
      if (!ok) {
        try {
          const DIGIO_API_BASE = await getConfig('DIGIO_API_BASE', 'https://ext.digio.in:444');
          const remote = await digioRequest('GET', `${DIGIO_API_BASE}/v2/client/document/${doc.documentId}`);
          authenticationUrl = remote?.authentication_url || authenticationUrl;
          signUrl = remote?.sign_url || signUrl;
        } catch (e) {
          // ignore remote fetch failure
        }
      }

      return res.json({ success: ok, status: updated.status, documentId: updated.documentId, authenticationUrl, signUrl });
    } catch (e) {
      return res.json({ success: false, status: doc.status, documentId: doc.documentId, authenticationUrl: doc.digioResponse?.authentication_url || null, signUrl: doc.digioResponse?.sign_url || null });
    }
  } catch (e) {
    console.error('[verifyEsignForProduct] error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
};

/**
 * Get status for a document/sessionId from DB and optionally fresh data from Digio
 */
exports.getStatus = async (req, res) => {
  try {
    const sessionId = req.params.sessionId || req.query.sessionId;
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId is required' });
    }

    // Look up local record by sessionId or documentId
    const record = await DigioSign.findOne({
      $or: [ { sessionId }, { documentId: sessionId } ]
    }).sort({ createdAt: -1 });

    if (!record) {
      return res.status(404).json({ success: false, error: 'No eSign record found for provided sessionId' });
    }

    const responsePayload = {
      record: {
        _id: record._id,
        userId: record.userId,
        documentId: record.documentId,
        sessionId: record.sessionId,
        name: record.name,
        email: record.email,
        phone: record.phone,
        idType: record.idType,
        idNumber: record.idNumber,
        status: record.status,
        signedAt: record.signedAt,
        signedDocumentUrl: record.signedDocumentUrl,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      }
    };

    // If we have a documentId, attempt to fetch fresh status from Digio API (best-effort)
    if (record.documentId) {
      try {
        const DIGIO_API_BASE = await getConfig('DIGIO_API_BASE', 'https://ext.digio.in:444');
        const remote = await digioRequest('GET', `${DIGIO_API_BASE}/v2/client/document/${record.documentId}`);
        responsePayload.remote = remote;

        // Map common remote fields if present
        if (remote && remote.status) {
          responsePayload.record.remoteStatus = remote.status;
        }
        if (remote && remote.signed_url) {
          responsePayload.record.signedDocumentUrl = remote.signed_url;
        }
      } catch (e) {
        // Log and continue — don't fail the whole request because remote call failed
        console.error('[getStatus] Failed to fetch remote Digio status:', e.message || e);
        responsePayload.remoteError = e.message || String(e);
      }
    }

    res.json({ success: true, data: responsePayload });
  } catch (error) {
    console.error('[getStatus] Error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to get status' });
  }
};

/**
 * Webhook endpoint to receive notifications from Digio
 */
exports.webhook = async (req, res) => {
  try {
    console.log('[WEBHOOK] Received Digio webhook');
    
    // Validate webhook signature if configured
    const isValid = await validateWebhookSignature(req.body, req.headers);
    if (!isValid) {
      console.warn('[WEBHOOK] Invalid webhook signature');
      return res.status(401).json({ success: false, error: 'Invalid signature' });
    }

    // Process the webhook
    const result = await processWebhook(req.body, req.headers);
    
    // Return success response to Digio
    res.json({
      success: true,
      message: 'Webhook processed successfully',
      ...result
    });

  } catch (error) {
    console.error('[WEBHOOK] Error processing webhook:', error);
    
    // Still return 200 to avoid Digio retrying if it's our internal error
    res.status(200).json({
      success: false,
      error: 'Webhook processing failed',
      message: error.message
    });
  }
};

/**
 * Manual sync endpoint to check document status
 */
exports.syncDocument = async (req, res) => {
  try {
    const { documentId } = req.params;
    const result = await syncDocument(documentId);
    res.json(result);
  } catch (error) {
    console.error('[SYNC] Error syncing document:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to sync document'
    });
  }
};

/**
 * Manual trigger for cron job to sync all pending documents
 */
exports.syncAllPending = async (req, res) => {
  try {
    const result = await syncPendingDocuments();
    res.json({
      success: true,
      message: 'Document sync completed',
      ...result
    });
  } catch (error) {
    console.error('[SYNC_ALL] Error syncing documents:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to sync documents'
    });
  }
};
