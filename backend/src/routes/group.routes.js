const express = require('express');
const controller = require('../controllers/group.controller');
const requireAuth = require('../middleware/auth.middleware');
const requireRole = require('../middleware/role.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');

const router = express.Router();

router.post(
    '/',
    requireAuth,
    lockGuard,
    requireRole('super_admin', 'management', 'manager'),
    controller.createGroup
);
router.get('/', requireAuth, lockGuard, controller.listGroups);
router.post('/:id/read', requireAuth, lockGuard, controller.markRead);
router.get('/:id', requireAuth, lockGuard, controller.getGroup);
router.put('/:id', requireAuth, lockGuard, controller.updateGroup);
router.delete('/:id', requireAuth, lockGuard, controller.deleteGroup);

router.patch('/:id/manager', requireAuth, lockGuard, requireRole('super_admin'), controller.transferManager);

router.get('/:id/members', requireAuth, lockGuard, controller.listMembers);
router.post('/:id/members', requireAuth, lockGuard, controller.addMember);
router.delete('/:id/members/:userId', requireAuth, lockGuard, controller.removeMember);
router.patch('/:id/members/:userId/role', requireAuth, lockGuard, controller.setMemberRole);

router.get('/:id/search', requireAuth, lockGuard, controller.searchMessages);
router.get('/:id/messages', requireAuth, lockGuard, controller.listMessages);
router.get('/:id/attachments', requireAuth, lockGuard, controller.getAttachments);
router.patch('/:id/mute', requireAuth, lockGuard, controller.setMute);
router.post('/:id/messages', requireAuth, lockGuard, controller.createMessage);
router.patch('/:id/messages/:messageId', requireAuth, lockGuard, controller.editMessage);
router.delete('/:id/messages/:messageId', requireAuth, lockGuard, controller.deleteMessage);
router.patch('/:id/messages/:messageId/pin', requireAuth, lockGuard, controller.setPinned);

module.exports = router;
