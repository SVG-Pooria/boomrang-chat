const express = require('express');
const controller = require('../controllers/avatar.controller');
const requireAuth = require('../middleware/auth.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');
const uploadAvatarFile = require('../middleware/avatarUpload.middleware');

const router = express.Router();

router.post('/user/me', requireAuth, lockGuard, uploadAvatarFile, controller.uploadMyAvatar);
router.delete('/user/me', requireAuth, lockGuard, controller.deleteMyAvatar);
router.get('/user/:userId', requireAuth, lockGuard, controller.serveUserAvatar);

router.post('/group/:groupId', requireAuth, lockGuard, uploadAvatarFile, controller.uploadGroupAvatar);
router.delete('/group/:groupId', requireAuth, lockGuard, controller.deleteGroupAvatar);
router.get('/group/:groupId', requireAuth, lockGuard, controller.serveGroupAvatar);

router.post('/channel/:channelId', requireAuth, lockGuard, uploadAvatarFile, controller.uploadChannelAvatar);
router.delete('/channel/:channelId', requireAuth, lockGuard, controller.deleteChannelAvatar);
router.get('/channel/:channelId', requireAuth, lockGuard, controller.serveChannelAvatar);

module.exports = router;
