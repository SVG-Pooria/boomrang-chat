const express = require('express');
const controller = require('../controllers/oversight.controller');
const requireAuth = require('../middleware/auth.middleware');
const requireRole = require('../middleware/role.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');

const router = express.Router();

router.get('/presence', requireAuth, lockGuard, requireRole('super_admin'), controller.getPresence);
router.get('/forward-queue', requireAuth, lockGuard, requireRole('super_admin'), controller.getForwardQueueStatus);
router.get('/conversations', requireAuth, lockGuard, requireRole('super_admin'), controller.listConversations);
router.get('/conversations/:id/messages', requireAuth, lockGuard, requireRole('super_admin'), controller.getConversationMessages);
router.get('/files', requireAuth, lockGuard, requireRole('super_admin'), controller.listFiles);
router.get('/files/:fileId/:variant', requireAuth, lockGuard, requireRole('super_admin'), controller.downloadFile);
router.delete('/files/:fileId', requireAuth, lockGuard, requireRole('super_admin'), controller.deleteFile);

module.exports = router;
