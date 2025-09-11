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
  .swagger-ui .scheme-container { background-color: #f8f9fa; padding: 10px; }
`;

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Stock Trading Platform API',
      version: '2.0.0',
      description: 'API for managing investment portfolios with real stock market behavior and advanced validation',
      contact: {
        name: 'API Support',
        email: 'anupm019@gmail.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: process.env.NODE_ENV === 'production' 
          ? 'https://api.rangaone.finance' 
          : 'http://localhost:3012',
        description: process.env.NODE_ENV === 'production' 
          ? 'Production Server' 
          : 'Development Server'
      },
      {
        url: 'http://localhost:3012',
        description: 'Local Development Server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token in the format: Bearer <your-token>'
        }
      },
      responses: {
        BadRequest: {
          description: 'Bad Request - Invalid input data',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {
                    type: 'string',
                    example: 'error'
                  },
                  message: {
                    type: 'string',
                    example: 'Invalid input data'
                  },
                  details: {
                    type: 'object',
                    description: 'Additional error details'
                  }
                }
              }
            }
          }
        },
        Unauthorized: {
          description: 'Unauthorized - Authentication required',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {
                    type: 'string',
                    example: 'error'
                  },
                  message: {
                    type: 'string',
                    example: 'Authentication token required'
                  }
                }
              }
            }
          }
        },
        Forbidden: {
          description: 'Forbidden - Admin access required',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {
                    type: 'string',
                    example: 'error'
                  },
                  message: {
                    type: 'string',
                    example: 'Admin access required'
                  }
                }
              }
            }
          }
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {
                    type: 'string',
                    example: 'error'
                  },
                  message: {
                    type: 'string',
                    example: 'Resource not found'
                  }
                }
              }
            }
          }
        },
        InternalServerError: {
          description: 'Internal Server Error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {
                    type: 'string',
                    example: 'error'
                  },
                  message: {
                    type: 'string',
                    example: 'Internal server error'
                  },
                  details: {
                    type: 'object',
                    description: 'Error details (development only)'
                  }
                }
              }
            }
          }
        }
      },
      parameters: {
        portfolioId: {
          name: 'id',
          in: 'path',
          required: true,
          schema: {
            type: 'string',
            pattern: '^[0-9a-fA-F]{24}$'
          },
          description: 'Portfolio ID (24-character MongoDB ObjectId)',
          example: '507f1f77bcf86cd799439011'
        },
        userId: {
          name: 'id',
          in: 'path',
          required: true,
          schema: {
            type: 'string',
            pattern: '^[0-9a-fA-F]{24}$'
          },
          description: 'User ID (24-character MongoDB ObjectId)',
          example: '507f1f77bcf86cd799439012'
        }
      }
    },
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and authorization endpoints'
      },
      {
        name: 'Portfolios',
        description: 'Investment portfolio management with real stock market behavior'
      },
      {
        name: 'KYC',
        description: 'Know Your Customer verification and document management'
      },
      {
        name: 'PDF Operations',
        description: 'PDF generation and document processing'
      },
      {
        name: 'Document Signing',
        description: 'Digital document signing and verification'
      },
      {
        name: 'User Profile',
        description: 'User profile management and settings'
      },
      {
        name: 'Tips',
        description: 'Investment tips and recommendations'
      },
      {
        name: 'Subscriptions',
        description: 'Subscription management and billing'
      },
      {
        name: 'Payments',
        description: 'Payment processing and transaction management'
      },
      {
        name: 'Cart',
        description: 'Shopping cart and order management'
      },
      {
        name: 'Telegram Management',
        description: 'Telegram group management and product synchronization'
      },
      {
        name: 'Download Links',
        description: 'Management of downloadable resources within tips'
      },
      {
        name: 'Administration',
        description: 'Admin authentication and system management'
      },
      {
        name: 'AdminUsers',
        description: 'Admin-only user management operations'
      },
      {
        name: 'Bundles',
        description: 'Portfolio bundle management'
      },
      {
        name: 'Contact',
        description: 'Contact us and customer support messaging'
      },
      {
        name: 'AdminSubscriptions',
        description: 'Admin-only subscription management operations'
      },
      {
        name: 'Admin Notifications',
        description: 'Endpoints for sending emails to portfolio subscribers'
      },
      {
        name: 'ChartData',
        description: 'Portfolio performance chart data management'
      },
      {
        name: 'Configuration',
        description: 'Admin-only endpoints for managing system configuration'
      },
      {
        name: 'Coupons',
        description: 'Discount coupon management'
      },
      {
        name: 'FAQs',
        description: 'Frequently Asked Questions management'
      },
      {
        name: 'Landing Page',
        description: 'Endpoints for managing the landing page configuration'
      },
      {
        name: 'Portfolio Calculation Logs',
        description: 'Detailed portfolio calculation logs for debugging and analysis'
      },
      {
        name: 'Stock Symbols',
        description: 'Endpoints for managing stock symbols and their prices'
      }
    ]
  },
  apis: [
    './routes/*.js',
    './controllers/*.js',
    './models/*.js'
  ]
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = (app) => {
  // Enhanced Swagger UI setup
  const swaggerUiOptions = {
    customCss,
    customSiteTitle: "Stock Trading API Documentation",
    customfavIcon: '/favicon.ico',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'none',
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
      defaultModelsExpandDepth: 2,
      defaultModelExpandDepth: 2,
      deepLinking: true,
      displayOperationId: false,
      defaultModelRendering: 'example',
      validatorUrl: null,
      tryItOutEnabled: true
    }
  };

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));
  
  // API specification endpoint
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  // Alternative Swagger documentation endpoint
  app.get('/docs', (req, res) => {
    res.redirect('/api-docs');
  });

  console.log('📚 Swagger documentation configured:');
  console.log('   - Main docs: /api-docs');
  console.log('   - JSON spec: /api-docs.json');
  console.log('   - Alternative: /docs');
};

