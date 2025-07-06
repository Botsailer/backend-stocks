const nodemailer = require('nodemailer');
const { getSmtpConfig, getConfig } = require('../utils/configSettings');

// Function to create/update transporter with current config
let config = {};
async function createTransporter() {
 config = await getSmtpConfig();
  receiveemailat = config?.receiveemailat
  return nodemailer.createTransport({
    host: config.host,
    port: Number(config.port),
    secure: Number(config.port) === 465,
    auth: {
      user: config.user,
      pass: config.pass
    },
    connectionTimeout: 10000,
    // tls: {
    //   rejectUnauthorized: false
    // },
    debug: true
  });
}

/**
 * Send an email using the configured SMTP settings
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} text - Plain text body
 * @param {string} html - HTML body (optional)
 */
exports.sendEmail = async (to, subject, text, html) => {
  try {
    const transporter = await createTransporter();
    
    const mailOptions = {
      from: `"Stock Portfolio" <${(await getSmtpConfig()).user}>`,
      to,
      subject,
      text,
      html: html || text
    };

    return await transporter.sendMail(mailOptions);
    transporter.close(); // Close the transporter after sending
  } catch (error) {
    console.error('Error sending email:', error);
    
    // Log more details for troubleshooting
    if (process.env.NODE_ENV === 'development') {
      console.log('Mail options:', {
        to,
        subject,
        config: await getSmtpConfig()
      });
    }
    
    // Don't throw the error in production to prevent app crashes
    if (process.env.NODE_ENV === 'production') {
      return { error: 'Failed to send email', success: false };
    } else {
      throw error; // Still throw in development for debugging
    }
  }
};
// Other email helpers like sendVerificationEmail, sendResetPasswordEmail, etc.
exports.sendVerificationEmail = async (to, verifyUrl) => {
  const subject = 'Verify Your Email Address';
  const text = `Please verify your email address by clicking this link: ${verifyUrl}`;
  const html = `
    <div style="max-width:600px; margin:0 auto; padding:20px; font-family:sans-serif;">
      <h2 style="color:#4a77e5;">Verify Your Email Address</h2>
      <p>To verify your email address, please click the button below:</p>
      <div style="margin:30px 0;">
        <a href="${verifyUrl}" style="background-color:#4a77e5; color:white; padding:10px 20px; text-decoration:none; border-radius:5px; display:inline-block;">Verify Email</a>
      </div>
      <p>Or copy and paste this link in your browser:</p>
      <p>${verifyUrl}</p>
      <p>This link will expire in 1 hour.</p>
    </div>
  `;
  
  return await exports.sendEmail(to , subject, text, html);
};

exports.sendContactUsEmail = async (name, email, askingabout , represent ,message) => {
  // Get config inside the function
  const smtpConfig = await getSmtpConfig();
  const receiveemailat = smtpConfig?.receiveemailat;
  console.log('SMTP Config:', smtpConfig);
  if (!receiveemailat) {
    throw new Error('Receive email address is not configured');
  }
  
  const subject = `Contact Us Message from ${name}`;
  const text = `You have received a new message from ${name} (${email}):\n\n${message}`;
  const html = `
    <div style="max-width:600px; margin:0 auto; padding:20px; font-family:sans-serif;">
      <h2 style="color:#4a77e5;">New Contact Us Message</h2>
      <p>You have received a new message from <strong>${name}</strong> (${email}):</p>
      <p><strong>Asking About:</strong> ${askingabout || 'N/A'}</p>
      <p><strong>I Represent:</strong> ${represent || 'N/A'}</p>
      <p style="font-weight:bold; color:#333;">Message:</p>
      <p style="white-space:pre-wrap;">${message}</p>
      <p>Do Not Reply to this email to respond to the sender It wont be reaching user.</p>
    </div>
  `;
  
  return await exports.sendEmail(receiveemailat, subject, text, html);
};

exports.sendResetPasswordEmail = async (to, resetUrl) => {
  const subject = 'Reset Your Password';
  const text = `To reset your password, please click this link: ${resetUrl}`;
  const html = `
    <div style="max-width:600px; margin:0 auto; padding:20px; font-family:sans-serif;">
      <h2 style="color:#4a77e5;">Reset Your Password</h2>
      <p>To reset your password, please click the button below:</p>
      <div style="margin:30px 0;">
        <a href="${resetUrl}" style="background-color:#4a77e5; color:white; padding:10px 20px; text-decoration:none; border-radius:5px; display:inline-block;">Reset Password</a>
      </div>
      <p>Or copy and paste this link in your browser:</p>
      <p>${resetUrl}</p>
      <p>This link will expire in 1 hour.</p>
      <p>If you didn't request this, please ignore this email.</p>
    </div>
  `;
  
  return await exports.sendEmail(to, subject, text, html);
};


exports.verifySmtpConfig = async () => {
  try {
  
    const transporter = await createTransporter();
    transporter.close();
    return transporter.verify();
  } catch (error) {
    console.error('SMTP configuration error:', error);
    throw new Error('Failed to verify SMTP configuration');
  }
} 
