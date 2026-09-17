const express = require('express');
const controller = require('../controllers/conversation.controller');
const requireAuth = require('../middleware/auth.middleware');
const requireRole = require('../middleware/role.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');

const router = express.Router();

router.get('/', requireAuth, lockGuard, controller.listConversations);
router.post('/direct', requireAuth, lockGuard, controller.createDirectConversation);
router.get('/:id/search', requireAuth, lockGuard, controller.searchMessages);
router.get('/:id/messages', requireAuth, lockGuard, controller.getMessages);
router.get('/:id/attachments', requireAuth, lockGuard, controller.getAttachments);
router.patch('/:id/messages/:messageId', requireAuth, lockGuard, controller.editMessage);
router.delete('/:id/messages/:messageId', requireAuth, lockGuard, controller.deleteMessage);
router.patch('/:id/messages/:messageId/pin', requireAuth, lockGuard, controller.setPinned);
router.post('/:id/read', requireAuth, lockGuard, controller.markRead);
router.post('/:id/close', requireAuth, lockGuard, requireRole('management'), controller.closeConversation);
router.post('/:id/leave', requireAuth, lockGuard, controller.leaveConversation);
router.patch('/:id/mute', requireAuth, lockGuard, controller.setMute);

module.exports = router;
