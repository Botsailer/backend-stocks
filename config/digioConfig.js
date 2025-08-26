// Digio Configuration
module.exports = {
  // Environment settings
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
  
  // API endpoints
  apiBase: {
    sandbox: 'https://ext-gateway.digio.in',
    production: 'https://app.digio.in'
  },
  
  // SDK settings
  sdk: {
    version: 'v11',
    theme: {
      primaryColor: '#007bff',
      secondaryColor: '#000000'
    }
  },
  
  // Document settings
  document: {
    expireInDays: 7,
    sendSignLink: false, // Using SDK instead
    embeddedSigning: true
  },
  
  // E-mandate specific settings
  emandate: {
    reason: 'E-Mandate Consent for Subscription',
    signPage: 'all',
    maxAmount: 50000 // Maximum debit amount limit
  }
};