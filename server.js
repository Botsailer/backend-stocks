require('dotenv').config();
const express = require('express');
const passport = require('passport');
const cors = require('cors');
const app = express();
const config = require('./config/config');
const dbAdapter = require('./utils/db');
const authRoutes = require('./routes/authRoutes');
const setupSwagger = require('./swaggerOptions');
const cronController = require('./controllers/portfoliocroncontroller');
const emailService = require('./services/emailServices');
const { startSubscriptionCleanupJob } = require('./services/subscriptioncron');

// Import the new cron scheduler
const { CronScheduler, CronLogger } = require('./utils/cornscheduler');
const { default: mongoose } = require('mongoose');

// Setup global Winston default transport to prevent "no transports" warnings
const winston = require('winston');
winston.add(new winston.transports.Console({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.simple()
  )
}));

// Import log cleanup utilities
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');

// Create an instance of the scheduler
const cronScheduler = new CronScheduler();

// **ROBUST LOG CLEANUP SYSTEM**
class LogCleanupService {
  constructor() {
    this.logsDir = path.join(__dirname, 'logs');
    this.mainlogDir = path.join(__dirname, 'mainlog'); // Protected directory for transaction logs
    this.maxAge = 14; // 14 days
    this.isRunning = false;
  }


  async cleanupOldLogs() {
    if (this.isRunning) {
      console.log('⏳ Log cleanup already in progress, skipping...');
      return;
    }
    this.isRunning = true;
    const startTime = Date.now();
    try {
      console.log(`🧹 Starting automated log cleanup (${this.maxAge} days retention)...`);
      console.log(`📁 Cleaning logs directory: ${this.logsDir}`);
      console.log(`🔒 Protected directory: ${this.mainlogDir} (transaction logs preserved)`);

      // Ensure logs directory exists
      try {
        await fs.access(this.logsDir);
      } catch (error) {
        console.log('📁 Logs directory not found, creating...');
        await fs.mkdir(this.logsDir, { recursive: true });
        this.isRunning = false;
        return { cleaned: 0, message: 'Logs directory created' };
      }

      const files = await fs.readdir(this.logsDir);
      const logFiles = files.filter(file =>
        file.endsWith('.log') || file.endsWith('.txt') || file.includes('cron-')
      );

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.maxAge);

      let cleanedCount = 0;
      const cleanedFiles = [];
      const errors = [];

      for (const file of logFiles) {
        try {
          const filePath = path.join(this.logsDir, file);
          const stats = await fs.stat(filePath);
          const fileDate = stats.birthtime || stats.mtime;
          if (fileDate < cutoffDate) {
            const fileSizeKB = Math.round(stats.size / 1024);
            await fs.unlink(filePath);
            cleanedCount++;
            cleanedFiles.push({
              name: file,
              age: Math.ceil((Date.now() - fileDate.getTime()) / (1000 * 60 * 60 * 24)),
              size: `${fileSizeKB}KB`
            });
            console.log(`🗑️ Removed old log: ${file} (${fileSizeKB}KB, ${Math.ceil((Date.now() - fileDate.getTime()) / (1000 * 60 * 60 * 24))} days old)`);
          }
        } catch (error) {
          console.error(`❌ Failed to process log file ${file}:`, error.message);
          errors.push({ file, error: error.message });
        }
      }

      const duration = Date.now() - startTime;
      const result = {
        cleaned: cleanedCount,
        totalFiles: logFiles.length,
        cleanedFiles,
        errors,
        duration: `${duration}ms`,
        cutoffDate: cutoffDate.toISOString(),
        nextCleanup: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      };

      if (cleanedCount > 0) {
        console.log(`✅ Log cleanup completed: ${cleanedCount}/${logFiles.length} files removed in ${duration}ms`);
      } else {
        console.log(`✅ Log cleanup completed: No old files found (${logFiles.length} files checked)`);
      }

      // Log to our cron logger as well
      try {
        CronLogger.info('Automated log cleanup completed', result);
      } catch (logError) {
        // Silent fail for logging errors to prevent recursion
      }

      return result;
    } catch (error) {
      console.error('❌ Log cleanup failed:', error.message);
      // Silent fail - don't crash the system
      try {
        CronLogger.error('Log cleanup failed', { error: error.message });
      } catch (logError) {
        // Double silent fail
      }
      return {
        success: false,
        error: error.message,
        cleaned: 0
      };
    } finally {
      this.isRunning = false;
    }
  }

  
  startAutomaticCleanup() {
    // Run daily at 2:00 AM
    cron.schedule('0 2 * * *', async () => {
      await this.cleanupOldLogs();
    }, {
      scheduled: true,
      timezone: "Asia/Kolkata"
    });

    console.log('⏰ Automatic log cleanup scheduled: Daily at 2:00 AM IST');
    
    // Run initial cleanup on startup (after 30 seconds)
    setTimeout(async () => {
      await this.cleanupOldLogs();
    }, 30000);
  }

  async getCleanupStatus() {
    try {
      const files = await fs.readdir(this.logsDir);
      const logFiles = files.filter(file => 
        file.endsWith('.log') || file.endsWith('.txt') || file.includes('cron-')
      );

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.maxAge);

      let totalSize = 0;
      let oldFilesCount = 0;
      const fileDetails = [];

      for (const file of logFiles) {
        try {
          const filePath = path.join(this.logsDir, file);
          const stats = await fs.stat(filePath);
          const fileDate = stats.birthtime || stats.mtime;
          const age = Math.ceil((Date.now() - fileDate.getTime()) / (1000 * 60 * 60 * 24));
          const sizeKB = Math.round(stats.size / 1024);
          
          totalSize += sizeKB;
          
          if (fileDate < cutoffDate) {
            oldFilesCount++;
          }

          fileDetails.push({
            name: file,
            age,
            size: `${sizeKB}KB`,
            shouldClean: fileDate < cutoffDate
          });
        } catch (error) {
          fileDetails.push({
            name: file,
            error: error.message
          });
        }
      }

      return {
        isRunning: this.isRunning,
        totalFiles: logFiles.length,
        oldFiles: oldFilesCount,
        totalSizeKB: totalSize,
        maxAgeDays: this.maxAge,
        cutoffDate: cutoffDate.toISOString(),
        files: fileDetails
      };
    } catch (error) {
      return {
        error: error.message,
        isRunning: this.isRunning
      };
    }
  }
}

