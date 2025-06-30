// config/passport.js
const { Strategy: LocalStrategy } = require('passport-local');
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');
const GoogleStrategy             = require('passport-google-oauth20').Strategy;
const bcrypt                     = require('bcryptjs');
const db                         = require('../utils/db');

module.exports = (passport) => {
  // Local
  passport.use(new LocalStrategy(
    { usernameField: 'username', passwordField: 'password' },
    async (username, password, done) => {
      try {
        const user = await db.findUser({
          provider: 'local',
          $or: [
            { username: { $regex: new RegExp(`^${username}$`, 'i') } }, 
            { email: { $regex: new RegExp(`^${username}$`, 'i') } }
          ]
        });
        if (!user) return done(null, false);
        const match = await bcrypt.compare(password, user.password);
        if (!match) return done(null, false);
        return done(null, user);
      } catch (err) { return done(err); }
    }
  ));

  // JWT
  passport.use(new JwtStrategy({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey:    process.env.ACCESS_TOKEN_SECRET
    },
    async (payload, done) => {
      try {
        const user = await db.findUser({ _id: payload.uid });
        if (!user) return done(null, false);
        // Enforce changedPasswordAt & tokenVersion
        if (user.changedPasswordAt.getTime() > payload.iat*1000) return done(null, false);
        if (payload.tokenVersion !== user.tokenVersion)          return done(null, false);
        return done(null, user);
      } catch (err) { return done(err); }
    }
  ));

  // Google
  passport.use(new GoogleStrategy({
      clientID:     process.env.GOOGLECLIENTID,
      clientSecret: process.env.GOOGLECLIENTSECRET,
      callbackURL:  process.env.GOOGLE_CALLBACK_URL
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await db.findUser({ provider: 'google', providerId: profile.id });
        if (!user) {
          user = await db.createUser({
            username: profile.emails[0].value,
            email:    profile.emails[0].value,
            provider: 'google',
            accessToken,
            refreshToken,
            providerId: profile.id
          });
        }
        done(null, user);
      } catch (err) { done(err); }
    }
  ));

  passport.serializeUser((user, done) => done(null, user._id));
  passport.deserializeUser(async (id, done) => {
    const user = await db.findUser({ _id: id });
    done(null, user);
  });
};
