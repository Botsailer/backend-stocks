// const axios = require("axios");
// const DigioSign = require("../models/DigioSign");
// const { getConfig } = require("../utils/configSettings");

// /**
//  * Helper: make HTTP requests to Digio with proper authentication and error handling.
//  */
// async function digioRequest(method, url, data = {}, headers = {}) {
//   try {
//     const DIGIO_CLIENT_ID = await getConfig("DIGIO_CLIENT_ID");
//     const DIGIO_CLIENT_SECRET = await getConfig("DIGIO_CLIENT_SECRET");
    
//     console.log(`[DIGIO] ${method.toUpperCase()} → ${url}`, JSON.stringify(data, null, 2));
//     console.log(`[DIGIO] Using credentials - ID: ${DIGIO_CLIENT_ID?.substring(0, 5)}...`);
    
//     // Validate credentials
//     if (!DIGIO_CLIENT_ID || !DIGIO_CLIENT_SECRET) {
//       throw new Error('Digio API credentials not found. Please check DIGIO_CLIENT_ID and DIGIO_CLIENT_SECRET environment variables.');
//     }
    
//     // Create Basic Auth header
//     const basicAuth = Buffer.from(`${DIGIO_CLIENT_ID}:${DIGIO_CLIENT_SECRET}`).toString('base64');
    
//     const config = {
//       method,
//       url,
//       data: method.toLowerCase() !== 'get' ? data : undefined,
//       headers: {
//         'Authorization': `Basic ${basicAuth}`,
//         'Content-Type': 'application/json',
//         'Accept': 'application/json',
//         ...headers
//       },
//       timeout: 30000,
//       validateStatus: function (status) {
//         return status < 500;
//       }
//     };

//     if (method.toLowerCase() === 'get' && Object.keys(data).length > 0) {
//       config.params = data;
//     }

//     const response = await axios(config);
//     console.log(`[DIGIO] Response Status: ${response.status}`, response.data);
    
//     if (response.status >= 400) {
//       throw new Error(`Digio API Error: ${response.status} - ${JSON.stringify(response.data)}`);
//     }
    
//     return response.data;
//   } catch (error) {
//     console.error(`[DIGIO] Request failed:`, {
//       url,
//       method,
//       data,
//       error: error.message,
//       response: error.response?.data,
//       status: error.response?.status
//     });
//     throw error;
//   }
// }

// /**
//  * Initiate KYC: 
//  * - If PAN: call PAN verification API immediately.
//  * - If Aadhaar: send OTP to Aadhaar mobile.
//  */
// exports.startKyc = async (req, res) => {
//   try {
//     const { name, email, phone, idType, idNumber } = req.body;
    
//     // Validation
//     if (!["aadhaar", "pan"].includes(idType)) {
//       return res.status(400).json({ error: "idType must be 'aadhaar' or 'pan'" });
//     }
//     if (!idNumber || !name || !email || !phone) {
//       return res.status(400).json({ error: "All fields (name, email, phone, idType, idNumber) are required" });
//     }

//     // Validate Aadhaar number format (12 digits)
//     if (idType === "aadhaar" && (!/^\d{12}$/.test(idNumber))) {
//       return res.status(400).json({ error: "Aadhaar number must be exactly 12 digits" });
//     }

//     // Validate PAN format (ABCDE1234F)
//     if (idType === "pan" && (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(idNumber))) {
//       return res.status(400).json({ error: "PAN must be in format ABCDE1234F" });
//     }

//     const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://ext.digio.in:444");
    
//     // Create record early to get _id for session
//     const record = await DigioSign.create({ 
//       name, 
//       email, 
//       phone, 
//       idType, 
//       idNumber, 
//       kycVerified: false, 
//       digioResponse: {} 
//     });

//     if (idType === "aadhaar") {
//       // Check credentials first
//       const DIGIO_CLIENT_ID = await getConfig("DIGIO_CLIENT_ID");
//       const DIGIO_CLIENT_SECRET = await getConfig("DIGIO_CLIENT_SECRET");
      