// Initialize log cleanup service
const logCleanupService = new LogCleanupService();



// Middleware
app.use(cors()); 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve local test page for Razorpay checkout at /razorpay-test
app.get('/razorpay-test', (req, res) => {
  try {
    const testFile = path.join(__dirname, 'razorpay-test.html');
    return res.sendFile(testFile);
  } catch (e) {
    return res.status(404).send('razorpay-test.html not found');
  }
});

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  // Log incoming request immediately
  console.log(`🔥 INCOMING REQUEST: ${req.method} ${req.originalUrl}`);
  console.log(`🔥 Headers:`, JSON.stringify(req.headers, null, 2));
  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`🔥 Body:`, JSON.stringify(req.body, null, 2));
  }
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'error' : 'info';
    console.log(`${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
    
    if (logLevel === 'error') {
      console.error(`HTTP Error: ${req.method} ${req.originalUrl} - ${res.statusCode}`);
    }
  });
  next();
});

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

//verify smtp config by transporter.verify

emailService.verifySmtpConfig()
  .then(() => console.log('SMTP configuration verified successfully'))
  .catch(err => console.error('SMTP configuration error:', err));

setupSwagger(app);



// Health check endpoint for Docker
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/', (req, res) => {
  res.render('index', { 
    title: 'Welcome to the Auth Service',
    message: 'This is the main page of the Auth Service. Use the API endpoints for authentication and user management. please visit the documentation at /api-docs for more details.'
  });
});

dbAdapter.connect()
  .then(() => {
    console.log('✅ Database connected successfully');
    CronLogger.info('Database connection established');
    // Initialize Passport and routes after DB connection
    app.use(passport.initialize());
    require('./config/passport')(passport, dbAdapter);
    

    /**
     * @swagger
     * /portfoliolog:
     *   get:
     *     summary: Get enhanced portfolio operation logs
     *     description: |
     *       Streams the comprehensive portfolio log file with detailed operation tracking.
     *       Shows portfolio.log (all operations) or portfolio-error.log (errors only).
     *       Includes CREATE, READ, UPDATE, DELETE operations with full context.
     *     tags: [System]
     *     parameters:
     *       - in: query
     *         name: type
     *         required: false
     *         schema:
     *           type: string
     *           enum: [all, errors]
     *           default: all
     *         description: Type of log to retrieve (all operations or errors only)
     *       - in: query
     *         name: lines
     *         required: false
     *         schema:
     *           type: integer
     *           default: 100
     *           minimum: 1
     *           maximum: 1000
     *         description: Number of recent lines to retrieve (tail behavior)
     *     responses:
     *       200:
     *         description: Portfolio log file content
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: |
     *                 [2025-08-20 14:49:50.581] [INFO] [UPDATE] [Portfolio: portfolio_123] [User: user_456] Portfolio updated successfully | Details: {
     *                   "stockAction": "buy",
     *                   "holdingsModified": true,
     *                   "portfolioBefore": {
     *                     "cashBalance": 50000,
     *                     "holdingsCount": 5
     *                   },
     *                   "portfolioAfter": {
     *                     "cashBalance": 40000,
     *                     "holdingsCount": 6
     *                   }
     *                 }
     *       404:
     *         description: Log file not found
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: false
     *                 message:
     *                   type: string
     *                   example: "Portfolio log file not found"
     *                 availableTypes:
     *                   type: array
     *                   items:
     *                     type: string
     *                   example: ["all", "errors"]
     *       500:
     *         description: Internal server error
     */
    app.get('/portfoliolog', async (req, res) => {
      try {
        const logType = req.query.type || 'all';
        const lines = Math.min(Math.max(parseInt(req.query.lines) || 100, 1), 1000);
        
        // Determine log file based on type
        const logFileName = logType === 'errors' ? 'portfolio-error.log' : 'portfolio.log';
        const logsDir = path.join(__dirname, 'logs');
        const logFilePath = path.join(logsDir, logFileName);
        
        // Ensure logs directory exists
        try {
          await require('fs').promises.mkdir(logsDir, { recursive: true });
        } catch (mkdirError) {
          if (mkdirError.code !== 'EEXIST') {
            console.error('Error creating logs directory:', mkdirError);
          }
        }
        
        // Check if the log file exists
        require('fs').access(logFilePath, require('fs').constants.F_OK, async (err) => {
          if (err) {
            // Check what log files are available
            try {
              const files = await require('fs').promises.readdir(logsDir);
              const portfolioLogFiles = files.filter(file => 
                file === 'portfolio.log' || file === 'portfolio-error.log'
              );
              
              return res.status(404).json({
                success: false,
                message: `Portfolio log file not found: ${logFileName}`,
                requestedType: logType,
                availableTypes: portfolioLogFiles.map(file => 
                  file === 'portfolio-error.log' ? 'errors' : 'all'
                ),
                availableFiles: portfolioLogFiles,
                hint: 'Use ?type=all or ?type=errors parameter',
                note: portfolioLogFiles.length === 0 ? 'No portfolio logs have been generated yet. Try making some portfolio operations.' : undefined,
                endpoints: {
                  allLogs: '/portfoliolog?type=all',
                  errorLogs: '/portfoliolog?type=errors',
                  recent: '/portfoliolog?lines=50'
                }
              });
            } catch (dirError) {
              return res.status(404).json({
                success: false,
                message: 'Portfolio logs directory not found',
                note: 'No portfolio logs have been generated yet'
              });
            }
          }
          
          // Set appropriate headers for log file
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('Content-Disposition', `inline; filename="${logFileName}"`);
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
          
          // Add custom headers with file info
          try {
            const stats = require('fs').statSync(logFilePath);
            res.setHeader('X-Log-Type', logType);
            res.setHeader('X-Log-Size', stats.size.toString());
            res.setHeader('X-Log-Modified', stats.mtime.toISOString());
            res.setHeader('X-Log-Lines-Requested', lines.toString());
          } catch (statError) {
            // Ignore stat errors
          }
          
          // If lines parameter is specified, use tail-like behavior
          if (lines < 1000) {
            try {
              const fileContent = await require('fs').promises.readFile(logFilePath, 'utf8');
              const allLines = fileContent.split('\n');
              const recentLines = allLines.slice(-lines).join('\n');
              
              res.setHeader('X-Total-Lines', allLines.length.toString());
              res.setHeader('X-Returned-Lines', Math.min(lines, allLines.length).toString());
              
              console.log(`📖 Serving portfolio log: ${logFileName} (${logType}) - Last ${lines} lines`);
              return res.send(recentLines);
            } catch (readError) {
              console.error(`Error reading portfolio log file ${logFileName}:`, readError);
              return res.status(500).json({
                success: false,
                message: 'Error reading portfolio log file',
                error: readError.message
              });
            }
          } else {
            // Stream entire file for larger requests
            const readStream = require('fs').createReadStream(logFilePath, { encoding: 'utf8' });
            
            readStream.on('error', (error) => {
              console.error(`Error reading portfolio log file ${logFileName}:`, error);
              if (!res.headersSent) {
                res.status(500).json({
                  success: false,
                  message: 'Error reading portfolio log file',
                  error: error.message
                });
              }
            });
            
            readStream.on('open', () => {
              console.log(`📖 Serving portfolio log: ${logFileName} (${logType}) - Full file`);
            });
            
            readStream.pipe(res);
          }
        });
      } catch (error) {
        console.error('Portfolio log endpoint error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: error.message
        });
      }
    });

    /**
     * @swagger
     * /portfoliolog/info:
     *   get:
     *     summary: Get portfolio logging system information
     *     description: |
     *       Returns information about the enhanced portfolio logging system.
     *       Shows available log files, their sizes, operation counts, and logging statistics.
     *     tags: [System]
     *     responses:
     *       200:
     *         description: Portfolio logging system information
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 logFiles:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       name:
     *                         type: string
     *                         example: "portfolio.log"
     *                       type:
     *                         type: string
     *                         example: "all"
     *                       size:
     *                         type: integer
     *                         example: 1628
     *                       sizeFormatted:
     *                         type: string
     *                         example: "1.6KB"
     *                       created:
     *                         type: string
     *                         format: date-time
     *                       modified:
     *                         type: string
     *                         format: date-time
     *                       lineCount:
     *                         type: integer
     *                         example: 45
     *                 operationCounts:
     *                   type: object
     *                   properties:
     *                     CREATE:
     *                       type: integer
     *                       example: 5
     *                     READ:
     *                       type: integer
     *                       example: 15
     *                     UPDATE:
     *                       type: integer
     *                       example: 8
     *                     DELETE:
     *                       type: integer
     *                       example: 2
     *                     ERROR:
     *                       type: integer
     *                       example: 1
     *                 logDirectory:
     *                   type: string
     *                   example: "logs/"
     *                 loggingActive:
     *                   type: boolean
     *                   example: true
     *       404:
     *         description: No portfolio logs found
     */
    app.get('/portfoliolog/info', async (req, res) => {
      try {
        const logsDir = path.join(__dirname, 'logs');
        
        // Ensure logs directory exists
        try {
          await require('fs').promises.mkdir(logsDir, { recursive: true });
          console.log(`✅ Ensured logs directory exists at: ${logsDir}`);
        } catch (mkdirError) {
          if (mkdirError.code !== 'EEXIST') {
            console.error('Error creating logs directory:', mkdirError);
          }
        }
        
        // Get all portfolio log files
        const files = await require('fs').promises.readdir(logsDir);
        const portfolioLogFiles = files.filter(file => 
          file === 'portfolio.log' || file === 'portfolio-error.log'
        );
        
        if (portfolioLogFiles.length === 0) {
          return res.status(404).json({
            success: false,
            message: 'No portfolio log files found',
            directory: 'logs/',
            note: 'Portfolio logs will be created when portfolio operations occur',
            loggingActive: true,
            systemReady: true,
            nextSteps: [
              'Create a portfolio to generate logs',
              'Update an existing portfolio',
              'Check /portfoliolog endpoint after operations'
            ]
          });
        }
        
        // Get detailed info for each log file
        const logFilesInfo = [];
        const operationCounts = {
          CREATE: 0,
          READ: 0,
          READ_ALL: 0,
          UPDATE: 0,
          DELETE: 0,
          ERROR: 0
        };
        
        for (const file of portfolioLogFiles) {
          try {
            const filePath = path.join(logsDir, file);
            const stats = await require('fs').promises.stat(filePath);
            const content = await require('fs').promises.readFile(filePath, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());
            
            // Count operations in this file
            const fileOperationCounts = { ...operationCounts };
            lines.forEach(line => {
              const operationMatch = line.match(/\[([A-Z_]+)\]/);
              if (operationMatch && fileOperationCounts.hasOwnProperty(operationMatch[1])) {
                fileOperationCounts[operationMatch[1]]++;
              }
            });
            
            // Update total counts
            Object.keys(operationCounts).forEach(op => {
              operationCounts[op] += fileOperationCounts[op];
            });
            
            logFilesInfo.push({
              name: file,
              type: file === 'portfolio-error.log' ? 'errors' : 'all',
              size: stats.size,
              sizeFormatted: stats.size < 1024 ? `${stats.size}B` : 
                           stats.size < 1024 * 1024 ? `${Math.round(stats.size / 1024)}KB` :
                           `${Math.round(stats.size / (1024 * 1024))}MB`,
              created: stats.birthtime.toISOString(),
              modified: stats.mtime.toISOString(),
              lineCount: lines.length,
              operationCounts: fileOperationCounts,
              endpoint: `/portfoliolog?type=${file === 'portfolio-error.log' ? 'errors' : 'all'}`
            });
          } catch (fileError) {
            console.error(`Error processing log file ${file}:`, fileError);
          }
        }
        
        // Sort by modified date (newest first)
        logFilesInfo.sort((a, b) => new Date(b.modified) - new Date(a.modified));
        
        // Calculate total operations
        const totalOperations = Object.values(operationCounts).reduce((sum, count) => sum + count, 0);
        
        res.json({
          success: true,
          logFiles: logFilesInfo,
          operationCounts,
          totalOperations,
          logDirectory: 'logs/',
          loggingActive: true,
          systemInfo: {
            enhancedLogging: true,
            logRotation: '10MB max per file',
            retentionPolicy: '10 files for portfolio.log, 5 files for errors',
            logFormat: 'Winston with structured JSON details',
            operationTypes: ['CREATE', 'READ', 'READ_ALL', 'UPDATE', 'DELETE', 'ERROR']
          },
          endpoints: {
            viewAllLogs: '/portfoliolog?type=all',
            viewErrorLogs: '/portfoliolog?type=errors',
            recentLogs: '/portfoliolog?lines=50',
            logInfo: '/portfoliolog/info'
          },
          lastActivity: logFilesInfo.length > 0 ? logFilesInfo[0].modified : null
        });
        
      } catch (error) {
        console.error('Error fetching portfolio log info:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to fetch portfolio log information',
          error: error.message
        });
      }
    });

    /**
     * @swagger
     * /api/admin/logs/create-sample:
     *   post:
     *     summary: Create sample transaction logs
     *     description: |
     *       Creates sample transaction logs for testing purposes.
     *       This is an admin-only endpoint and should not be used in production.
     *     tags: [System]
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: Sample logs created successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 message:
     *                   type: string
     *                   example: "Sample transaction logs created successfully"
     *                 generatedFiles:
     *                   type: array
     *                   items:
     *                     type: string
     *                   example: ["/home/user/app/mainlog/portfolio-transactions-2025-08-19.log"]
     *       500:
     *         description: Failed to create sample logs
     */
    app.post('/api/admin/logs/create-sample', async (req, res) => {
      try {
        // In a real app, we would check for admin permissions here
        const transactionLogGenerator = require('./utils/transactionLogGenerator');
        const generatedFiles = transactionLogGenerator.generateSampleLogs();
        
        res.json({
          success: true,
          message: 'Sample transaction logs created successfully',
          generatedFiles,
          note: 'These are sample logs for testing purposes only'
        });
      } catch (error) {
        console.error('Error creating sample logs:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to create sample logs',
          error: error.message
        });
      }
    });

    // Routes
app.use('/auth', authRoutes);
app.use('/admin', require('./routes/admin'));
app.use('/digio', require('./routes/digioRoutes'));
app.use('/api/user', require('./routes/userRoute'));

   /**
     * @swagger
     * /api/contactus:
     *   post:
     *     summary: Send contact us message
     *     description: |
     *       Allows users to send contact messages which are forwarded via email.
     *       All fields are required for successful submission.
     *     tags: [System]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - name
     *               - email
     *               - message
     *             properties:
     *               name:
     *                 type: string
     *                 example: "John Doe"
     *                 description: Full name of the person contacting
     *               email:
     *                 type: string
     *                 format: email
     *                 example: "john@example.com"
     *                 description: Email address for response
     *               askingabout:
     *                 type: string
     *                 example: "Portfolio Management"
     *                 description: Topic or category of inquiry
     *               represent:
     *                 type: string
     *                 example: "Individual Investor"
     *                 description: What the person represents (company, individual, etc.)
     *               message:
     *                 type: string
     *                 example: "I'm interested in learning more about your portfolio management services."
     *                 description: The main message content
     *     responses:
     *       200:
     *         description: Message sent successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "Contact us message sent successfully"
     *       400:
     *         description: Missing required fields
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 error:
     *                   type: string
     *                   example: "All fields are required"
     *       500:
     *         description: Failed to send message
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 error:
     *                   type: string
     *                   example: "Failed to send contact us message"
     */
    // Contact us endpoint
    app.post("/api/contactus", (req, res) => {
      const { name, email, askingabout, represent, message } = req.body;
      if (!name || !email || !message) {
        return res.status(400).json({ error: 'All fields are required' });
      }

      emailService.sendContactUsEmail(name, email, askingabout, represent, message)
        .then(() => res.status(200).json({ message: 'Contact us message sent successfully' }))
        .catch(err => {
          console.error('Error sending contact us email:', err);
          res.status(500).json({ error: 'Failed to send contact us message' });
        });
    });
app.use('/api/subscriptions', require('./routes/Subscription'));
app.use('/api/admin/subscriptions', require('./routes/adminSubscription'));
app.use('/api/admin/coupons', require('./routes/couponRoute'));
app.use('/api/admin/telegram', require('./routes/telegram'));
app.use('/api/stock-symbols', require('./routes/stocksymbol'));
app.use('/api/faqs', require('./routes/faqRoute'));
app.use('/api/tips', require('./routes/tips'));                    
app.use('/api/bundles', require('./routes/bundleRouter'));          
app.use('/api/admin/configs', require('./routes/configRoute'));     
app.use('/api/portfolio-calculation-logs', require('./routes/portfolioCalculationLogs')); 
app.use('/api/chart-data', require('./routes/chartData'));    
app.use('/api', require('./routes/Portfolio'));                                    


// --- API Request Counter (persistent) ---
const apiRequestCounter = require('./api-request');
// Middleware to increment counter for all valid API calls (not 404)
app.use((req, res, next) => {
  console.log('[COUNTER MIDDLEWARE] Called for:', req.method, req.originalUrl);
  res.on('finish', () => {
    if (
      res.statusCode !== 404 && !(req.method === 'GET' && req.originalUrl.startsWith('/api/request-count'))
    ) {
      console.log('[COUNTER] Incrementing for:', req.method, req.originalUrl, 'Status:', res.statusCode);
      apiRequestCounter.increment();
    } else {
      console.log('[COUNTER] Not incrementing for:', req.method, req.originalUrl, 'Status:', res.statusCode);
    }
  });
  next();
});
/**
// ...existing code...
 * @swagger
 * /api/request-count:
 *   get:
 *     summary: Get total API request count (excluding 404s)
 *     description: Returns the number of API requests made (excluding 404 Not Found). This count persists across server restarts.
 *     tags: [System]
 *     responses:
 *       200:
 *         description: API request count retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                   example: 1234
 *                 note:
 *                   type: string
 *                   example: "This count persists across server restarts."
 */
app.get('/api/request-count', (req, res) => {
  res.json({ count: apiRequestCounter.getCount(), note: 'This count persists across server restarts.' });
});

    // Cron job test endpoints
    app.post('/api/cron/trigger-closing-update', async (req, res) => {
      try {
        CronLogger.info('Manual closing price update triggered via API');
        await cronScheduler.triggerManualUpdate('closing');
        res.json({
          success: true,
          message: 'Manual closing price update triggered successfully',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        CronLogger.error('Failed to trigger manual closing update via API', error);
        res.status(500).json({
          success: false,
          message: 'Failed to trigger manual closing update',
          error: error.message
        });
      }
    });

    // Global error handling middleware
    app.use((err, req, res, next) => {
      console.error('🚨 Global error handler:', err);
      
      // Don't expose internal error details in production
      const isDevelopment = process.env.NODE_ENV !== 'production';
      
      res.status(err.status || 500).json({
        status: 'error',
        message: err.message || 'Internal server error',
        ...(isDevelopment && { stack: err.stack, details: err })
      });
    });

    // 404 handler for undefined routes
    app.use('*', (req, res) => {
      res.status(404).json({
        status: 'error',
        message: `Route ${req.originalUrl} not found`,
        availableEndpoints: [
          'GET /health',
          'GET /api-docs',
          'POST /auth/login',
          'GET /api/portfolios'
        ]
      });
    });

 


    /**
     * @swagger
     * /api/admin/logs/status:
     *   get:
     *     summary: Get log cleanup status and file information
     *     description: |
     *       Returns detailed information about log files, cleanup status, and system configuration.
     *       Admin-only endpoint for monitoring log management.
     *     tags: [System]
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: Log cleanup status retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 isRunning:
     *                   type: boolean
     *                   example: false
     *                   description: Whether cleanup is currently running
     *                 totalFiles:
     *                   type: integer
     *                   example: 12
     *                   description: Total number of log files
     *                 oldFiles:
     *                   type: integer
     *                   example: 3
     *                   description: Number of files older than retention period
     *                 totalSizeKB:
     *                   type: integer
     *                   example: 5420
     *                   description: Total size of all log files in KB
     *                 maxAgeDays:
     *                   type: integer
     *                   example: 14
     *                   description: Log retention period in days
     *                 cutoffDate:
     *                   type: string
     *                   format: date-time
     *                   description: Files older than this date will be cleaned
     *                 files:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       name:
     *                         type: string
     *                         example: "cron-2025-08-01.log"
     *                       age:
     *                         type: integer
     *                         example: 15
     *                         description: File age in days
     *                       size:
     *                         type: string
     *                         example: "142KB"
     *                       shouldClean:
     *                         type: boolean
     *                         example: true
     *                         description: Whether this file should be cleaned
     *                 timestamp:
     *                   type: string
     *                   format: date-time
     *       500:
     *         $ref: '#/components/responses/InternalServerError'
     */
    app.get('/api/admin/logs/status', async (req, res) => {
      try {
        const status = await logCleanupService.getCleanupStatus();
        res.json({
          success: true,
          ...status,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to get log cleanup status',
          error: error.message
        });
      }
    });

    /**
     * @swagger
     * /api/admin/logs/cleanup:
     *   post:
     *     summary: Manually trigger log cleanup
     *     description: |
     *       Manually initiates the log cleanup process to remove files older than the retention period.
     *       This operation is normally automated but can be triggered manually by administrators.
     *     tags: [System]
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: Log cleanup completed successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 message:
     *                   type: string
     *                   example: "Manual log cleanup completed: 3 files removed"
     *                 cleaned:
     *                   type: integer
     *                   example: 3
     *                   description: Number of files cleaned
     *                 totalFiles:
     *                   type: integer
     *                   example: 12
     *                   description: Total files checked
     *                 cleanedFiles:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       name:
     *                         type: string
     *                         example: "cron-2025-07-30.log"
     *                       age:
     *                         type: integer
     *                         example: 16
     *                       size:
     *                         type: string
     *                         example: "85KB"
     *                 errors:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       file:
     *                         type: string
     *                       error:
     *                         type: string
     *                 duration:
     *                   type: string
     *                   example: "145ms"
     *                 cutoffDate:
     *                   type: string
     *                   format: date-time
     *                 nextCleanup:
     *                   type: string
     *                   format: date-time
     *                 timestamp:
     *                   type: string
     *                   format: date-time
     *       500:
     *         $ref: '#/components/responses/InternalServerError'
     */
    app.post('/api/admin/logs/cleanup', async (req, res) => {
      try {
        const result = await logCleanupService.cleanupOldLogs();
        res.json({
          success: true,
          message: `Manual log cleanup completed: ${result.cleaned} files removed`,
          ...result,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to run log cleanup',
          error: error.message
        });
      }
    });


    // Price log cleanup endpoint
    app.post('/api/admin/price-logs/cleanup', async (req, res) => {
      try {
        const { cleanupDuplicatePriceLogs, verifyPriceLogIntegrity } = require('./utils/priceLogCleanup');
        
        // First verify if we have duplicates
        const initialIntegrity = await verifyPriceLogIntegrity();
        
        if (initialIntegrity) {
          return res.json({
            success: true,
            message: 'No duplicate price logs found. Database is in good state.',
            duplicatesFound: 0
          });
        }
        
        // Run cleanup
        const results = await cleanupDuplicatePriceLogs();
        
        // Verify cleanup was successful
        const finalIntegrity = await verifyPriceLogIntegrity();
        
        res.json({
          success: true,
          message: `Cleanup completed: ${results.duplicatesRemoved} duplicates removed`,
          initialCheck: !initialIntegrity, // true means duplicates found
          finalCheck: finalIntegrity, // true means no duplicates
          results,
          allDuplicatesRemoved: finalIntegrity
        });
      } catch (error) {
        console.error('Price log cleanup failed:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to clean up price logs',
          error: error.message
        });
      }
    });

    /**
     * @swagger
     * /api/cron/status:
     *   get:
     *     summary: Get scheduled jobs status
     *     description: |
     *       Returns the status of all scheduled cron jobs including stock price updates,
     *       portfolio calculations, and system maintenance tasks.
     *     tags: [System]
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: Cron jobs status retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 jobs:
     *                   type: object
     *                   description: Status of all scheduled jobs
     *                   properties:
     *                     stockPriceUpdate:
     *                       type: object
     *                       properties:
     *                         status:
     *                           type: string
     *                           enum: [running, scheduled, stopped]
     *                         lastRun:
     *                           type: string
     *                           format: date-time
     *                         nextRun:
     *                           type: string
     *                           format: date-time
     *                         schedule:
     *                           type: string
     *                           example: "0 8,14 * * *"
     *                     portfolioCalculation:
     *                       type: object
     *                       properties:
     *                         status:
     *                           type: string
     *                         lastRun:
     *                           type: string
     *                           format: date-time
     *                         nextRun:
     *                           type: string
     *                           format: date-time
     *                 timestamp:
     *                   type: string
     *                   format: date-time
     *                 environment:
     *                   type: string
     *                   example: "production"
     *       500:
     *         $ref: '#/components/responses/InternalServerError'
     */
    // **NEW CRON ENDPOINTS** - Add these for monitoring and manual triggers
    app.get('/api/cron/status', (req, res) => {
      try {
        const status = cronScheduler.getStatus();
        res.json({
          success: true,
          jobs: status,
          timestamp: new Date().toISOString(),
          environment: process.env.NODE_ENV || 'development'
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to get cron status',
          error: error.message
        });
      }
    });

    /**
     * @swagger
     * /api/cron/trigger-stock-update:
     *   post:
     *     summary: Manually trigger stock price update
     *     description: |
     *       Manually initiates an immediate stock price update for all portfolios.
     *       This bypasses the scheduled update and runs immediately.
     *     tags: [System]
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: Stock update triggered successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 message:
     *                   type: string
     *                   example: "Manual stock price update triggered successfully"
     *                 timestamp:
     *                   type: string
     *                   format: date-time
     *       500:
     *         description: Failed to trigger update
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: false
     *                 message:
     *                   type: string
     *                   example: "Failed to trigger manual update"
     *                 error:
     *                   type: string
     */
    app.post('/api/cron/trigger-stock-update', async (req, res) => {
      try {
        CronLogger.info('Manual stock price update triggered via API');
        await cronScheduler.triggerManualUpdate();
        res.json({
          success: true,
          message: 'Manual stock price update triggered successfully',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        CronLogger.error('Failed to trigger manual stock update via API', error);
        res.status(500).json({
          success: false,
          message: 'Failed to trigger manual update',
          error: error.message
        });
      }
    });

    /**
     * @swagger
     * /api/cron/trigger-closing-update:
     *   post:
     *     summary: Manually trigger closing price update
     *     description: |
     *       Manually initiates the closing price update sequence which updates
     *       todayClosingPrice for all stocks and then runs portfolio valuation.
     *     tags: [System]
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: Closing update triggered successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 message:
     *                   type: string
     *                   example: "Manual closing price update triggered successfully"
     *                 timestamp:
     *                   type: string
     *                   format: date-time
     *       500:
     *         description: Failed to trigger update
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: false
     *                 message:
     *                   type: string
     *                   example: "Failed to trigger manual closing update"
     *                 error:
     *                   type: string
     */
    app.post('/api/cron/trigger-closing-update', async (req, res) => {
      try {
        CronLogger.info('Manual closing price update triggered via API');
        await cronScheduler.triggerManualUpdate('closing');
        res.json({
          success: true,
          message: 'Manual closing price update triggered successfully',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        CronLogger.error('Failed to trigger manual closing update via API', error);
        res.status(500).json({
          success: false,
          message: 'Failed to trigger manual closing update',
          error: error.message
        });
      }
    });

    // Start server
    app.listen(config.server.port, async () => {

      console.log(`Auth service running on port ${config.server.port}`);
      console.log(`Swagger docs available at http://${config.server.host}:${config.server.port}/api-docs`);
      
      // **START LOG CLEANUP SERVICE**
      try {
        console.log('🧹 Starting automatic log cleanup service...');
        logCleanupService.startAutomaticCleanup();
        console.log('✅ Log cleanup service started successfully');
      } catch (error) {
        console.error('❌ Failed to start log cleanup service:', error.message);
        // Don't crash the system, just log the error
      }

      // **START SOLD STOCKS CLEANUP SERVICE**
      try {
        console.log('🗑️ Starting automatic sold stocks cleanup service...');
        const portfolioService = require('./services/portfolioservice');
        
        // Schedule sold stocks cleanup - Run daily at 3:00 AM IST
        cron.schedule('0 3 * * *', async () => {
          try {
            console.log('🧹 Starting scheduled sold stocks cleanup...');
            const result = await portfolioService.cleanupOldSoldStocks();
            console.log(`✅ Sold stocks cleanup completed. Removed ${result.totalCleaned} stocks.`);
          } catch (error) {
            console.error('❌ Sold stocks cleanup failed:', error.message);
          }
        }, {
          scheduled: true,
          timezone: "Asia/Kolkata"
        });

        console.log('✅ Sold stocks cleanup service scheduled: Daily at 3:00 AM IST');
      } catch (error) {
        console.error('❌ Failed to start sold stocks cleanup service:', error.message);
      }

      // Start subscription cleanup job
      await startSubscriptionCleanupJob();
      
      // **START DIGIO DOCUMENT SYNC SERVICE**
      try {
        console.log('📄 Starting Digio document sync service...');
        const { startCronJob } = require('./utils/digioCronScheduler');
        startCronJob();
        console.log('✅ Digio document sync service started (every 15 minutes)');
      } catch (error) {
        console.error('❌ Failed to start Digio sync service:', error.message);
      }
      
      // Initialize existing portfolio cron jobs in production
      if (process.env.NODE_ENV === 'production') {
        console.log('Production environment detected. Initializing scheduled jobs.');
        cronController.initScheduledJobs();
      }
      
      // **INITIALIZE AND START STOCK PRICE CRON SCHEDULER**
      try {
        console.log('🚀 Initializing stock price cron scheduler...');

        CronLogger.info('Starting stock price cron scheduler initialization');
        
        // Initialize the cron scheduler
        cronScheduler.initialize();
        
        // Start the cron jobs
        cronScheduler.start();
        
        console.log('✅ Stock price cron scheduler started successfully');
        CronLogger.success('Stock price cron scheduler initialized and started');
        
        // Log the scheduled times
        console.log('📅 Stock price update schedule (Asia/Kolkata timezone - IST):');
        console.log('   - Morning: 8:00 AM IST');
        console.log('   - Hourly: Every hour');
        console.log('   - Afternoon: 2:00 PM IST');
        console.log('   - Closing Price: 4:00 PM IST (After Indian market close)');
        console.log('   - Portfolio Valuation: 5:00 PM IST (1 hour after closing prices start)');
        
      } catch (error) {
        console.error('❌ Failed to initialize stock price cron scheduler:', error);
        CronLogger.error('Failed to initialize stock price cron scheduler', error);
      }
    });
  })
  .catch(err => {
    console.error('Database connection error:', err);
    CronLogger.error('Database connection failed', err);
    process.exit(1);
  });

