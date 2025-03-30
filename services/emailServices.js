// services/emailService.js
const transporter = require('../config/SMTP');

exports.sendResetPasswordEmail = async (toEmail, resetUrl) => {
  const mailOptions = {
    from: '"Backend-App" <auth@therobobox.co>',
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