//       if (!DIGIO_CLIENT_ID || !DIGIO_CLIENT_SECRET) {
//         await DigioSign.findByIdAndDelete(record._id);
//         return res.status(400).json({ 
//           success: false,
//           error: "Digio API credentials are not properly configured. Please contact system administrator.",
//           details: "Missing DIGIO_CLIENT_ID or DIGIO_CLIENT_SECRET"
//         });
//       }

//       // Try multiple Aadhaar OTP endpoints
//       const aadhaarEndpoints = [
//         {
//           url: `${DIGIO_API_BASE}/v2/client/kyc/aadhaar-otp/init`,
//           payload: { aadhaar_number: idNumber }
//         },
//         {
//           url: `${DIGIO_API_BASE}/client/kyc/aadhaar/otp/init`,
//           payload: { aadhaar: idNumber }
//         },
//         {
//           url: `${DIGIO_API_BASE}/v1/kyc/aadhaar/otp/generate`,
//           payload: { aadhaar_number: idNumber, consent: "Y" }
//         },
//         {
//           url: `${DIGIO_API_BASE}/kyc/aadhaar/generate-otp`,
//           payload: { aadhaar: idNumber }
//         }
//       ];

//       let otpResponse = null;
//       let lastError = null;

//       for (const endpoint of aadhaarEndpoints) {
//         try {
//           console.log(`[startKyc] Trying Aadhaar endpoint: ${endpoint.url}`);
//           otpResponse = await digioRequest("post", endpoint.url, endpoint.payload);
          
//           if (otpResponse && (otpResponse.request_id || otpResponse.reference_id || otpResponse.id || otpResponse.otp_sent)) {
//             break;
//           }
//         } catch (error) {
//           console.log(`[startKyc] Aadhaar endpoint ${endpoint.url} failed:`, error.message);
//           lastError = error;
//           continue;
//         }
//       }

//       if (otpResponse) {
//         record.kycRequestId = otpResponse?.request_id || otpResponse?.reference_id || otpResponse?.id;
//         record.digioResponse.kyc = { initiate: otpResponse };
//         await record.save();

//         return res.json({
//           success: true,
//           message: "OTP sent to Aadhaar registered mobile number",
//           data: { 
//             sessionId: record._id.toString(),
//             reference_id: record.kycRequestId,
//             response: otpResponse
//           }
//         });
//       } else {
//         await DigioSign.findByIdAndDelete(record._id);
//         return res.status(400).json({ 
//           success: false,
//           error: "All Aadhaar OTP endpoints failed. This could be due to incorrect API credentials, wrong endpoints, or API service issues.",
//           details: lastError?.message || "No working endpoints found",
//           suggestion: "Please verify your Digio API credentials and ensure your account has Aadhaar OTP access."
//         });
//       }
//     }

//     if (idType === "pan") {
//       // Check if credentials are properly configured
//       const DIGIO_CLIENT_ID = await getConfig("DIGIO_CLIENT_ID");
//       const DIGIO_CLIENT_SECRET = await getConfig("DIGIO_CLIENT_SECRET");
      
//       if (!DIGIO_CLIENT_ID || !DIGIO_CLIENT_SECRET) {
//         await DigioSign.findByIdAndDelete(record._id);
//         return res.status(400).json({ 
//           success: false,
//           error: "Digio API credentials are not properly configured. Please contact system administrator.",
//           details: "Missing DIGIO_CLIENT_ID or DIGIO_CLIENT_SECRET"
//         });
//       }

//       // Try common PAN verification endpoints
//       const panEndpoints = [
//         {
//           url: `${DIGIO_API_BASE}/v2/client/kyc/pan`,
//           payload: { pan: idNumber, name: name }
//         },
//         {
//           url: `${DIGIO_API_BASE}/client/kyc/pan/verify`,
//           payload: { pan_number: idNumber, name: name }
//         },
//         {
//           url: `${DIGIO_API_BASE}/v1/kyc/pan/verify`,
//           payload: { pan: idNumber }
//         },
//         {
//           url: `${DIGIO_API_BASE}/kyc/pan`,
//           payload: { pan: idNumber, full_name: name }
//         }
//       ];

//       let panVerified = false;
//       let lastError = null;
//       let successResponse = null;

