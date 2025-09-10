const DigioSign = require('../models/DigioSign');
const { getConfig } = require('../utils/configSettings');
const axios = require('axios');

/**
 * Digio Webhook & Status Sync Service
 * Handles incoming webhook notifications from Digio API
 * and updates local DigioSign records accordingly.
 * Also provides cron job functionality to poll document status.
 */

/**
 * Process webhook payload from Digio
 * Common webhook events: document.viewed, document.signed, document.completed, document.expired, document.declined
 */
async function processWebhook(webhookPayload, headers = {}) {
  try {
    console.log('[DIGIO_WEBHOOK] Processing webhook:', JSON.stringify(webhookPayload, null, 2));
    
    // Extract common fields from webhook payload
    const { 
      event, 
      document_id, 
      session_id,
      status, 
      agreement_status, // Digio uses agreement_status
      signer_details,
      signed_document_url,
      signed_url, // Alternative field name
      timestamp,
      data
    } = webhookPayload;

    if (!document_id && !session_id) {
      throw new Error('Webhook payload missing document_id or session_id');
    }

    // Find the corresponding record in our database
    const record = await DigioSign.findOne({
      $or: [
        { documentId: document_id },
        { sessionId: session_id },
        { documentId: session_id }, // Sometimes session_id is used as document_id
        { sessionId: document_id }
      ]
    });

    if (!record) {
      console.warn(`[DIGIO_WEBHOOK] No matching record found for document_id: ${document_id}, session_id: ${session_id}`);
      return {
        success: false,
        message: 'No matching record found',
        document_id,
        session_id
      };
    }

    // Prepare update fields
    const updateFields = {
      lastWebhookAt: new Date(),
      webhookData: webhookPayload
    };

    // Map webhook status to our internal status
    if (status || agreement_status) {
      const actualStatus = status || agreement_status;
      updateFields.status = mapWebhookStatus(actualStatus, event);
    }

    // Handle specific events
    switch (event) {
      // Document signing events
      case 'doc.signed':
      case 'esign.v3.sign.pending':
        updateFields.status = 'signed';
        updateFields.signedAt = timestamp ? new Date(timestamp) : new Date();
        if (signed_document_url || signed_url) {
          updateFields.signedDocumentUrl = signed_document_url || signed_url;
        }
        if (signer_details) {
          // Update signer info if provided
          if (signer_details.name) updateFields.name = signer_details.name;
          if (signer_details.email) updateFields.email = signer_details.email;
          if (signer_details.phone) updateFields.phone = signer_details.phone;
        }
        break;
        
      // KYC request events
      case 'kyc.request.created':
        updateFields.status = 'sent';
        break;
        
      case 'kyc.request.completed':
      case 'kyc.request.approved':
        updateFields.status = 'signed';
        updateFields.signedAt = timestamp ? new Date(timestamp) : new Date();
        updateFields.kycVerified = true;
        break;
        
      case 'kyc.request.review.ready':
        updateFields.status = 'viewed';
        break;
        
      case 'kyc.request.rejected':
      case 'kyc.request.terminated':
        updateFields.status = 'declined';
        break;
        
      case 'kyc.request.expired':
        updateFields.status = 'expired';
        break;
        
      // KYC action events
      case 'kyc.action.created':
        updateFields.status = 'sent';
        break;
        
      case 'kyc.action.completed':
        updateFields.status = 'signed';
        updateFields.signedAt = timestamp ? new Date(timestamp) : new Date();
        updateFields.kycVerified = true;
        break;
        
      case 'kyc.action.rejected':
      case 'kyc.action.call.terminated':
        updateFields.status = 'declined';
        break;
        
      // Failure events
      case 'doc.sign.failed':
      case 'esign.v3.sign.failed':
        updateFields.status = 'failed';
        if (data && data.error) {
          updateFields.lastError = data.error;
          updateFields.errorCount = (record.errorCount || 0) + 1;
        }
        break;
        
      // Legacy events (for backward compatibility)
      case 'document.signed':
      case 'document.completed':
        updateFields.status = 'signed';
        updateFields.signedAt = timestamp ? new Date(timestamp) : new Date();
        if (signed_document_url || signed_url) {
          updateFields.signedDocumentUrl = signed_document_url || signed_url;
        }
        if (signer_details) {
          // Update signer info if provided
          if (signer_details.name) updateFields.name = signer_details.name;
          if (signer_details.email) updateFields.email = signer_details.email;
          if (signer_details.phone) updateFields.phone = signer_details.phone;
        }
        break;
        
      case 'document.viewed':
        updateFields.status = 'viewed';
        break;
        
      case 'document.expired':
        updateFields.status = 'expired';
        break;
        
      case 'document.declined':
        updateFields.status = 'declined';
        break;
        
      case 'document.failed':
        updateFields.status = 'failed';
        if (data && data.error) {
          updateFields.lastError = data.error;
          updateFields.errorCount = (record.errorCount || 0) + 1;
        }
        break;
    }

    // Update the record
    const updatedRecord = await DigioSign.findByIdAndUpdate(
      record._id,
      { $set: updateFields },
      { new: true }
    );

    console.log(`[DIGIO_WEBHOOK] Updated record ${record._id} with status: ${updateFields.status}`);

    return {
      success: true,
      message: 'Webhook processed successfully',
      recordId: record._id,
      previousStatus: record.status,
      newStatus: updateFields.status,
      event
    };

  } catch (error) {
    console.error('[DIGIO_WEBHOOK] Error processing webhook:', error);
    throw error;
  }
}

