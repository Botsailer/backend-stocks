const cron = require('node-cron');
const DigioSign = require('../models/DigioSign');
const { getConfig } = require('../utils/configSettings');

/**
 * Digio Polling Service - Cron Job
 * Runs every 15 minutes to check document status for pending/sent documents
 * Fallback when webhooks are not available or as a backup sync mechanism
 */

// Import the digioRequest helper from controller
let digioRequest;
try {
  const digioController = require('../controllers/digioController');
  // Extract the digioRequest function (it's not exported, so we'll need to duplicate it)
} catch (error) {
  console.warn('[DIGIO_CRON] Could not import digioRequest from controller');
}

/**
 * Make HTTP requests to Digio API with authentication
 * (Duplicated from digioController since it's not exported)
 */
async function makeDigioRequest(method, url, data = {}, headers = {}) {
  const axios = require('axios');
  
  try {
    const DIGIO_CLIENT_ID = await getConfig("DIGIO_CLIENT_ID");
    const DIGIO_CLIENT_SECRET = await getConfig("DIGIO_CLIENT_SECRET");
    
    if (!DIGIO_CLIENT_ID || !DIGIO_CLIENT_SECRET) {
      throw new Error('Digio API credentials not found');
    }
    
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
    
    if (response.status >= 400) {
      const error = new Error(`Digio API Error: ${response.status}`);
      error.status = response.status;
      error.response = response.data;
      throw error;
    }
    
    return response.data;
  } catch (error) {
    console.error(`[DIGIO_CRON] API request failed:`, error.message);
    throw error;
  }
}

/**
 * Check status of a single document via Digio API
 */
async function checkDocumentStatus(record) {
  try {
    const DIGIO_API_BASE = await getConfig('DIGIO_API_BASE', 'https://ext.digio.in:444');
    
    if (!record.documentId) {
      console.warn(`[DIGIO_CRON] No documentId for record ${record._id}`);
      return null;
    }

    console.log(`[DIGIO_CRON] Checking status for document: ${record.documentId}`);
    
    const response = await makeDigioRequest('GET', `${DIGIO_API_BASE}/v2/client/document/${record.documentId}`);
    
    return response;
  } catch (error) {
    console.error(`[DIGIO_CRON] Failed to check document ${record.documentId}:`, error.message);
    
    // Update error tracking
    await DigioSign.findByIdAndUpdate(record._id, {
      $set: {
        lastError: error.message,
        errorCount: (record.errorCount || 0) + 1
      }
    });
    
    return null;
  }
}

/**
 * Update local record based on Digio API response
 */
async function updateRecordFromApiResponse(record, apiResponse) {
  try {
    const updateFields = {};
    
    // Map API status to our internal status
    if (apiResponse.status) {
      const statusMap = {
        'sent': 'sent',
        'pending': 'sent',
        'viewed': 'viewed',
        'in_progress': 'viewed',
        'signed': 'signed',
        'completed': 'signed',
        'success': 'signed',
        'expired': 'expired',
        'declined': 'declined',
        'failed': 'failed',
        'cancelled': 'declined'
      };
      
      const mappedStatus = statusMap[apiResponse.status.toLowerCase()] || apiResponse.status;
      
      if (mappedStatus !== record.status) {
        updateFields.status = mappedStatus;
        console.log(`[DIGIO_CRON] Status change for ${record._id}: ${record.status} → ${mappedStatus}`);
      }
    }
    
    // Update signed document URL if available
    if (apiResponse.signed_url && !record.signedDocumentUrl) {
      updateFields.signedDocumentUrl = apiResponse.signed_url;
    }
    
    // Set signedAt timestamp for completed documents
    if (updateFields.status === 'signed' && !record.signedAt) {
      updateFields.signedAt = new Date();
    }
    
    // Store the API response
    updateFields.digioResponse = apiResponse;
    
    // Only update if there are changes
    if (Object.keys(updateFields).length > 0) {
      await DigioSign.findByIdAndUpdate(record._id, {
        $set: updateFields
      });
      
      console.log(`[DIGIO_CRON] Updated record ${record._id}:`, updateFields);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`[DIGIO_CRON] Failed to update record ${record._id}:`, error);
    return false;
  }
}

/**
 * Main cron job function - check all pending documents
 */
async function checkPendingDocuments() {
  try {
    console.log('[DIGIO_CRON] Starting document status check...');
    
    // Find documents that need status checking
    // Only check documents that are not in final states
    const pendingStatuses = ['sent', 'viewed', 'document_created'];
    
    const pendingRecords = await DigioSign.find({
      status: { $in: pendingStatuses },
      documentId: { $exists: true, $ne: null },
      // Only check documents created in the last 30 days (avoid checking very old documents)
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    }).limit(50); // Limit to 50 documents per run to avoid API rate limits
    
    console.log(`[DIGIO_CRON] Found ${pendingRecords.length} pending documents to check`);
    
    let updatedCount = 0;
    let errorCount = 0;
    
    // Process documents sequentially to avoid overwhelming the API
    for (const record of pendingRecords) {
      try {
        const apiResponse = await checkDocumentStatus(record);
        
        if (apiResponse) {
          const updated = await updateRecordFromApiResponse(record, apiResponse);
          if (updated) {
            updatedCount++;
          }
        }
        
        // Small delay to be respectful to the API
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`[DIGIO_CRON] Error processing record ${record._id}:`, error);
        errorCount++;
      }
    }
    
    console.log(`[DIGIO_CRON] Completed. Updated: ${updatedCount}, Errors: ${errorCount}`);
    
    return {
      success: true,
      checked: pendingRecords.length,
      updated: updatedCount,
      errors: errorCount,
      timestamp: new Date()
    };
    
  } catch (error) {
    console.error('[DIGIO_CRON] Error in checkPendingDocuments:', error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date()
    };
  }
}

/**
 * Start the cron job
 */
function startCronJob() {
  // Run every 15 minutes: 0 */15 * * * *
  const cronExpression = '0 */15 * * * *';
  
  console.log(`[DIGIO_CRON] Starting cron job with expression: ${cronExpression}`);
  
  const task = cron.schedule(cronExpression, async () => {
    console.log('[DIGIO_CRON] Executing scheduled document status check');
    await checkPendingDocuments();
  }, {
    scheduled: false,
    timezone: "Asia/Kolkata" // Adjust timezone as needed
  });
  
  // Start the task
  task.start();
  
  console.log('[DIGIO_CRON] Cron job started successfully');
  
  return task;
}

/**
 * Stop the cron job
 */
function stopCronJob(task) {
  if (task) {
    task.stop();
    console.log('[DIGIO_CRON] Cron job stopped');
  }
}

/**
 * Run document check manually (for testing)
 */
async function runManualCheck() {
  console.log('[DIGIO_CRON] Running manual document status check...');
  return await checkPendingDocuments();
}

module.exports = {
  startCronJob,
  stopCronJob,
  runManualCheck,
  checkPendingDocuments,
  checkDocumentStatus
};
