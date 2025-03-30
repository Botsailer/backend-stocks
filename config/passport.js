const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcryptjs');
require('dotenv').config();

module.exports = (passport, dbAdapter) => {
  /**
   * Local Strategy
   * This strategy accepts a single field "username" which can be either a username or an email.
   */
  passport.use(new LocalStrategy(
    { usernameField: 'username', passwordField: 'password' },
    async (username, password, done) => {
      try {
        // Query that checks both username and email fields
        const query = {
          $or: [
            { username: username },
            { email: username }
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

  /**
   * Google OAuth Strategy
   * Allows users to authenticate via Google. If the user does not exist, a new account is created.
   */
  passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLECLIENTID,
      clientSecret: process.env.GOOGLECLIENTSECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await dbAdapter.findUser({ provider: 'google', providerId: profile.id });
        if (!user) {
          // Create a new user with details from Google profile
          user = {
            username: profile.emails && profile.emails[0].value,
            email: profile.emails && profile.emails[0].value,
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

  // Serialize the user for session support (if sessions are used)
  passport.serializeUser((user, done) => {
    done(null, user._id);
  });

  // Deserialize the user based on the user id stored in session
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await dbAdapter.findUser({ _id: id });
      done(null, user);
    } catch (err) {
      done(err);
    }
  });
};
