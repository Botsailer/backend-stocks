require('dotenv').config();
const express = require('express');
const passport = require('passport');
const app = express();
const config = require('./config/config');
const dbAdapter = require('./utils/db'); // This should export functions: connect, createUser, findUser, updateUser, findBannedUser
const authRoutes = require('./routes/authRoutes');
const setupSwagger = require('./swaggerOptions'); // optional, for swagger docs

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// View engine setup if needed (e.g., for reset password pages)
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');



// Optional: Setup Swagger documentation
setupSwagger(app);

// Root route for sanity check
app.get('/', (req, res) => {
  res.render('index', { title: 'Authentication Module Home' });
});

// Connect to the database, then configure passport and routes
dbAdapter.connect()
  .then(() => {
    app.use(passport.initialize());
    require('./config/passport')(passport, dbAdapter);
    // Pass dbAdapter to the routes so that they have access to database methods
    app.use('/auth', authRoutes(dbAdapter));
    app.listen(config.server.port, () =>
      console.log(`Auth service running on port ${config.server.port}`)
    );
  })
  .catch(err => console.error('Database connection error:', err));