// **GRACEFUL SHUTDOWN HANDLING**
const gracefulShutdown = (signal) => {
  console.log(`👋 ${signal} received, shutting down gracefully`);
  CronLogger.info(`${signal} received, initiating graceful shutdown`);
  
  try {

    // Stop cron scheduler
    cronScheduler.stop();
    console.log('🛑 Cron scheduler stopped');
    
    // Close database connection
    dbAdapter.disconnect()
      .then(() => {
        console.log('🔌 Database connection closed');
        CronLogger.info('Database connection closed successfully');
        process.exit(0);
      })
      .catch((error) => {
        console.error('❌ Error closing database connection:', error);
        process.exit(1);
      });
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    CronLogger.error('Error during graceful shutdown', error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  // Check if this is a critical error that should cause shutdown
  const errorString = String(reason);
  const criticalErrors = [
    'ECONNREFUSED', // Database connection issues
    'ENOTFOUND',    // DNS resolution issues
    'auth failed',  // Authentication failures
    'connection failed'
  ];
  
  const isCritical = criticalErrors.some(err => errorString.includes(err));
  
  if (isCritical) {
    console.error('🚨 Critical error detected, shutting down...');
    gracefulShutdown('UNHANDLED_REJECTION');
  } else {
    console.warn('⚠️ Non-critical error logged, continuing operation...');
    // For non-critical errors, just log and continue
  }
});

module.exports = app;