/**
 * Map Digio webhook status to our internal status enum
 */
function mapWebhookStatus(webhookStatus, event) {
  const statusMap = {
    'sent': 'sent',
    'viewed': 'viewed', 
    'signed': 'signed',
    'completed': 'completed',
    'expired': 'expired',
    'declined': 'declined',
    'failed': 'failed',
    'pending': 'sent', // Map pending to sent
    'in_progress': 'viewed', // Map in_progress to viewed
    'success': 'signed', // Map success to signed
    'executed': 'signed', // Map executed to signed
    'finished': 'completed', // Map finished to completed
    'approved': 'signed', // Map approved to signed
    'accepted': 'signed' // Map accepted to signed
  };

  // If we have an event, prioritize event-based mapping
  if (event) {
    const eventMap = {
      // Document signing events
      'doc.signed': 'signed',
      'doc.sign.rejected': 'declined',
      'doc.sign.failed': 'failed',
      'esign.v3.sign.failed': 'failed',
      'esign.v3.sign.pending': 'sent',
      
      // KYC request events
      'kyc.request.created': 'sent',
      'kyc.request.completed': 'signed',
      'kyc.request.review.ready': 'viewed',
      'kyc.request.approved': 'signed',
      'kyc.request.rejected': 'declined',
      'kyc.request.expired': 'expired',
      'kyc.request.terminated': 'failed',
      
      // KYC action events
      'kyc.action.created': 'sent',
      'kyc.action.call.terminated': 'failed',
      'kyc.action.completed': 'signed',
      'kyc.action.rejected': 'declined',
      
      // Legacy events (for backward compatibility)
      'document.sent': 'sent',
      'document.viewed': 'viewed',
      'document.signed': 'signed', 
      'document.completed': 'completed',
      'document.expired': 'expired',
      'document.declined': 'declined',
      'document.failed': 'failed',
      'esign.completed': 'signed',
      'esign.signed': 'signed',
      'esign.finished': 'signed'
    };
    
    if (eventMap[event]) {
      return eventMap[event];
    }
  }

  return statusMap[webhookStatus] || webhookStatus;
}

/**
 * Validate webhook authenticity (if Digio provides signature verification)
 * This is a placeholder - implement based on Digio's security documentation
 */
