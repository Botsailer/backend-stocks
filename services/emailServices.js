// services/emailService.js
const transporter = require('../config/SMTP');

const from = process.env.EMAIL_USER

exports.sendResetPasswordEmail = async (toEmail, resetUrl) => {
  const mailOptions = {
    from: `"Backend-App" <${from}>`,
    to: toEmail,
    subject: 'Password Reset Request',
    html: `
      <p>You requested a password reset.</p>
      <p>Please click on the following link to reset your password:</p>
      <p><a href="${resetUrl}" style="color: #007bff;">Reset Password</a></p>
      <p>If you did not request this, please ignore this email.</p>
    `,
  };

  try {
    console.log('Sending email to:', toEmail);
    console.log('Reset URL:', resetUrl);
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent: ', info.response);
    return info;
  } catch (err) {
    console.error('Error sending email: ', err);
    throw err;
  }
};


exports.sendVerificationEmail = async (toEmail, verificationUrl) => {
    const mailOptions = {
    
    from: `"Backend-App" <${from}>`,
    to: toEmail,
    subject: 'Email Verification',
    html: `
      <p>Thank you for signing up!</p>
      <p>Please click on the following link to verify your email address:</p>
      <p><a href="${verificationUrl}" style="color: #007bff;">Verify Email</a></p>
      <p>If you did not sign up, please ignore this email.</p>
    `,
    };
    try {
        console.log('Sending verification email to:', toEmail);
        console.log('Verification URL:', verificationUrl);
        const info = await transporter.sendMail(mailOptions);
        console.log('Verification email sent: ', info.response);
        return info;
    }
    catch (err) {
        console.error('Error sending verification email: ', err);
        throw err;
    }
}
