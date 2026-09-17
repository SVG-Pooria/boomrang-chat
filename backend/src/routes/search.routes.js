const express = require('express');
const controller = require('../controllers/search.controller');
const requireAuth = require('../middleware/auth.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');

const router = express.Router();

router.get('/', requireAuth, lockGuard, controller.search);

module.exports = router;
