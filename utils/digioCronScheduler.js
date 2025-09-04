const cron = require('node-cron');
const { syncPendingDocuments } = require('../services/digioWebhookService');

/**
 * Digio Document Status Sync Cron Job
 * Runs every 15 minutes to check and update document statuses
 */

let cronJob = null;
let isRunning = false;

/**
 * Start the cron job
 */
function startCronJob() {
  if (cronJob) {
    console.log('[DIGIO_CRON] Cron job already running');
    return;
  }

  // Run every 15 minutes: 0,15,30,45 minutes of every hour
  cronJob = cron.schedule('0,15,30,45 * * * *', async () => {
    if (isRunning) {
      console.log('[DIGIO_CRON] Previous sync still running, skipping...');
      return;
    }

    isRunning = true;
    console.log('[DIGIO_CRON] Starting scheduled document sync...');

    try {
      const result = await syncPendingDocuments();
      console.log(`[DIGIO_CRON] Sync completed: ${result.processed} processed, ${result.updated} updated, ${result.errors} errors`);
    } catch (error) {
      console.error('[DIGIO_CRON] Sync failed:', error);
    } finally {
      isRunning = false;
    }
  }, {
    scheduled: false, // Don't start immediately
    timezone: "Asia/Kolkata" // Adjust timezone as needed
  });

  cronJob.start();
  console.log('[DIGIO_CRON] Document sync cron job started (every 15 minutes)');
}

/**
 * Stop the cron job
 */
function stopCronJob() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[DIGIO_CRON] Document sync cron job stopped');
  }
}

/**
 * Get cron job status
 */
function getCronStatus() {
  return {
    isScheduled: !!cronJob,
    isRunning,
    schedule: 'Every 15 minutes (0,15,30,45 * * * *)',
    timezone: 'Asia/Kolkata',
    nextRun: cronJob ? 'Next quarter hour' : 'Not scheduled'
  };
}

/**
 * Manual trigger for testing
 */
async function runManualSync() {
  if (isRunning) {
    throw new Error('Sync already running');
  }

  isRunning = true;
  try {
    console.log('[DIGIO_CRON] Running manual sync...');
    const result = await syncPendingDocuments();
    console.log(`[DIGIO_CRON] Manual sync completed: ${result.processed} processed, ${result.updated} updated, ${result.errors} errors`);
    return result;
  } finally {
    isRunning = false;
  }
}

module.exports = {
  startCronJob,
  stopCronJob,
  getCronStatus,
  runManualSync
};