//       for (const endpoint of panEndpoints) {
//         try {
//           console.log(`[startKyc] Trying PAN endpoint: ${endpoint.url}`);
//           const kycData = await digioRequest("post", endpoint.url, endpoint.payload);
          
//           // Check various success indicators
//           panVerified = Boolean(
//             kycData?.verified || 
//             kycData?.valid || 
//             kycData?.status === 'success' || 
//             kycData?.status === 'verified' ||
//             kycData?.response === 'success'
//           );
          
//           if (panVerified || kycData) {
//             successResponse = kycData;
//             break;
//           }
//         } catch (error) {
//           console.log(`[startKyc] PAN endpoint ${endpoint.url} failed:`, error.message);
//           lastError = error;
//           continue;
//         }
//       }

//       if (successResponse) {
//         record.kycVerified = panVerified;
//         record.digioResponse.kyc = successResponse;
//         await record.save();

//         return res.json({ 
//           success: true,
//           message: panVerified ? "PAN verification completed successfully" : "PAN verification attempted (please verify the response)", 
//           data: {
//             ...record.toObject(),
//             verification_status: panVerified ? 'verified' : 'pending_review',
//             pan_response: successResponse
//           }
//         });
//       } else {
//         await DigioSign.findByIdAndDelete(record._id);
//         return res.status(400).json({ 
//           success: false,
//           error: "All PAN verification endpoints failed. This could be due to incorrect API credentials, wrong endpoints, or API service issues.",
//           details: lastError?.message || "No working endpoints found",
//           suggestion: "Please verify your Digio API credentials and ensure your account has PAN verification access."
//         });
//       }
//     }

//   } catch (err) {
//     console.error("[startKyc] Error:", err);
//     res.status(500).json({ 
//       success: false,
//       error: "Internal server error",
//       message: err.message
//     });
//   }
// };

// /**
//  * Verify Aadhaar OTP: complete Aadhaar KYC with the OTP provided by user.
//  */
// exports.verifyAadhaarKyc = async (req, res) => {
//   try {
//     const { sessionId, otp } = req.body;
    
//     if (!sessionId || !otp) {
//       return res.status(400).json({ 
//         success: false,
//         error: "sessionId and otp are required" 
//       });
//     }

//     // Validate OTP format (typically 6 digits)
//     if (!/^\d{6}$/.test(otp)) {
//       return res.status(400).json({ 
//         success: false,
//         error: "OTP must be 6 digits" 
//       });
//     }

//     const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://ext.digio.in:444");
//     const record = await DigioSign.findById(sessionId);
    
//     if (!record) {
//       return res.status(404).json({ 
//         success: false,
//         error: "Session not found or expired" 
//       });
//     }
    
//     if (record.idType !== "aadhaar") {
//       return res.status(400).json({ 
//         success: false,
//         error: "This session is not for Aadhaar verification" 
//       });
//     }

//     if (!record.kycRequestId) {
//       return res.status(400).json({ 
//         success: false,
//         error: "Invalid session - missing request ID" 
//       });
//     }

//     try {
//       // Primary OTP verification endpoint
//       const result = await digioRequest(
//         "post",
//         `${DIGIO_API_BASE}/v3/client/kyc/aadhaar/otp/verify`,
//         { 
//           request_id: record.kycRequestId, 
//           otp: otp
//         }
//       );
      
//       record.kycVerified = Boolean(result?.verified || result?.status === 'success');
//       record.digioResponse.kyc = { ...record.digioResponse.kyc, verify: result };
//       await record.save();

//       return res.json({ 
//         success: true,
//         message: "Aadhaar verification completed", 
//         data: {
//           ...record.toObject(),
//           verification_status: record.kycVerified ? 'verified' : 'failed'
//         }
//       });
//     } catch (error) {
//       // Try alternative endpoint
//       try {
//         const result = await digioRequest(
//           "post",
//           `${DIGIO_API_BASE}/v2/client/kyc/aadhaar/verify`,
//           { 
//             reference_id: record.kycRequestId, 
//             otp: otp,
//             aadhaar: record.idNumber
//           }
//         );
        
//         record.kycVerified = Boolean(result?.verified || result?.status === 'success');
//         record.digioResponse.kyc = { ...record.digioResponse.kyc, verify: result };
//         await record.save();

