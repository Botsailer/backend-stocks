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

// Create an instance of the scheduler
const cronScheduler = new CronScheduler();



// Middleware
app.use(cors()); 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

//verify smtp config by transporter.verify

emailService.verifySmtpConfig()
  .then(() => console.log('SMTP configuration verified successfully'))
  .catch(err => console.error('SMTP configuration error:', err));

setupSwagger(app);

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
    
    // Routes
    app.use('/auth', authRoutes);
    app.use('/admin', require('./routes/admin'));
    app.use('/api', require('./routes/Portfolio'));
    app.use('/api/user', require('./routes/userRoute'));
    app.use('/api/subscriptions', require('./routes/Subscription'));
    app.use('/api/admin/subscriptions', require('./routes/adminSubscription'));
    app.use('/api/stock-symbols', require('./routes/stocksymbol'));
    app.use('/api/faqs', require('./routes/faqRoute'));
    app.use('/api/tips', require('./routes/tips')); 
    app.use('/api/bundles', require('./routes/bundleRouter'));
    app.use('/api/admin/configs', require('./routes/configRoute'));

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

    app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    cronStatus: cronScheduler.getStatus(),
    dbStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
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

    // Start server
    app.listen(config.server.port, async () => {
      console.log(`Auth service running on port ${config.server.port}`);
      console.log(`Swagger docs available at http://${config.server.host}:${config.server.port}/api-docs`);
      


      // Start subscription cleanup job
      await startSubscriptionCleanupJob();
      
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
        console.log('   - Closing Price: 3:45 PM IST (Indian market close)');
        console.log('   - Portfolio Valuation: 3:50 PM IST (After market close)');
        
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
        CronLogger.error('Error closing database connection', error);
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
  CronLogger.error('Uncaught Exception', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  CronLogger.error('Unhandled Rejection', new Error(reason));
  gracefulShutdown('UNHANDLED_REJECTION');
});

module.exports = app;