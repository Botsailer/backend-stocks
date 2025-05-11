const router = require('express').Router();
const passport = require('passport');
const { requireRole } = require('../controllers/authController'); // assume authController exports this
const ctrl = require('../controllers/modelcontroller');

router.use(passport.authenticate('jwt',{ session:false }));
router.use(requireRole('admin'));

router.post('/',    ctrl.createModel);
router.put('/:id',  ctrl.updateModel);
router.get('/',     ctrl.getAllModels);
router.get('/:id',  ctrl.getModel);

module.exports = router;
