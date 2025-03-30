// config/transporterConfig.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.example.com',
  port: process.env.EMAIL_PORT || 587,
  secure: process.env.EMAIL_PORT == 465,
  tls: {
    // You might try removing or updating this option
    ciphers: 'SSLv3'
  },
  debug: true,
  logger: true,
  auth: {
    user: process.env.EMAIL_USER || 'user@example.com',
    pass: process.env.EMAIL_PASS || 'password'
  }
});


// Verify transporter configuration
transporter.verify((error, success) => {
  if (error) {
    console.error('Error configuring transporter:', error);
  } else {
    console.log('Transporter is configured and ready to send emails');
  }
});

module.exports = transporter;
