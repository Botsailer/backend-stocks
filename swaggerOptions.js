// swaggerOptions.js
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const path = require('path');
const fs = require('fs');

// Define custom CSS for better UI
const customCss = `
  .swagger-ui .topbar { background-color: #2C3E50; }
  .swagger-ui .info .title { color: #2C3E50; }
  .swagger-ui .opblock.opblock-get { background: rgba(97, 175, 254, 0.1); }
  .swagger-ui .opblock.opblock-post { background: rgba(73, 204, 144, 0.1); }
  .swagger-ui .opblock.opblock-put { background: rgba(252, 161, 48, 0.1); }
  .swagger-ui .opblock.opblock-delete { background: rgba(249, 62, 62, 0.1); }
  .swagger-ui .opblock.opblock-patch { background: rgba(80, 227, 194, 0.1); }
  .swagger-ui .btn.execute { background-color: #2C3E50; }
`;

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Stock Trading Platform API',
      version: '1.0.0',
      description: 'API documentation for the Stock Trading Platform'
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    }
  },
  apis: ['./routes/*.js'], // adjust path as necessary
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = (app) => {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss,
    customSiteTitle: "Stock Trading API Documentation"
  }));
  
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
};