//         return res.json({ 
//           success: true,
//           message: "Aadhaar verification completed", 
//           data: {
//             ...record.toObject(),
//             verification_status: record.kycVerified ? 'verified' : 'failed'
//           }
//         });
//       } catch (secondError) {
//         console.error("[verifyAadhaarKyc] Both verification endpoints failed:", secondError);
//         return res.status(400).json({ 
//           success: false,
//           error: "Failed to verify OTP. Please check the OTP and try again.",
//           details: secondError.message
//         });
//       }
//     }
//   } catch (err) {
//     console.error("[verifyAadhaarKyc] Error:", err);
//     res.status(500).json({ 
//       success: false,
//       error: "Internal server error",
//       message: err.message
//     });
//   }
// };

// /**
//  * Confirm KYC and initiate eSign: upload PDF to Digio for signing.
//  */
// exports.confirmKycAndESign = async (req, res) => {
//   try {
//     const { documentId } = req.params;
//     const { fileUrl, documentTitle = "Agreement", reason = "Document Signature" } = req.body;
    
//     if (!fileUrl) {
//       return res.status(400).json({ 
//         success: false,
//         error: "fileUrl is required" 
//       });
//     }

//     // Validate URL format
//     try {
//       new URL(fileUrl);
//     } catch {
//       return res.status(400).json({ 
//         success: false,
//         error: "Invalid fileUrl format" 
//       });
//     }

//     const record = await DigioSign.findById(documentId);
//     if (!record) {
//       return res.status(404).json({ 
//         success: false,
//         error: "Record not found" 
//       });
//     }
    
//     if (!record.kycVerified) {
//       return res.status(400).json({ 
//         success: false,
//         error: "KYC verification is required before initiating eSign" 
//       });
//     }

//     const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://ext.digio.in:444");
    
//     try {
//       const esignPayload = {
//         file_url: fileUrl,
//         file_name: documentTitle,
//         signers: [{
//           identifier: record.email,
//           name: record.name,
//           email: record.email,
//           mobile: record.phone,
//           reason: reason,
//           sign_page: "all"
//         }],
//         expire_in_days: 7,
//         send_sign_link: true,
//         embedded_signing: false
//       };

//       const esignResp = await digioRequest(
//         "post",
//         `${DIGIO_API_BASE}/v2/client/document/uploadpdf`,
//         esignPayload
//       );

//       record.documentId = esignResp?.id || esignResp?.document_id;
//       record.digioResponse.esign = esignResp;
//       record.status = esignResp?.status || 'initiated';
//       await record.save();

//       return res.status(201).json({ 
//         success: true,
//         message: "eSign request created successfully", 
//         data: {
//           ...record.toObject(),
//           sign_url: esignResp?.sign_url || esignResp?.signing_url
//         }
//       });
//     } catch (error) {
//       console.error("[confirmKycAndESign] eSign initiation failed:", error);
//       return res.status(400).json({ 
//         success: false,
//         error: "Failed to initiate eSign process",
//         details: error.message
//       });
//     }
//   } catch (err) {
//     console.error("[confirmKycAndESign] Error:", err);
//     res.status(500).json({ 
//       success: false,
//       error: "Internal server error",
//       message: err.message
//     });
//   }
// };

// /**
//  * Fetch current eSign status from Digio and update record.
//  */
// exports.getStatus = async (req, res) => {
//   try {
//     const { documentId } = req.params;
    
//     if (!documentId) {
//       return res.status(400).json({ 
//         success: false,
//         error: "documentId is required" 
//       });
//     }

//     const record = await DigioSign.findOne({ 
//       $or: [
//         { _id: documentId },
//         { documentId: documentId }
//       ]
//     });

//     if (!record) {
//       return res.status(404).json({ 
//         success: false,
//         error: "Document not found" 
//       });
//     }

//     const DIGIO_API_BASE = await getConfig("DIGIO_API_BASE", "https://ext.digio.in:444");
    
//     try {
//       const statusData = await digioRequest(
//         "get",
//         `${DIGIO_API_BASE}/v2/client/document/${encodeURIComponent(record.documentId || documentId)}`
//       );
      
