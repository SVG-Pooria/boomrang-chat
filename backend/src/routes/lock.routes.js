const express = require('express');
const controller = require('../controllers/lockScreen.controller');
const requireAuth = require('../middleware/auth.middleware');
const requireRole = require('../middleware/role.middleware');

const router = express.Router();

router.get('/status', requireAuth, requireRole('management', 'super_admin'), controller.getStatus);
router.post('/lock', requireAuth, requireRole('management', 'super_admin'), controller.lockMyScreen);
router.post('/unlock', requireAuth, requireRole('management', 'super_admin'), controller.unlockMyScreen);

module.exports = router;
