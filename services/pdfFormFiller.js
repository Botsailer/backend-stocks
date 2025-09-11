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

      this.logger.info(`Found ${fields.length} form fields in PDF`);

      if (fields.length > 0) {
        // Try to fill form fields if they exist
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
      }

      // Always add text overlay for PDFs without form fields or as backup
      if (filledCount === 0) {
        this.logger.info('No form fields filled or no form fields found, adding text overlay');
        await this.addTextOverlay(pdfDoc, formData);
      } else {
        this.logger.info(`Successfully filled ${filledCount} form fields`);
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
   * Based on the SEBI agreement PDF layout analysis
   */
  async addTextOverlay(pdfDoc, formData) {
    const pages = pdfDoc.getPages();
    
    // We need to find page 2 where the client details section is located
    // Based on the attached image, it's in section "2. CLIENT DETAILS"
    let targetPage = pages[1]; // Page 2 (0-indexed)
    
    if (!targetPage && pages.length > 0) {
      targetPage = pages[0]; // Fallback to first page
    }
    
    const { width, height } = targetPage.getSize();
    
    this.logger.info(`Adding text overlay to page, dimensions: ${width}x${height}`);

    // Based on the SEBI PDF layout analysis and coordinate calculation
    // The form fields are located in section "2. CLIENT DETAILS" on page 2
    // Y coordinates are calculated from bottom of page (PDF coordinate system)
    
    const baseY = height - 260; // Starting Y position for first field
    const lineSpacing = 30; // Space between form lines
    
    const overlayPositions = [
      // Full Name: line appears in CLIENT DETAILS section
      { 
        text: formData.fullName, 
        x: 260, // After "Full Name: " text
        y: baseY, // First field position
        label: 'Full Name'
      },
      
      // PAN: next line after Full Name
      { 
        text: formData.pan, 
        x: 385, // After "Permanent Account Number (PAN): " text
        y: baseY - lineSpacing, 
        label: 'PAN'
      },
      
      // Date of Birth: next line after PAN
      { 
        text: formData.dateOfBirth, 
        x: 285, // After "Date of Birth: " text
        y: baseY - (lineSpacing * 2),
        label: 'Date of Birth'
      },
      
      // Email Address: next line after DOB
      { 
        text: formData.email, 
        x: 305, // After "Email Address: " text
        y: baseY - (lineSpacing * 3),
        label: 'Email'
      },
      
      // State/City: next line after Email
      { 
        text: formData.state, 
        x: 280, // After "State/City: " text
        y: baseY - (lineSpacing * 4),
        label: 'State'
      }
    ];

    overlayPositions.forEach(({ text, x, y, label }) => {
      if (text && text.trim()) {
        try {
          targetPage.drawText(text, {
            x: x,
            y: y,
            size: 11, // Slightly larger font to match document
            color: rgb(0, 0, 0), // Black color
            // Use a standard font that's likely to be available
            font: undefined // Will use default font
          });
          
          this.logger.info(`Added ${label}: "${text}" at position (${x}, ${y})`);
        } catch (drawError) {
          this.logger.warn(`Failed to draw ${label} text:`, drawError.message);
        }
      } else {
        this.logger.warn(`Skipping empty ${label} field`);
      }
    });
    
    this.logger.info('Text overlay completed');
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
