// controllers/landingPageController.js
const LandingPage = require('../models/LandingPage');

exports.getLandingPage = async (req, res) => {
  try {
    const landingPage = await LandingPage.findOne();
    if (!landingPage) {
      return res.status(404).json({ error: 'Landing page configuration not found' });
    }
    res.json(landingPage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createOrUpdateLandingPage = async (req, res) => {
  try {
    const {
      companyName,
      tagline,
      metaTitle,
      metaDescription,
      contactInfo,
      socialMedia,
      theme,
      customCSS,
      customJS,
      // Logo update expects base64 string and contentType
      logoBase64,
      logoContentType,
      // Sections
      sections,
      innerTabs
    } = req.body;

    // Use singleton pattern; create one if not exists
    let landingPage = await LandingPage.findOne();
    if (!landingPage) {
      landingPage = new LandingPage();
    }

    landingPage.companyName = companyName || landingPage.companyName;
    landingPage.tagline = tagline || landingPage.tagline;
    landingPage.metaTitle = metaTitle || landingPage.metaTitle;
    landingPage.metaDescription = metaDescription || landingPage.metaDescription;
    landingPage.contactInfo = contactInfo || landingPage.contactInfo;
    landingPage.socialMedia = socialMedia || landingPage.socialMedia;
    landingPage.theme = theme || landingPage.theme;
    landingPage.customCSS = customCSS || landingPage.customCSS;
    landingPage.customJS = customJS || landingPage.customJS;

    if (logoBase64 && logoContentType) {
      landingPage.logo = {
        data: Buffer.from(logoBase64, 'base64'),
        contentType: logoContentType
      };
    }

    // Update sections if provided. This allows partial updates.
    if (sections) {
      landingPage.sections = { ...landingPage.sections.toObject(), ...sections };
    }

    // Update inner tabs similarly.
    if (innerTabs) {
      landingPage.innerTabs = { ...landingPage.innerTabs.toObject(), ...innerTabs };
    }

    const savedLandingPage = await landingPage.save();
    res.json(savedLandingPage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
