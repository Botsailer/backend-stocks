const Bill = require('../models/bill');
const Subscription = require('../models/subscription');
const Portfolio = require('../models/modelPortFolio');
const Bundle = require('../models/bundle');
const { sendEmail } = require('./emailServices');
const { COMPANY_INFO, TAX_RATE, BILL_DUE_DAYS } = require('../config/billConfig');
const winston = require('winston');
const fs = require('fs');
const path = require('path');
const { generateSimplePDF } = require('../utils/simplePDF');

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/bill-service.log' })
  ]
});

/**
 * Generate bill for a subscription
 */
async function generateBill(subscriptionId, paymentDetails = {}) {
  try {
    logger.info('Starting bill generation', { subscriptionId });

    // Fetch subscription with populated data
    const subscription = await Subscription.findById(subscriptionId)
      .populate('user')
      .populate('productId')
      .populate('portfolio')
      .populate('bundleId');

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    // Check if bill already exists for this subscription
    const existingBill = await Bill.findOne({ 
      subscription: subscriptionId,
      paymentId: paymentDetails.paymentId 
    });

    if (existingBill) {
      logger.info('Bill already exists', { billId: existingBill._id });
      return existingBill;
    }

    // Prepare customer details
    const customerDetails = {
      name: subscription.user.fullName || subscription.user.username,
      email: subscription.user.email,
      phone: subscription.user.phone || '',
      panDetails: subscription.user.pandetails || ''
    };

    // Prepare bill items
    const items = [];
    let subtotal = 0;

    if (subscription.productType === 'Bundle' && subscription.bundleId) {
      // Bundle subscription
      const bundle = subscription.bundleId;
      const description = `${bundle.name} - ${subscription.planType} subscription`;
      
      items.push({
        description,
        productType: 'Bundle',
        productId: bundle._id,
        planType: subscription.planType,
        quantity: 1,
        unitPrice: subscription.amount,
        totalPrice: subscription.amount
      });
      subtotal += subscription.amount;

    } else if (subscription.productType === 'Portfolio' && subscription.portfolio) {
      // Portfolio subscription
      const portfolio = subscription.portfolio;
      const description = `${portfolio.portfolioName} - ${subscription.planType} subscription`;
      
      items.push({
        description,
        productType: 'Portfolio',
        productId: portfolio._id,
        planType: subscription.planType,
        quantity: 1,
        unitPrice: subscription.amount,
        totalPrice: subscription.amount
      });
      subtotal += subscription.amount;

    } else {
      throw new Error('Invalid subscription product type or missing product data');
    }

    // Calculate tax
    const taxAmount = Math.round((subtotal * TAX_RATE) / 100);
    const totalAmount = subtotal + taxAmount;

    // Create bill
    const billData = {
      user: subscription.user._id,
      subscription: subscription._id,
      billDate: new Date(),
      dueDate: new Date(Date.now() + BILL_DUE_DAYS * 24 * 60 * 60 * 1000),
      customerDetails,
      items,
      subtotal,
      taxRate: TAX_RATE,
      taxAmount,
      totalAmount,
      paymentId: paymentDetails.paymentId || null,
      orderId: paymentDetails.orderId || null,
      paymentStatus: paymentDetails.paymentId ? 'paid' : 'pending',
      paymentDate: paymentDetails.paymentId ? new Date() : null,
      status: paymentDetails.paymentId ? 'paid' : 'sent',
      isRenewal: subscription.isRenewal || false
    };

    const bill = new Bill(billData);
    await bill.save();

    logger.info('Bill generated successfully', { 
      billId: bill._id, 
      billNumber: bill.billNumber,
      totalAmount: bill.totalAmount 
    });

    return bill;

  } catch (error) {
    logger.error('Error generating bill', { 
      subscriptionId, 
      error: error.message, 
      stack: error.stack 
    });
    throw error;
  }
}

/**
 * Generate HTML bill template
 */
