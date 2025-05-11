// models/landingPage.js
const mongoose = require('mongoose');

const LandingPageSchema = new mongoose.Schema({
  companyName: { type: String, required: true },
  
  // Basic settings
  logo: {
    data: Buffer,
    contentType: String
  },
  tagline: { type: String },
  metaTitle: { type: String },
  metaDescription: { type: String },
  
  contactInfo: {
    email: { type: String },
    phone: { type: String },
    address: { type: String }
  },
  
  socialMedia: {
    facebook: { type: String },
    twitter: { type: String },
    linkedin: { type: String },
    instagram: { type: String }
  },
  
  theme: {
    primaryColor: { type: String },
    secondaryColor: { type: String },
    headerBackground: { type: String }
  },
  
  customCSS: { type: String },
  customJS: { type: String },

  // Landing page sections
  sections: {
    // 1. Sign In: Slide In Auth (if any editable texts or images needed)
    signIn: {
      enabled: { type: Boolean, default: true },
      title: { type: String },
      subtitle: { type: String }
    },
    // 2. Navigation: Rounded Drawer Nav
    navigation: {
      enabled: { type: Boolean, default: true },
      items: [{
        label: { type: String },
        link: { type: String }
      }]
    },
    // 3. Hero: Image Trail Hero
    hero: {
      enabled: { type: Boolean, default: true },
      image: {
        data: Buffer,
        contentType: String
      },
      title: { type: String },
      subtitle: { type: String },
      callToAction: { type: String }
    },
    // 4. Pricing: For RangaOne Wealth – Editable (e.g. slider pricing)
    pricing: {
      enabled: { type: Boolean, default: true },
      productName: { type: String, default: "RangaOne Wealth" },
      plans: [{
        planName: { type: String },
        price: { type: Number },
        features: [{ type: String }]
      }]
    },
    // 5. Spring Cards: Model Portfolio (2nd product pricing) – Editable
    springCards: {
      enabled: { type: Boolean, default: true },
      productName: { type: String, default: "Model Portfolio" },
      cards: [{
        title: { type: String },
        description: { type: String },
        price: { type: Number },
        features: [{ type: String }]
      }]
    },
    // 6. Drag Cards: Research Reports – Editable
    dragCards: {
      enabled: { type: Boolean, default: true },
      productName: { type: String, default: "Research Reports" },
      cards: [{
        title: { type: String },
        description: { type: String },
        price: { type: Number },
        features: [{ type: String }]
      }]
    },
    // 7. FAQ: Tabs FAQ – Editable
    faq: {
      enabled: { type: Boolean, default: true },
      faqs: [{
        question: { type: String },
        answer: { type: String }
      }]
    },
    // 8. Form: Shifting Contact Form
    form: {
      enabled: { type: Boolean, default: true },
      title: { type: String },
      description: { type: String },
      fields: [{
        name: { type: String },
        type: { type: String }, // e.g., text, email, phone
        placeholder: { type: String },
        required: { type: Boolean, default: false }
      }]
    },
    // 9. Links: Hover Image Links – Editable
    links: {
      enabled: { type: Boolean, default: true },
      links: [{
        title: { type: String },
        url: { type: String },
        image: {
          data: Buffer,
          contentType: String
        }
      }]
    },
    // 10. Footer: As per Sebi Guidelines
    footer: {
      enabled: { type: Boolean, default: true },
      content: { type: String },
      // Additional structured fields can be added here (disclaimers, links, etc.)
    }
  },

  // Inner tabs for authenticated users (after login & payment)
  innerTabs: {
    recommendations: {
      enabled: { type: Boolean, default: true },
      // Editable content for recommendations and tips
      content: { type: String }
    },
    modelPortfolio: {
      enabled: { type: Boolean, default: true },
      content: { type: String }
    },
    dashboard: {
      enabled: { type: Boolean, default: true },
      content: { type: String }
    }
  },

  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Auto-update updatedAt before saving
LandingPageSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('LandingPage', LandingPageSchema);