async function validateWebhookSignature(payload, headers) {
  try {
    // Check if webhook signature validation is enabled
    const webhookSecret = await getConfig('DIGIO_WEBHOOK_SECRET');
    if (!webhookSecret) {
      console.warn('[DIGIO_WEBHOOK] No webhook secret configured - skipping signature validation');
      return true; // Allow if no secret is configured
    }

    // Implement signature validation logic here based on Digio's documentation
    // Common patterns:
    // 1. HMAC-SHA256 of payload with secret
    // 2. Check X-Digio-Signature header
    // 3. Timestamp validation to prevent replay attacks

    const signature = headers['x-digio-signature'] || headers['x-signature'];
    if (!signature) {
      console.warn('[DIGIO_WEBHOOK] No signature header found');
      return false;
    }

    // Placeholder for actual validation
    // const crypto = require('crypto');
    // const expectedSignature = crypto
    //   .createHmac('sha256', webhookSecret)
    //   .update(JSON.stringify(payload))
    //   .digest('hex');
    // 
    // return crypto.timingSafeEqual(
    //   Buffer.from(signature),
    //   Buffer.from(expectedSignature)
    // );

    console.log('[DIGIO_WEBHOOK] Signature validation not implemented - allowing request');
    return true;
    
  } catch (error) {
    console.error('[DIGIO_WEBHOOK] Signature validation error:', error);
    return false;
  }
}

/**
 * Health check for webhook endpoint
 */
function healthCheck() {
  return {
    success: true,
    message: 'Digio webhook service is running',
    timestamp: new Date().toISOString()
  };
}

/**
 * Cron job function to check document status via Digio API
 * Runs every 15 minutes to sync status for pending documents
 */
async function syncPendingDocuments() {
  try {
    console.log('[DIGIO_SYNC] Starting document status sync...');

    // Find documents that are in pending states and haven't been updated recently
    const pendingStatuses = ['sent', 'viewed', 'document_created', 'initiated'];
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

    const pendingDocs = await DigioSign.find({
      status: { $in: pendingStatuses },
      documentId: { $exists: true, $ne: null },
      $or: [
        { lastWebhookAt: { $exists: false } },
        { lastWebhookAt: { $lt: fifteenMinutesAgo } },
        { updatedAt: { $lt: fifteenMinutesAgo } }
      ]
    }).limit(50); // Limit to avoid API rate limits

    console.log(`[DIGIO_SYNC] Found ${pendingDocs.length} pending documents to check`);

    if (pendingDocs.length === 0) {
      return { processed: 0, updated: 0, errors: 0 };
    }

    const DIGIO_API_BASE = await getConfig('DIGIO_API_BASE', 'https://ext.digio.in:444');
    const DIGIO_CLIENT_ID = await getConfig('DIGIO_CLIENT_ID');
    const DIGIO_CLIENT_SECRET = await getConfig('DIGIO_CLIENT_SECRET');

    if (!DIGIO_CLIENT_ID || !DIGIO_CLIENT_SECRET) {
      throw new Error('Digio credentials not configured');
    }

    const basicAuth = Buffer.from(`${DIGIO_CLIENT_ID}:${DIGIO_CLIENT_SECRET}`).toString('base64');
    let updated = 0;
    let errors = 0;

    // Process documents in batches to avoid overwhelming the API
    for (const doc of pendingDocs) {
      try {
        console.log(`[DIGIO_SYNC] Checking document ${doc.documentId}...`);

        const response = await axios.get(`${DIGIO_API_BASE}/v2/client/document/${doc.documentId}`, {
          headers: {
            'Authorization': `Basic ${basicAuth}`,
            'Accept': 'application/json'
          },
          timeout: 10000
        });

        const remoteStatus = response.data?.status || response.data?.agreement_status;
        const signedUrl = response.data?.signed_url || response.data?.signed_document_url;
        const lastActivity = response.data?.last_activity || response.data?.updated_at;

        console.log(`[DIGIO_SYNC] Digio API response for ${doc.documentId}:`, {
          status: remoteStatus,
          signed_url: signedUrl,
          last_activity: lastActivity,
          fullResponse: response.data
        });

        if (remoteStatus) {
          const mappedStatus = mapWebhookStatus(remoteStatus);
          
          console.log(`[DIGIO_SYNC] Status mapping: "${remoteStatus}" → "${mappedStatus}" (current: "${doc.status}")`);
          
          if (mappedStatus !== doc.status) {
            const updateData = {
              status: mappedStatus,
              digioResponse: response.data,
              updatedAt: new Date()
            };

            // Handle signed documents
            if (['signed', 'completed'].includes(mappedStatus)) {
              updateData.signedAt = lastActivity ? new Date(lastActivity) : new Date();
              updateData.kycVerified = true;
              if (signedUrl) {
                updateData.signedDocumentUrl = signedUrl;
              }
            }

            await DigioSign.findByIdAndUpdate(doc._id, { $set: updateData });
            console.log(`[DIGIO_SYNC] Updated document ${doc.documentId}: ${doc.status} → ${mappedStatus}`);
            updated++;
          }
        }

        // Small delay to respect API rate limits
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        console.error(`[DIGIO_SYNC] Error checking document ${doc.documentId}:`, error.message);
        errors++;

        // Update error count in document
        await DigioSign.findByIdAndUpdate(doc._id, {
          $inc: { errorCount: 1 },
          $set: { lastError: error.message, updatedAt: new Date() }
        });
      }
    }

    console.log(`[DIGIO_SYNC] Completed: ${pendingDocs.length} processed, ${updated} updated, ${errors} errors`);

    return {
      processed: pendingDocs.length,
      updated,
      errors,
      timestamp: new Date()
    };

  } catch (error) {
    console.error('[DIGIO_SYNC] Error in sync job:', error);
    throw error;
  }
}

