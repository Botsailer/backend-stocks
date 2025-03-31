// config/transporterConfig.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.example.com', // e.g., smtp.gmail.com
  port: process.env.EMAIL_PORT || 587, // use 465 for secure
  secure: process.env.EMAIL_PORT == 465, // true if port is 465
  
  tls: {
    ciphers: 'SSLv3',
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
    console.error('Error configuring transporter:', error);
  } else {
    console.log('Transporter is configured and ready to send emails');
  }
});

module.exports = transporter;
