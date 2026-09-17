const express = require('express');
const controller = require('../controllers/chatPin.controller');
const requireAuth = require('../middleware/auth.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', requireAuth, lockGuard, asyncHandler(controller.list));
router.patch('/', requireAuth, lockGuard, asyncHandler(controller.update));

module.exports = router;
