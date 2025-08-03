const express = require('express');
const passport = require('passport');
const cors = require('cors');
const app = express();
const config = require('./config/config');
const dbAdapter = require('./utils/db'); 
const authRoutes = require('./routes/authRoutes');
const setupSwagger = require('./swaggerOptions');
const cronController = require('./controllers/portfoliocroncontroller');

// Middleware
app.use(cors()); 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

//verify smtp config  by transporter.verify
const emailService = require('./services/emailServices');
const { startSubscriptionCleanupJob } = require('./services/subscriptioncron');
emailService.verifySmtpConfig()
  .then(() => console.log('SMTP configuration verified successfully'))
  .catch(err => console.error('SMTP configuration error:', err));
  


setupSwagger(app);

app.get('/', (req, res) => {
  res.render('index', { title: 'Welcome to the Auth Service '
  , message: 'This is the main page of the Auth Service. Use the API endpoints for authentication and user management. please visit the documentation at /api-docs for more details.'
   });
})

dbAdapter.connect()
  .then(() => {

    app.use(passport.initialize());
    require('./config/passport')(passport, dbAdapter);
    app.use('/auth', authRoutes);
    app.use('/admin', require('./routes/admin'));
    app.use('/api' , require('./routes/Portfolio'));
    app.use('/api/user', require('./routes/userRoute'));
    app.use('/api/subscriptions', require('./routes/Subscription'));
    app.use('/api/admin/subscriptions', require('./routes/adminSubscription'));
    app.use('/api/stock-symbols', require('./routes/stocksymbol'));
    app.use('/api/faqs', require('./routes/faqRoute'));
    app.use('/api/tips', require('./routes/tips')); 
    app.use('/api/bundles', require('./routes/bundleRouter'));
    app.use('/api/admin/configs', require('./routes/configRoute'));

    


app.post("/api/contactus", (req, res) => {
  const { name, email, askingabout,represent ,message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  emailService.sendContactUsEmail(name, email, askingabout , represent ,message)
    .then(() => res.status(200).json({ message: 'Contact us message sent successfully' }))
    .catch(err => {
      console.error('Error sending contact us email:', err);
      res.status(500).json({ error: 'Failed to send contact us message' });
    });
});

    app.listen(config.server.port, async () =>{
      console.log(`Auth service running on port ${config.server.port}`),
    
     // dbAdapter.cleanupDuplicateSubscriptions();
     await startSubscriptionCleanupJob();
      console.log(`swagger docs available at http://${config.server.host}:${config.server.port}/api-docs`)
    if (process.env.NODE_ENV === 'production') {
      console.log('Production environment detected. Initializing scheduled jobs.');
  cronController.initScheduledJobs();
}
    }
    );
  })
  .catch(err => console.error('Database connection error:', err));
