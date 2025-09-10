// config/transporterConfig.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.example.com', // e.g., smtp.gmail.com
  port: process.env.EMAIL_PORT || 587, // use 465 for secure
  secure: process.env.EMAIL_PORT == 465, // true if port is 465

  tls: {
    ciphers: 'SSLv3',
    rejectUnauthorized: false // Add this to handle certificate issues
  },
  debug: true,
  auth: {
    user: process.env.EMAIL_USER || 'user@example.com',
    pass: process.env.EMAIL_PASS || 'password'
  }
});

// Verify transporter configuration
transporter.verify((error, success) => {
  if (error) {
    console.error('SMTP Error: Invalid login credentials or configuration');
    console.error('Error details:', error.message);
    console.error('Please check your EMAIL_USER and EMAIL_PASS in .env file');
    console.error('For Zoho Mail, you might need to:');
    console.error('1. Enable 2FA and generate an app password');
    console.error('2. Use the app password instead of your regular password');
    console.error('3. Check if your account is locked or suspended');
  } else {
    console.log('✅ SMTP transporter is configured and ready to send emails');
  }
});

module.exports = transporter;
