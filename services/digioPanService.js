const { getConfig } = require('../utils/configSettings');
const axios = require('axios');

async function digioPanVerify({ id_no, name, dob }) {
  if (!id_no || !name || !dob) {
    throw new Error('id_no, name, and dob are required');
  }

  const pan = id_no.toUpperCase();
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    const err = new Error('INVALID_PAN_FORMAT');
    err.code = 'INVALID_PAN_FORMAT';
    throw err;
  }

  // Convert date format from DD-MM-YYYY to DD/MM/YYYY if needed
  let formattedDob = dob;
  if (dob.includes('-')) {
    formattedDob = dob.replace(/-/g, '/');
  }

  // Handle YYYY/MM/DD format and convert to DD/MM/YYYY
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(formattedDob)) {
    const parts = formattedDob.split('/');
    formattedDob = `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  // Validate the date format (DD/MM/YYYY)
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(formattedDob)) {
    const err = new Error('INVALID_DOB_FORMAT');
    err.code = 'INVALID_DOB_FORMAT';
    throw err;
  }

  const DIGIO_BASE_URL = await getConfig('DIGIO_API_BASE', 'https://ext.digio.in:444');
  const DIGIO_PAN_ENDPOINT = await getConfig('DIGIO_PAN_ENDPOINT', '/v3/client/kyc/fetch_id_data/PAN');
  const DIGIO_CLIENT_ID = await getConfig('DIGIO_CLIENT_ID');
  const DIGIO_CLIENT_SECRET = await getConfig('DIGIO_CLIENT_SECRET');

  if (!DIGIO_CLIENT_ID || !DIGIO_CLIENT_SECRET) {
    const err = new Error('Digio API credentials not found');
    err.code = 'CREDENTIALS_MISSING';
    throw err;
  }

  const basicAuth = Buffer.from(`${DIGIO_CLIENT_ID}:${DIGIO_CLIENT_SECRET}`).toString('base64');

  const payload = {
    id_no: pan,
    name,
    dob: formattedDob,
    unique_request_id: `REQ_${Date.now()}`
  };

  const url = `${DIGIO_BASE_URL}${DIGIO_PAN_ENDPOINT}`;

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      timeout: 20000,
      validateStatus: s => s < 500
    });


    if (response.status >= 400) {
      const err = new Error('PAN_VERIFY_FAILED');
      err.code = response.data?.code || 'API_REQUEST_FAILED';
      err.data = response.data;
      err.status = response.status;
      throw err;
    }

    return response.data;
  } catch (error) {
    console.log(error);
    // Pass through specific digio config error as-is for callers to map
    throw error;
  }
}

module.exports = { digioPanVerify }; 