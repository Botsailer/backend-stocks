// Simple persistent counter for API requests
// Stores count in a file (api-request-count.json) in the project root
const fs = require('fs');
const path = require('path');
// Always store the counter file in the project root
const COUNTER_FILE = path.join('api-request-count.json');

function loadCount() {
  try {
    if (fs.existsSync(COUNTER_FILE)) {
      const data = fs.readFileSync(COUNTER_FILE, 'utf8');
      const obj = JSON.parse(data);
      if (typeof obj.count === 'number') return obj.count;
    }
  } catch (e) {
    // ignore
  }
  return 0;
}

function saveCount(count) {
  try {
    fs.writeFileSync(COUNTER_FILE, JSON.stringify({ count }), 'utf8');
  } catch (e) {
    // ignore
    }
}


let apiRequestCount = loadCount();
// Ensure the counter file exists on startup
saveCount(apiRequestCount);

function increment() {
  apiRequestCount++;
  saveCount(apiRequestCount);
  // Debug log to verify increment is called and file is written
  console.log(`[API-COUNTER] Incremented: ${apiRequestCount} (file: ${COUNTER_FILE})`);
}

function getCount() {
  return apiRequestCount;
}

module.exports = { increment, getCount };
