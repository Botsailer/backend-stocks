const router = require('express').Router();
const passport = require('passport');
const { requireRole } = require('./authController');
const bCtrl = require('../controllers/bundlecontroller');

router.use(passport.authenticate('jwt',{ session:false }));
router.use(requireRole('admin'));

router.post('/',    bCtrl.createBundle);
router.put('/:id',  bCtrl.updateBundle);
router.get('/',     bCtrl.getAllBundles);

module.exports = router;