//       // Update record with latest status
//       const updatedRecord = await DigioSign.findOneAndUpdate(
//         { _id: record._id },
//         { 
//           status: statusData?.status || statusData?.document_status,
//           digioResponse: { ...record.digioResponse, status: statusData }
//         },
//         { new: true }
//       );

//       return res.json({ 
//         success: true,
//         documentId: record.documentId || documentId, 
//         status: statusData?.status || statusData?.document_status,
//         data: updatedRecord,
//         raw: statusData 
//       });
//     } catch (error) {
//       console.error("[getStatus] Status fetch failed:", error);
//       return res.status(400).json({ 
//         success: false,
//         error: "Failed to fetch document status",
//         details: error.message
//       });
//     }
//   } catch (err) {
//     console.error("[getStatus] Error:", err);
//     res.status(500).json({ 
//       success: false,
//       error: "Internal server error",
//       message: err.message
//     });
//   }
// };

// /**
//  * Receive webhook callbacks from Digio (e.g. document signed) and update record.
//  */
// exports.webhook = async (req, res) => {
//   try {
//     console.log("[Digio Webhook] Received:", JSON.stringify(req.body, null, 2));
    
//     const { document_id, id, status, event_type } = req.body;
//     const docId = document_id || id;
    
//     if (!docId) {
//       console.error("[Digio Webhook] No document ID found in webhook data");
//       return res.status(400).json({ 
//         success: false,
//         error: "document_id or id is required in webhook data" 
//       });
//     }

//     const updatedRecord = await DigioSign.findOneAndUpdate(
//       { documentId: docId },
//       { 
//         status: status,
//         webhookData: req.body,
//         lastWebhookAt: new Date()
//       },
//       { new: true }
//     );

//     if (!updatedRecord) {
//       console.warn(`[Digio Webhook] No record found for document ID: ${docId}`);
//       // Still return success to avoid webhook retries
//       return res.json({ 
//         success: true,
//         message: "Webhook received but no matching record found" 
//       });
//     }

//     console.log(`[Digio Webhook] Updated record ${updatedRecord._id} with status: ${status}`);
    
//     return res.json({ 
//       success: true,
//       message: "Webhook processed successfully" 
//     });
//   } catch (err) {
//     console.error("[webhook] Error:", err);
//     res.status(500).json({ 
//       success: false,
//       error: "Internal server error",
//       message: err.message
//     });
//   }
// };

// /**
//  * Admin route: list all DigioSign records with optional filtering.
//  */
// exports.listAll = async (req, res) => {
//   try {
//     const { status, idType, page = 1, limit = 50 } = req.query;
    
//     // Build filter object
//     const filter = {};
//     if (status) filter.status = status;
//     if (idType) filter.idType = idType;

//     // Calculate pagination
//     const skip = (parseInt(page) - 1) * parseInt(limit);
    
//     // Get total count for pagination
//     const total = await DigioSign.countDocuments(filter);
    
//     // Fetch documents with pagination
//     const docs = await DigioSign.find(filter)
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(parseInt(limit))
//       .select('-digioResponse -webhookData'); // Exclude large response objects for list view

//     return res.json({
//       success: true,
//       data: docs,
//       pagination: {
//         page: parseInt(page),
//         limit: parseInt(limit),
//         total,
//         pages: Math.ceil(total / parseInt(limit))
//       }
//     });
//   } catch (err) {
//     console.error("[listAll] Error:", err);
//     res.status(500).json({ 
//       success: false,
//       error: "Internal server error",
//       message: err.message
//     });
//   }
// };

// /**
//  * Get detailed information about a specific record
//  */
// exports.getRecord = async (req, res) => {
//   try {
//     const { recordId } = req.params;
    
//     const record = await DigioSign.findById(recordId);
//     if (!record) {
//       return res.status(404).json({ 
//         success: false,
//         error: "Record not found" 
//       });
//     }

//     return res.json({
//       success: true,
//       data: record
//     });
//   } catch (err) {
//     console.error("[getRecord] Error:", err);
//     res.status(500).json({ 
//       success: false,
//       error: "Internal server error",
//       message: err.message
//     });
//   }
// };