// server.js
require('dotenv').config();
const express = require('express');
const passport = require('passport');
const app = express();
const config = require('./config/config');
const dbAdapter = require('./utils/db');
const landingPageRoutes = require('./routes/landingPageRoutes');
const authRoutes = require('./routes/authRoutes');

// Hook Swagger docs
const setupSwagger = require('./swaggerOptions');
setupSwagger(app);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

// Root route to render homepage
app.get('/', (req, res) => {
  res.render('index', { title: 'Authentication Module Home' });
});

app.use('/landing-page', landingPageRoutes(dbAdapter));

// Connect to database, then configure middleware, Passport, and routes
dbAdapter.connect()
  .then(() => {
    app.use(express.json());
    app.use(passport.initialize());
    require('./config/passport')(passport, dbAdapter);
    app.use('/auth', authRoutes(dbAdapter));
    
    app.listen(config.server.port, () => console.log(`Auth service running on port ${config.server.port}`));
  })
  .catch(err => console.error('Database connection error:', err));
