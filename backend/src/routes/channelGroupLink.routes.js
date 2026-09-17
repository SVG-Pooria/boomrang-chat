const express = require('express');
const controller = require('../controllers/channelGroupLink.controller');
const requireAuth = require('../middleware/auth.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');

const router = express.Router();

router.post('/:channelId/link', requireAuth, lockGuard, controller.createLink);
router.delete('/:channelId/link', requireAuth, lockGuard, controller.removeLink);
router.get('/:channelId/link-status', requireAuth, lockGuard, controller.getLinkStatus);

module.exports = router;
