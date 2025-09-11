/**
 * PDF Form Field Injection Service
 * Fills PDF forms with user data before sending to Digio
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { PDFDocument: PDFLib, rgb } = require('pdf-lib');
const winston = require('winston');

class PDFFormFiller {
  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/pdf-form-filling.log' })
      ]
    });
  }

  /**
   * Fill PDF form fields with user data
   * @param {Buffer} templatePdfBuffer - Original PDF template
   * @param {Object} userData - User data from database
   * @returns {Buffer} - Modified PDF with filled data
   */
  async fillPdfForm(templatePdfBuffer, userData) {
    try {
      this.logger.info('Starting PDF form filling', { userId: userData._id });

      // Load the PDF template
      const pdfDoc = await PDFLib.load(templatePdfBuffer);
      
      // Get the form from the PDF
      const form = pdfDoc.getForm();
      
      // Prepare user data with fallbacks
      const formData = {
        fullName: userData.fullName || userData.username || '',
        pan: userData.pandetails || '',
        dateOfBirth: userData.dateOfBirth ? this.formatDate(userData.dateOfBirth) : '',
        email: userData.email || '',
        state: userData.state || '',
        phone: userData.phone || ''
      };

      // Try to fill common field names (case-insensitive matching)
      const fieldMappings = {
        // Full Name variations
        'fullName': formData.fullName,
        'full_name': formData.fullName,
        'name': formData.fullName,
        'clientName': formData.fullName,
        'client_name': formData.fullName,
        
        // PAN variations
        'pan': formData.pan,
        'panNumber': formData.pan,
        'pan_number': formData.pan,
        'permanentAccountNumber': formData.pan,
        
        // Date of Birth variations
        'dob': formData.dateOfBirth,
        'dateOfBirth': formData.dateOfBirth,
        'date_of_birth': formData.dateOfBirth,
        'birthDate': formData.dateOfBirth,
        
        // Email variations
        'email': formData.email,
        'emailAddress': formData.email,
        'email_address': formData.email,
        
        // State variations
        'state': formData.state,
        'stateCity': formData.state,
        'state_city': formData.state,
        'location': formData.state,
        
        // Phone variations
        'phone': formData.phone,
        'phoneNumber': formData.phone,
        'phone_number': formData.phone,
        'mobile': formData.phone
      };

      // Get all form fields
      const fields = form.getFields();
      let filledCount = 0;

      fields.forEach(field => {
        const fieldName = field.getName();
        const fieldType = field.constructor.name;
        
        this.logger.info(`Found field: ${fieldName} (${fieldType})`);
        
        // Try to match field name with our mappings
        const value = this.findMatchingValue(fieldName, fieldMappings);
        
        if (value && fieldType === 'PDFTextField') {
          try {
            field.setText(value);
            filledCount++;
            this.logger.info(`Filled field ${fieldName} with: ${value}`);
          } catch (fillError) {
            this.logger.warn(`Failed to fill field ${fieldName}:`, fillError.message);
          }
        }
      });

      // If no form fields found, add text overlay
      if (filledCount === 0) {
        this.logger.info('No form fields found, adding text overlay');
        await this.addTextOverlay(pdfDoc, formData);
      }

      // Flatten the form to prevent further editing
      form.flatten();

      // Return the modified PDF
      const modifiedPdfBytes = await pdfDoc.save();
      
      this.logger.info('PDF form filling completed', { 
        filledFields: filledCount,
        userId: userData._id 
      });
      
      return Buffer.from(modifiedPdfBytes);

    } catch (error) {
      this.logger.error('PDF form filling failed:', error);
      throw new Error(`PDF form filling failed: ${error.message}`);
    }
  }

  /**
   * Find matching value for field name (case-insensitive, partial matching)
   */
  findMatchingValue(fieldName, mappings) {
    const lowerFieldName = fieldName.toLowerCase();
    
    // Exact match first
    if (mappings[fieldName]) return mappings[fieldName];
    if (mappings[lowerFieldName]) return mappings[lowerFieldName];
    
    // Partial matching
    for (const [key, value] of Object.entries(mappings)) {
      if (lowerFieldName.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerFieldName)) {
        return value;
      }
    }
    
    return null;
  }

  /**
   * Add text overlay if no form fields are available
   */
  async addTextOverlay(pdfDoc, formData) {
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();

    // Common positions for form fields (adjust based on your PDF layout)
    const overlayPositions = [
      { text: formData.fullName, x: 200, y: height - 150 }, // Full Name
      { text: formData.pan, x: 300, y: height - 180 },      // PAN
      { text: formData.dateOfBirth, x: 200, y: height - 210 }, // DOB
      { text: formData.email, x: 250, y: height - 240 },    // Email
      { text: formData.state, x: 250, y: height - 270 }     // State
    ];

    overlayPositions.forEach(({ text, x, y }) => {
      if (text) {
        firstPage.drawText(text, {
          x: x,
          y: y,
          size: 10,
          color: rgb(0, 0, 0) // Black color
        });
      }
    });
  }

  /**
   * Format date for PDF display
   */
  formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Create a personalized PDF from template
   * @param {string} templatePath - Path to PDF template
   * @param {Object} userData - User data from database
   * @returns {Buffer} - Personalized PDF buffer
   */
  async createPersonalizedPdf(templatePath, userData) {
    try {
      // Read template PDF
      const templateBuffer = fs.readFileSync(templatePath);
      
      // Fill form with user data
      const personalizedPdf = await this.fillPdfForm(templateBuffer, userData);
      
      return personalizedPdf;
    } catch (error) {
      this.logger.error('Failed to create personalized PDF:', error);
      throw error;
    }
  }
}

module.exports = new PDFFormFiller();
