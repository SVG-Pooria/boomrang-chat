const express = require('express');
const controller = require('../controllers/userPreferences.controller');
const requireAuth = require('../middleware/auth.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/me', requireAuth, lockGuard, asyncHandler(controller.getMyPreferences));
router.patch('/me', requireAuth, lockGuard, asyncHandler(controller.updateMyPreferences));

module.exports = router;
