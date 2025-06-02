const express = require('express');
const passport = require('passport');
const cors = require('cors');
const app = express();
const config = require('./config/config');
const dbAdapter = require('./utils/db'); 
const authRoutes = require('./routes/authRoutes');
const setupSwagger = require('./swaggerOptions');
// Middleware
app.use(cors()); 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

//verify smtp config  by transporter.verify
const emailService = require('./services/emailServices');
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
    app.listen(config.server.port, () =>
      console.log(`Auth service running on port ${config.server.port}`),
      console.log(`swagger docs available at http://${config.server.host}:${config.server.port}/api-docs`)
    );
  })
  .catch(err => console.error('Database connection error:', err));
