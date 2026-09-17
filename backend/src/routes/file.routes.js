const express = require('express');
const controller = require('../controllers/file.controller');
const requireAuth = require('../middleware/auth.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');

const router = express.Router();

router.get('/:fileId/:variant', requireAuth, lockGuard, controller.downloadFile);

module.exports = router;
