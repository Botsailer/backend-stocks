const winston = require('winston');
const { sendEmail } = require('./emailServices');

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: 'logs/email-queue.log',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 7
    })
  ]
});

class EmailQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.retryAttempts = 3;
    this.retryDelay = 5000; // 5 seconds
    
    // Start processing emails immediately
    this.processQueue();
  }

  /**
   * Add email to queue
   */
  async addEmail(emailData, priority = 'normal', maxRetries = 3) {
    const queueItem = {
      id: Date.now() + Math.random(),
      ...emailData,
      priority,
      maxRetries,
      retryCount: 0,
      addedAt: new Date(),
      status: 'pending'
    };

    // Add to queue based on priority
    if (priority === 'high') {
      this.queue.unshift(queueItem);
    } else {
      this.queue.push(queueItem);
    }

    logger.info('Email added to queue', {
      id: queueItem.id,
      to: emailData.to,
      subject: emailData.subject,
      priority,
      queueLength: this.queue.length
    });

    // Start processing if not already processing
    if (!this.processing) {
      this.processQueue();
    }

    return queueItem.id;
  }

  /**
   * Add bill email to queue with high priority
   */
  async addBillEmail(user, subscription, billData) {
    const { COMPANY_INFO } = require('../config/billConfig');
    
    const subject = `Invoice ${billData.billNumber} - ${COMPANY_INFO.name}`;
    const htmlContent = this.generateBillEmailHTML(billData, subscription);
    const textContent = this.generateBillEmailText(billData, subscription);

    return this.addEmail({
      to: user.email,
      subject,
      text: textContent,
      html: htmlContent,
      type: 'bill',
      userId: user._id,
      subscriptionId: subscription._id,
      billNumber: billData.billNumber
    }, 'high', 5); // High priority, max 5 retries for bills
  }

  /**
   * Add telegram invite email to queue
   */
  async addTelegramEmail(user, product, inviteLinks, expiresAt) {
    const subject = `🎉 Welcome! Your Telegram Group Access is Ready`;
    const htmlContent = this.generateTelegramEmailHTML(user, product, inviteLinks, expiresAt);
    const textContent = this.generateTelegramEmailText(user, product, inviteLinks, expiresAt);

    return this.addEmail({
      to: user.email,
      subject,
      text: textContent,
      html: htmlContent,
      type: 'telegram',
      userId: user._id,
      productType: product.type,
      productId: product.id
    }, 'high', 3);
  }

  /**
   * Process email queue
   */
  async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    logger.info('Starting email queue processing', { queueLength: this.queue.length });

    while (this.queue.length > 0) {
      const emailItem = this.queue.shift();
      
      try {
        await this.sendEmailWithRetry(emailItem);
      } catch (error) {
        logger.error('Failed to process email after all retries', {
          id: emailItem.id,
          to: emailItem.to,
          subject: emailItem.subject,
          error: error.message
        });
      }

      // Small delay between emails to avoid overwhelming SMTP server
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    this.processing = false;
    logger.info('Email queue processing completed');
  }

  /**
   * Send email with retry logic
   */
  async sendEmailWithRetry(emailItem) {
    emailItem.status = 'processing';
    
    for (let attempt = 0; attempt <= emailItem.maxRetries; attempt++) {
      try {
        logger.info('Attempting to send email', {
          id: emailItem.id,
          to: emailItem.to,
          attempt: attempt + 1,
          maxRetries: emailItem.maxRetries + 1
        });

        const result = await sendEmail(
          emailItem.to,
          emailItem.subject,
          emailItem.text,
          emailItem.html
        );

        // Check if email service returned an error (production mode)
        if (result && result.error) {
          throw new Error(result.error);
        }

        emailItem.status = 'sent';
        emailItem.sentAt = new Date();
        
        logger.info('Email sent successfully', {
          id: emailItem.id,
          to: emailItem.to,
          subject: emailItem.subject,
          attempt: attempt + 1
        });

        return result;

      } catch (error) {
        emailItem.retryCount = attempt + 1;
        emailItem.lastError = error.message;
        
        logger.warn('Email send attempt failed', {
          id: emailItem.id,
          to: emailItem.to,
          attempt: attempt + 1,
          error: error.message
        });

        // If this is not the last attempt, wait before retrying
        if (attempt < emailItem.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt); // Exponential backoff
          logger.info('Retrying email after delay', {
            id: emailItem.id,
            delay: delay,
            nextAttempt: attempt + 2
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    emailItem.status = 'failed';
    emailItem.failedAt = new Date();
    throw new Error(`Failed to send email after ${emailItem.maxRetries + 1} attempts: ${emailItem.lastError}`);
  }

  /**
   * Generate bill email HTML
   */
  generateBillEmailHTML(billData, subscription) {
    const { COMPANY_INFO } = require('../config/billConfig');
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Invoice ${billData.billNumber}</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
          .email-container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; box-shadow: 0 0 20px rgba(0,0,0,0.1); overflow: hidden; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 28px; }
          .content { padding: 30px; }
          .invoice-info { background: #f8f9ff; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .invoice-info h3 { margin: 0 0 15px 0; color: #667eea; }
          .amount-highlight { font-size: 24px; font-weight: bold; color: #28a745; text-align: center; margin: 20px 0; }
          .status-paid { background: #d4edda; color: #155724; padding: 10px 20px; border-radius: 20px; display: inline-block; font-weight: 600; }
          .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; }
          .cta-button { background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 15px 0; }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <h1>Thank You for Your Purchase!</h1>
            <p>Your subscription is now active</p>
          </div>
          
          <div class="content">
            <h2>Hello ${billData.customerDetails.name}!</h2>
            <p>Thank you for subscribing to our premium service. Your payment has been successfully processed and your subscription is now active.</p>
            
            <div class="invoice-info">
              <h3>📄 Invoice Details</h3>
              <p><strong>Invoice Number:</strong> ${billData.billNumber}</p>
              <p><strong>Date:</strong> ${billData.billDate.toLocaleDateString('en-IN')}</p>
              <p><strong>Subscription:</strong> ${billData.items[0].description}</p>
              <p><strong>Plan Type:</strong> ${subscription.planType || 'Monthly'}</p>
            </div>
            
            <div class="amount-highlight">
              Total Paid: ₹${billData.totalAmount.toLocaleString('en-IN')}
            </div>
            
            <div style="text-align: center; margin: 20px 0;">
              <span class="status-paid">✅ PAYMENT CONFIRMED</span>
            </div>
            
            <div style="background: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin: 0 0 10px 0; color: #28a745;">🎉 What's Next?</h3>
              <p style="margin: 0;">Your subscription is now active! You'll receive separate emails with access to your premium content and Telegram groups.</p>
            </div>
            
            <p>If you have any questions about your subscription or need support, please don't hesitate to contact us.</p>
          </div>
          
          <div class="footer">
            <p><strong>${COMPANY_INFO.name}</strong></p>
            <p>${COMPANY_INFO.email} | ${COMPANY_INFO.phone}</p>
            <p>This is an automated email. Please do not reply directly to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate bill email text version
   */
  generateBillEmailText(billData, subscription) {
    const { COMPANY_INFO } = require('../config/billConfig');
    
    return `
THANK YOU FOR YOUR PURCHASE!

Hello ${billData.customerDetails.name},

Thank you for subscribing to our premium service. Your payment has been successfully processed.

INVOICE DETAILS:
- Invoice Number: ${billData.billNumber}
- Date: ${billData.billDate.toLocaleDateString('en-IN')}
- Subscription: ${billData.items[0].description}
- Plan Type: ${subscription.planType || 'Monthly'}
- Total Paid: ₹${billData.totalAmount.toLocaleString('en-IN')}

✅ PAYMENT CONFIRMED - SUBSCRIPTION ACTIVE

Your subscription is now active! You'll receive separate emails with access to your premium content and Telegram groups.

If you have any questions, please contact us at ${COMPANY_INFO.email}

${COMPANY_INFO.name}
${COMPANY_INFO.phone}
    `;
  }

  /**
   * Generate telegram email HTML
   */
  generateTelegramEmailHTML(user, product, inviteLinks, expiresAt) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Your Telegram Access is Ready!</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
          .email-container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; box-shadow: 0 0 20px rgba(0,0,0,0.1); overflow: hidden; }
          .header { background: linear-gradient(135deg, #0088cc 0%, #0066aa 100%); color: white; padding: 30px; text-align: center; }
          .content { padding: 30px; }
          .invite-link { background: #f8f9fa; border: 2px solid #0088cc; border-radius: 8px; padding: 20px; margin: 15px 0; text-align: center; }
          .invite-button { background: #0088cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0; }
          .warning-box { background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px; padding: 15px; margin: 20px 0; }
          .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <h1>🎉 Welcome to the Community!</h1>
            <p>Your exclusive Telegram access is ready</p>
          </div>
          
          <div class="content">
            <h2>Hello ${user.fullName || user.username}!</h2>
            <p>Congratulations! Your subscription is active and you now have access to our exclusive Telegram community.</p>
            
            ${inviteLinks.map(invite => `
              <div class="invite-link">
                <h3>📱 ${invite.name}</h3>
                <p>${invite.description || 'Exclusive content and discussions'}</p>
                <a href="${invite.link}" class="invite-button">Join Group</a>
              </div>
            `).join('')}
            
            <div class="warning-box">
              <p><strong>⚠️ Important:</strong> These invite links will expire on ${expiresAt.toLocaleDateString()}. Please join the groups as soon as possible.</p>
            </div>
            
            <h3>📋 What to Expect:</h3>
            <ul>
              <li>Real-time market updates and insights</li>
              <li>Exclusive trading tips and strategies</li>
              <li>Direct interaction with our expert team</li>
              <li>Community discussions with fellow investors</li>
            </ul>
            
            <p>If you have any issues joining the groups, please contact our support team.</p>
          </div>
          
          <div class="footer">
            <p>Need help? Contact us at support@yourcompany.com</p>
            <p>This is an automated email. Please do not reply directly to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate telegram email text version
   */
  generateTelegramEmailText(user, product, inviteLinks, expiresAt) {
    return `
🎉 WELCOME TO THE COMMUNITY!

Hello ${user.fullName || user.username},

Your subscription is active and you now have access to our exclusive Telegram community.

TELEGRAM GROUPS:
${inviteLinks.map(invite => `
- ${invite.name}
  ${invite.description || 'Exclusive content and discussions'}
  Join: ${invite.link}
`).join('')}

⚠️ IMPORTANT: These invite links will expire on ${expiresAt.toLocaleDateString()}. Please join as soon as possible.

WHAT TO EXPECT:
- Real-time market updates and insights
- Exclusive trading tips and strategies  
- Direct interaction with our expert team
- Community discussions with fellow investors

If you have any issues joining the groups, please contact our support team.

Need help? Contact us at support@yourcompany.com
    `;
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      pendingEmails: this.queue.filter(item => item.status === 'pending').length,
      processingEmails: this.queue.filter(item => item.status === 'processing').length
    };
  }
}

// Export singleton instance
module.exports = new EmailQueue();
