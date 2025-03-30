// config/passport.js
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcryptjs');
require('dotenv').config();

module.exports = (passport, dbAdapter) => {
  // Local Strategy
  passport.use(new LocalStrategy(
    { usernameField: 'username', passwordField: 'password' },
    async (username, password, done) => {
      try {
        // Create query to search for either username or email
        const query = {
          $or: [
            { username: username },
            { email: username }  // username field might contain email
          ],
          provider: 'local'
        };

        const user = await dbAdapter.findUser(query);
        if (!user) return done(null, false, { message: 'User not found' });
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return done(null, false, { message: 'Incorrect password' });
        
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
));

  // Google Strategy
  passport.use(new GoogleStrategy(
    {
      clientID: process.env.GOOGLECLIENTID,
      clientSecret: process.env.GOOGLECLIENTSECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await dbAdapter.findUser({ provider: 'google', providerId: profile.id });
        if (!user) {
          user = {
            username: profile.emails && profile.emails[0].value,
            provider: 'google',
            providerId: profile.id,
            mainUserId: null
          };
          const uid = await dbAdapter.createUser(user);
          user._id = uid;
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  ));

// Apple Strategy (if needed)
//   passport.use(new AppleStrategy(
//     {
//       clientID: process.env.APPLE_CLIENT_ID,
//       teamID: process.env.APPLE_TEAM_ID,
//       keyID: process.env.APPLE_KEY_ID,
//       privateKey: process.env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
//       callbackURL: process.env.APPLE_CALLBACK_URL
//     },
//     async (accessToken, refreshToken, idToken, profile, done) => {
//       try {
//         let user = await dbAdapter.findUser({ provider: 'apple', providerId: profile.id });
//         if (!user) {
//           user = {
//             username: profile.email,
//             provider: 'apple',
//             providerId: profile.id,
//             mainUserId: null
//           };
//           const uid = await dbAdapter.createUser(user);
//           user._id = uid;
//         }
//         return done(null, user);
//       } catch (err) {
//         return done(err);
//       }
//     }
//   ));



     

  // Serialize and deserialize user (for session support if needed)
  passport.serializeUser((user, done) => {
    done(null, user._id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await dbAdapter.findUser({ _id: id });
      done(null, user);
    } catch (err) {
      done(err);
    }
  });
};
