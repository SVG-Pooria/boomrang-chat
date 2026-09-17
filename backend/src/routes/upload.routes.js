const express = require('express');
const controller = require('../controllers/upload.controller');
const requireAuth = require('../middleware/auth.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');
const uploadSingleFile = require('../middleware/upload.middleware');

const router = express.Router();

router.post('/', requireAuth, lockGuard, uploadSingleFile, controller.uploadFile);

module.exports = router;
