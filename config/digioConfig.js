// Digio Configuration
module.exports = {
  // Environment settings
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
  
  // API endpoints
  apiBase: {
    sandbox: 'https://ext.digio.in:444',
    production: 'https://ext.digio.in:444'
  },
  
  // Template configuration
  template: {
    defaultId: process.env.DIGIO_TEMPLATE_ID || 'TMP25083108440494195SS3J7UVAZ8BR',
    signCoordinates: {
      default: {
        "1": [{
          llx: 181.99970713317074,
          lly: 496.001598402815,
          urx: 318.99104879757715,
          ury: 517.9997575993099
        }]
      }
    }
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