function generateBillHTML(bill) {
  const formatCurrency = (amount) => `₹${amount.toLocaleString('en-IN')}`;
  const formatDate = (date) => new Date(date).toLocaleDateString('en-IN');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Invoice ${bill.billNumber}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #333; }
        .invoice-container { max-width: 800px; margin: 0 auto; background: white; }
        .header { border-bottom: 3px solid #4a77e5; padding-bottom: 20px; margin-bottom: 30px; }
        .company-info { float: left; width: 50%; }
        .invoice-info { float: right; width: 45%; text-align: right; }
        .company-name { font-size: 24px; font-weight: bold; color: #4a77e5; margin-bottom: 10px; }
        .invoice-title { font-size: 28px; font-weight: bold; color: #4a77e5; margin-bottom: 10px; }
        .clearfix::after { content: ""; display: table; clear: both; }
        .customer-info { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .bill-to { font-weight: bold; color: #4a77e5; margin-bottom: 10px; }
        .items-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .items-table th, .items-table td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        .items-table th { background: #4a77e5; color: white; font-weight: bold; }
        .items-table .amount { text-align: right; }
        .totals { float: right; width: 300px; margin-top: 20px; }
        .totals table { width: 100%; }
        .totals td { padding: 8px; border-bottom: 1px solid #ddd; }
        .totals .total-row { font-weight: bold; font-size: 18px; background: #f8f9fa; }
        .payment-info { background: #e8f5e8; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; }
        .status-badge { 
          display: inline-block; 
          padding: 5px 15px; 
          border-radius: 20px; 
          font-size: 12px; 
          font-weight: bold; 
          text-transform: uppercase;
        }
        .status-paid { background: #d4edda; color: #155724; }
        .status-pending { background: #fff3cd; color: #856404; }
      </style>
    </head>
    <body>
      <div class="invoice-container">
        <!-- Header -->
        <div class="header clearfix">
          <div class="company-info">
            <div class="company-name">${COMPANY_INFO.name}</div>
            <div>${COMPANY_INFO.address}</div>
            <div>${COMPANY_INFO.city}, ${COMPANY_INFO.state} ${COMPANY_INFO.pincode}</div>
            <div>${COMPANY_INFO.country}</div>
            <div>Phone: ${COMPANY_INFO.phone}</div>
            <div>Email: ${COMPANY_INFO.email}</div>
            <div>GSTIN: ${COMPANY_INFO.gstin}</div>
          </div>
          <div class="invoice-info">
            <div class="invoice-title">INVOICE</div>
            <div><strong>Invoice #:</strong> ${bill.billNumber}</div>
            <div><strong>Date:</strong> ${formatDate(bill.billDate)}</div>
            <div><strong>Due Date:</strong> ${formatDate(bill.dueDate)}</div>
            <div style="margin-top: 10px;">
              <span class="status-badge status-${bill.paymentStatus}">${bill.paymentStatus.toUpperCase()}</span>
            </div>
          </div>
        </div>

        <!-- Customer Information -->
        <div class="customer-info">
          <div class="bill-to">BILL TO:</div>
          <div><strong>${bill.customerDetails.name}</strong></div>
          <div>${bill.customerDetails.email}</div>
          ${bill.customerDetails.phone ? `<div>Phone: ${bill.customerDetails.phone}</div>` : ''}
          ${bill.customerDetails.panDetails ? `<div>PAN: ${bill.customerDetails.panDetails}</div>` : ''}
        </div>

        <!-- Items Table -->
        <table class="items-table">
          <thead>
            <tr>
              <th>Description</th>
              <th>Plan Type</th>
              <th>Qty</th>
              <th class="amount">Unit Price</th>
              <th class="amount">Total</th>
            </tr>
          </thead>
          <tbody>
            ${bill.items.map(item => `
              <tr>
                <td>${item.description}</td>
                <td>${item.planType.charAt(0).toUpperCase() + item.planType.slice(1)}</td>
                <td>${item.quantity}</td>
                <td class="amount">${formatCurrency(item.unitPrice)}</td>
                <td class="amount">${formatCurrency(item.totalPrice)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <!-- Totals -->
        <div class="totals">
          <table>
            <tr>
              <td>Subtotal:</td>
              <td class="amount">${formatCurrency(bill.subtotal)}</td>
            </tr>
            <tr>
              <td>GST (${bill.taxRate}%):</td>
              <td class="amount">${formatCurrency(bill.taxAmount)}</td>
            </tr>
            <tr class="total-row">
              <td>Total Amount:</td>
              <td class="amount">${formatCurrency(bill.totalAmount)}</td>
            </tr>
          </table>
        </div>

        <div class="clearfix"></div>

        <!-- Payment Information -->
        ${bill.paymentId ? `
          <div class="payment-info">
            <strong>Payment Information:</strong><br>
            Payment ID: ${bill.paymentId}<br>
            ${bill.orderId ? `Order ID: ${bill.orderId}<br>` : ''}
            Payment Date: ${formatDate(bill.paymentDate)}<br>
            Status: <span class="status-badge status-${bill.paymentStatus}">${bill.paymentStatus.toUpperCase()}</span>
          </div>
        ` : ''}

        <!-- Footer -->
        <div class="footer">
          <p>Thank you for your business!</p>
          <p>For any queries regarding this invoice, please contact us at ${COMPANY_INFO.email}</p>
          <p><strong>${COMPANY_INFO.name}</strong> | ${COMPANY_INFO.website}</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generate PDF using simple PDF creation
 */
async function generateBillPDF(bill) {
  try {
    // Generate actual PDF using simple PDF structure
    const pdfBuffer = generateSimplePDF(bill);
    return pdfBuffer;
    
  } catch (error) {
    logger.error('Error generating PDF', { 
      billId: bill._id,
      error: error.message 
    });
    throw error;
  }
}

/**
 * Send bill via email with PDF attachment
 */
async function sendBillEmail(billId) {
  try {
    const bill = await Bill.findById(billId).populate('user');
    
    if (!bill) {
      throw new Error('Bill not found');
    }

    const subject = `Invoice ${bill.billNumber} - ${COMPANY_INFO.name}`;
    const pdfBuffer = await generateBillPDF(bill);
    
    // Plain text version
    const textContent = `
Invoice: ${bill.billNumber}
Date: ${new Date(bill.billDate).toLocaleDateString('en-IN')}
Amount: ₹${bill.totalAmount.toLocaleString('en-IN')}

Dear ${bill.customerDetails.name},

Please find attached your invoice for the subscription purchase.

${bill.paymentStatus === 'paid' ? 'Payment has been received successfully.' : 'Payment is pending.'}

Thank you for your business!

${COMPANY_INFO.name}
${COMPANY_INFO.email}
    `;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #4a77e5;">Invoice ${bill.billNumber}</h2>
        <p>Dear ${bill.customerDetails.name},</p>
        <p>Please find attached your invoice for the subscription purchase.</p>
        
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3 style="color: #4a77e5; margin-top: 0;">Invoice Details:</h3>
          <p><strong>Invoice Number:</strong> ${bill.billNumber}</p>
          <p><strong>Date:</strong> ${new Date(bill.billDate).toLocaleDateString('en-IN')}</p>
          <p><strong>Amount:</strong> ₹${bill.totalAmount.toLocaleString('en-IN')}</p>
          <p><strong>Status:</strong> ${bill.paymentStatus === 'paid' ? 'Paid' : 'Pending'}</p>
        </div>
        
        <p>${bill.paymentStatus === 'paid' ? 'Payment has been received successfully.' : 'Payment is pending.'}</p>
        <p>Thank you for your business!</p>
        
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #666; font-size: 12px;">${COMPANY_INFO.name}<br>${COMPANY_INFO.email}</p>
      </div>
    `;

    // Send email with PDF attachment
    const nodemailer = require('nodemailer');
    const { getSmtpConfig } = require('../utils/configSettings');
    
    const config = await getSmtpConfig();
    const transporter = nodemailer.createTransporter({
      host: config.host,
      port: Number(config.port),
      secure: Number(config.port) === 465,
      auth: {
        user: config.user,
        pass: config.pass
      }
    });

    const mailOptions = {
      from: `"${COMPANY_INFO.name}" <${config.user}>`,
      to: bill.customerDetails.email,
      subject,
      text: textContent,
      html: htmlContent,
      attachments: [{
        filename: `Invoice-${bill.billNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }]
    };

    await transporter.sendMail(mailOptions);

    // Update bill email status
    await Bill.findByIdAndUpdate(billId, {
      emailSent: true,
      emailSentAt: new Date(),
      status: bill.status === 'draft' ? 'sent' : bill.status
    });

    logger.info('Bill PDF email sent successfully', { 
      billId, 
      billNumber: bill.billNumber,
      email: bill.customerDetails.email 
    });

    return { success: true, message: 'Bill PDF email sent successfully' };

  } catch (error) {
    logger.error('Error sending bill PDF email', { 
      billId, 
      error: error.message, 
      stack: error.stack 
    });
    throw error;
  }
}

/**
 * Generate and send bill for subscription
 */
async function generateAndSendBill(subscriptionId, paymentDetails = {}) {
  try {
    logger.info('Starting bill generation and email process', { subscriptionId });

    // Generate bill
    const bill = await generateBill(subscriptionId, paymentDetails);
    
    // Send bill email
    await sendBillEmail(bill._id);

    logger.info('Bill generated and sent successfully', { 
      billId: bill._id, 
      billNumber: bill.billNumber 
    });

    return bill;

  } catch (error) {
    logger.error('Error in generateAndSendBill', { 
      subscriptionId, 
      error: error.message, 
      stack: error.stack 
    });
    throw error;
  }
}

/**
 * Get user bills
 */
async function getUserBills(userId, options = {}) {
  try {
    const { page = 1, limit = 10, status } = options;
    const skip = (page - 1) * limit;

    const query = { user: userId };
    if (status) {
      query.status = status;
    }

    const bills = await Bill.find(query)
      .populate('subscription')
      .sort({ billDate: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Bill.countDocuments(query);

    return {
      bills,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };

  } catch (error) {
    logger.error('Error fetching user bills', { 
      userId, 
      error: error.message 
    });
    throw error;
  }
}

module.exports = {
  generateBill,
  generateBillHTML,
  generateBillPDF,
  sendBillEmail,
  generateAndSendBill,
  getUserBills,
  COMPANY_INFO
};