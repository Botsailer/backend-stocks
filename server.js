const express = require('express');
const passport = require('passport');
const cors = require('cors');
const app = express();
const config = require('./config/config');
const dbAdapter = require('./utils/db'); // This should export functions: connect, createUser, findUser, updateUser, findBannedUser
const authRoutes = require('./routes/authRoutes');
const setupSwagger = require('./swaggerOptions'); // optional, for swagger docs
const { makeAdmin } = require('./services/adminservices');

// Middleware
app.use(cors()); 
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


dbAdapter.connect()
  .then(() => {

    app.use(passport.initialize());
    require('./config/passport')(passport, dbAdapter);
    app.use('/auth', authRoutes);
    app.use('/admin', require('./routes/admin'));
    app.use('/api' , require('./routes/Portfolio'));
    app.use('/api/user', require('./routes/userRoute'));
    app.use('/api/tips', require('./routes/tips')); 
    app.use('/api/admin/configs', require('./routes/configRoute'));
    app.listen(config.server.port, () =>
      console.log(`Auth service running on port ${config.server.port}`),
      console.log(`swagger docs available at http://${config.server.host}:${config.server.port}/api-docs`)
    );
  })
  .catch(err => console.error('Database connection error:', err));
