const express = require('express');
const controller = require('../controllers/messageForward.controller');
const requireAuth = require('../middleware/auth.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.post('/forward', requireAuth, lockGuard, asyncHandler(controller.forwardMessage));

module.exports = router;
