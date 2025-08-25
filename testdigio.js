// require("dotenv").config();
// const axios = require("axios");

// const DIGIO_BASE_URL = process.env.DIGIO_BASE_URL || "https://ext.digio.in:444";
//  const DIGIO_CLIENT_ID = "ACK250822145829925ULO85C3Z5XPOMF";
//   const DIGIO_CLIENT_SECRET = "8N5G797F4IVSKDCGUUS5PCCWW1425Z3I";
  
// // Basic Auth header
// const auth = Buffer.from(`${DIGIO_CLIENT_ID}:${DIGIO_CLIENT_SECRET}`).toString("base64");

// async function testPAN() {
//   try {
//     const payload = {
//       pan_no: "ABCDE1234F",        // replace with a valid PAN for testing
//       full_name: "Test User",      // replace with PAN holder name
//       date_of_birth: "1990-07-05"  // YYYY-MM-DD
//     };

//     const { data } = await axios.post(
//       `${DIGIO_BASE_URL}/v3/client/kyc/pan/verify`,
//       payload,
//       {
//         headers: {
//           Authorization: `Basic ${auth}`,
//           "Content-Type": "application/json"
//         }
//       }
//     );

//     console.log("Response:", data);
//   } catch (err) {
//     if (err.response) {
//       console.log("Error:", err.response.status, err.response.data);
//     } else {
//       console.log("Error:", err.message);
//     }
//   }
// }

// testPAN();