/**
 * Manual trigger to sync a specific document
 */
async function syncDocument(documentId) {
  try {
    const doc = await DigioSign.findOne({
      $or: [
        { documentId },
        { sessionId: documentId }
      ]
    });

    if (!doc) {
      throw new Error(`Document not found: ${documentId}`);
    }

    const DIGIO_API_BASE = await getConfig('DIGIO_API_BASE', 'https://ext.digio.in:444');
    const DIGIO_CLIENT_ID = await getConfig('DIGIO_CLIENT_ID');
    const DIGIO_CLIENT_SECRET = await getConfig('DIGIO_CLIENT_SECRET');

    const basicAuth = Buffer.from(`${DIGIO_CLIENT_ID}:${DIGIO_CLIENT_SECRET}`).toString('base64');

  const response = await axios.get(`${DIGIO_API_BASE}/v2/client/document/${doc.documentId}`, {
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

  // Digio may return status under different keys. Prefer explicit status, else agreement_status.
  const remoteStatusRaw = response.data?.status || response.data?.agreement_status || response.data?.signing_parties?.[0]?.status;
  const mappedStatus = mapWebhookStatus(remoteStatusRaw);
    
    const updateData = {
      status: mappedStatus,
      digioResponse: response.data,
      updatedAt: new Date()
    };

    if (['signed', 'completed'].includes(mappedStatus)) {
      updateData.signedAt = new Date();
      updateData.kycVerified = true;
      // capture any signed document url fields
      const signedUrl = response.data?.signed_url || response.data?.signed_document_url || response.data?.signing_parties?.[0]?.signed_document_url;
      if (signedUrl) {
        updateData.signedDocumentUrl = signedUrl;
      }
    }

    const updatedDoc = await DigioSign.findByIdAndUpdate(doc._id, { $set: updateData }, { new: true });

    return {
      success: true,
      document: updatedDoc,
      oldStatus: doc.status,
      newStatus: mappedStatus
    };

  } catch (error) {
    console.error(`[DIGIO_SYNC] Error syncing document ${documentId}:`, error);
    throw error;
  }
}

/**
 * Get webhook configuration info
 */
function getWebhookConfig() {
  return {
    events: [
      'document.sent',
      'document.viewed',
      'document.signed',
      'document.completed',
      'document.expired',
      'document.declined',
      'document.failed'
    ],
    endpoint: '/digio/webhook',
    method: 'POST',
    note: 'Configure this URL in your Digio dashboard'
  };
}

module.exports = {
  processWebhook,
  validateWebhookSignature,
  healthCheck,
  mapWebhookStatus,
  syncPendingDocuments,
  syncDocument,
  getWebhookConfig
};
