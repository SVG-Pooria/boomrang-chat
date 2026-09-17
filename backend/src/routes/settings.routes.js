const express = require('express');
const controller = require('../controllers/settings.controller');
const requireAuth = require('../middleware/auth.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/public', asyncHandler(controller.publicSettings));
router.get('/', requireAuth, lockGuard, asyncHandler(controller.clientSettings));

module.exports = router;
