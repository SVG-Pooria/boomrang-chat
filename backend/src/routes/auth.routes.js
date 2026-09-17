const express = require('express');
const controller = require('../controllers/auth.controller');
const requireAuth = require('../middleware/auth.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.post('/login', asyncHandler(controller.login));
router.get('/me', requireAuth, asyncHandler(controller.currentUser));
router.post('/set-password', asyncHandler(controller.setPassword));
router.post('/change-password', requireAuth, asyncHandler(controller.changePassword));
router.post('/verify-password', requireAuth, asyncHandler(controller.verifyPassword));
router.post('/logout', requireAuth, asyncHandler(controller.logout));

module.exports = router;
