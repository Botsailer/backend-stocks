/**
 * controllers/adminNotificationController.js
 * ------------------------------------------
 * Manages sending notification emails to portfolio subscribers
 */
const Subscription = require('../models/subscription');
const User = require('../models/user');
const { getSmtpConfig } = require('../utils/configSettings');
const nodemailer = require('nodemailer');

/**
 * Send notifications to all active subscribers of a portfolio
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
exports.sendNotifications = async (req, res) => {
    try {
        const { portfolioId, subject, message } = req.body;
        
        if (!portfolioId || !subject || !message) {
            return res.status(400).json({ error: 'portfolioId, subject, and message are required' });
        }
        
        // Find active subscribers
        const subs = await Subscription.find({ 
            portfolio: portfolioId, 
            isActive: true 
        }).populate('user', 'email');
        
        if (!subs.length) {
            return res.status(404).json({ error: 'No active subscribers found' });
        }
        
        // Get SMTP config from database (falls back to env variables)
        const smtpConfig = await getSmtpConfig();
        
        // Configure mail transporter using database settings
        const transporter = nodemailer.createTransport({
            host: smtpConfig.host,
            port: smtpConfig.port,
            secure: smtpConfig.port === 465, // true for port 465
            auth: {
                user: smtpConfig.user,
                pass: smtpConfig.pass
            }
        });
        
        // Send emails in parallel
        await Promise.all(subs.map(s => {
            return transporter.sendMail({
                from: `"Portfolio Service" <${smtpConfig.user}>`,
                to: s.user.email,
                subject,
                text: message,
             
                html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #4a77e5;">${subject}</h2>
                    <p style="line-height: 1.5;">${message.replace(/\n/g, '<br>')}</p>
                </div>`
            });
        }));
        
        res.json({ 
            success: true, 
            mailedTo: subs.length,
            emailsSent: subs.map(s => s.user.email)
        });
    } catch (err) {
        console.error('Error sending notifications:', err);
        res.status(500).json({ error: `Failed to send notifications: ${err.message}` });
    }
};