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
    const { fileUrl, fileName, signerEmail, signerName, signerPhone, reason } = req.body;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required - user not found"
      });
    }
    
    if (!fileUrl || !signerEmail || !signerName) {
      return res.status(400).json({
        success: false,
        error: "fileUrl, signerEmail, and signerName are required"
      });
    }
    
    const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://app.digio.in");
    
    const documentPayload = {
      file_url: fileUrl,
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

    const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://app.digio.in");
    
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

    // Create document for signing with file upload
    const documentPayload = {
      file_url: "https://s3.eu-north-1.amazonaws.com/rangaone.finance/DIgio_Documentation/aadhaar_esign_consent.pdf",
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

    const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://app.digio.in");
    
    try {
      const statusData = await digioRequest(
        "get",
        `${DIGIO_API_BASE}/v2/client/document/${encodeURIComponent(record.documentId || documentId)}`
      );
      
      // Update record with latest status
      const updatedRecord = await DigioSign.findOneAndUpdate(
        { _id: record._id },
        { 
          status: statusData?.status || statusData?.document_status,
          digioResponse: { ...record.digioResponse, status: statusData }
        },
        { new: true }
      );

      return res.json({
        success: true,
        documentId: record.documentId || documentId, 
        status: statusData?.status || statusData?.document_status,
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
        ...(status === 'signed' && { signedAt: new Date() })
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