const nodemailer = require('nodemailer');
const { getSmtpConfig } = require('../utils/configSettings');

// Function to create/update transporter with current config
async function createTransporter() {
  const config = await getSmtpConfig();
  
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465, // true for 465, false for other ports
    auth: {
      user: config.user,
      pass: config.pass
    }
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
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
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
  
  return await exports.sendEmail(to, subject, text, html);
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