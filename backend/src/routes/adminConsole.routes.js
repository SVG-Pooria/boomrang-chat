const express = require('express');
const controller = require('../controllers/adminConsole.controller');
const spaceSettings = require('../controllers/spaceSettings.controller');
const systemFiles = require('../controllers/systemFiles.controller');
const requireAuth = require('../middleware/auth.middleware');
const requireRole = require('../middleware/role.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');
const uploadAvatarFile = require('../middleware/avatarUpload.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
const superAdminOnly = [requireAuth, lockGuard, requireRole('super_admin')];

router.get('/overview', superAdminOnly, asyncHandler(controller.overview));
router.get('/badges', superAdminOnly, asyncHandler(controller.badges));
router.get('/approvals', superAdminOnly, asyncHandler(controller.listApprovals));

router.get('/users', superAdminOnly, asyncHandler(controller.listUsers));
router.post('/users/:id/archive', superAdminOnly, asyncHandler(controller.archiveUser));

router.get('/settings', superAdminOnly, asyncHandler(controller.getSettings));
router.put('/settings', superAdminOnly, asyncHandler(controller.updateSettings));

router.delete('/tags/:id', superAdminOnly, asyncHandler(controller.deleteTag));

router.get('/spaces', superAdminOnly, asyncHandler(controller.listSpaces));
router.post('/spaces', superAdminOnly, asyncHandler(controller.createSpace));
router.get('/spaces/:kind/:id', superAdminOnly, asyncHandler(spaceSettings.spaceDetails));
router.put('/spaces/:kind/:id', superAdminOnly, asyncHandler(spaceSettings.updateSpaceInfo));
router.delete('/spaces/:kind/:id', superAdminOnly, asyncHandler(spaceSettings.deleteSpace));
router.post('/spaces/:kind/:id/avatar', superAdminOnly, uploadAvatarFile, asyncHandler(spaceSettings.uploadSpaceAvatar));
router.delete('/spaces/:kind/:id/avatar', superAdminOnly, asyncHandler(spaceSettings.removeSpaceAvatar));
router.put('/spaces/:kind/:id/link', superAdminOnly, asyncHandler(spaceSettings.linkSpace));
router.delete('/spaces/:kind/:id/link', superAdminOnly, asyncHandler(spaceSettings.unlinkSpace));
router.post('/spaces/:kind/:id/archive', superAdminOnly, asyncHandler(controller.setSpaceArchived));
router.get('/spaces/:kind/:id/members', superAdminOnly, asyncHandler(controller.spaceMembers));
router.post('/spaces/:kind/:id/members', superAdminOnly, asyncHandler(controller.addSpaceMember));
router.patch('/spaces/:kind/:id/members/:userId', superAdminOnly, asyncHandler(controller.setSpaceMemberRole));
router.patch(
    '/spaces/:kind/:id/members/:userId/permissions',
    superAdminOnly,
    asyncHandler(spaceSettings.setMemberPermissions)
);
router.delete('/spaces/:kind/:id/members/:userId', superAdminOnly, asyncHandler(controller.removeSpaceMember));
router.post('/spaces/:kind/:id/owner', superAdminOnly, asyncHandler(controller.transferSpaceOwner));
router.get('/spaces/:kind/:id/transcript', superAdminOnly, asyncHandler(controller.spaceTranscript));

router.get('/conversations', superAdminOnly, asyncHandler(controller.listConversations));
router.get('/conversations/:id/transcript', superAdminOnly, asyncHandler(controller.conversationTranscript));

router.get('/files', superAdminOnly, asyncHandler(systemFiles.listFiles));
router.delete('/files/:id', superAdminOnly, asyncHandler(systemFiles.deleteFile));

router.get('/forward-queue', superAdminOnly, asyncHandler(systemFiles.forwardQueue));
router.post('/forward-queue/:id/retry', superAdminOnly, asyncHandler(systemFiles.retryForward));
router.delete('/forward-queue/:id', superAdminOnly, asyncHandler(systemFiles.discardForward));

router.get('/sessions', superAdminOnly, asyncHandler(controller.listSessions));
router.delete('/sessions/:id', superAdminOnly, asyncHandler(controller.revokeSession));

router.get('/audit', superAdminOnly, asyncHandler(controller.listAudit));
router.get('/audit/export', superAdminOnly, asyncHandler(controller.exportAudit));

router.get('/backups', superAdminOnly, asyncHandler(controller.listBackups));
router.post('/backups', superAdminOnly, asyncHandler(controller.runBackup));
router.get('/backups/:id/download', superAdminOnly, asyncHandler(controller.downloadBackup));

router.get('/archives', superAdminOnly, asyncHandler(controller.listArchives));
router.get('/reminders', superAdminOnly, asyncHandler(controller.listReminders));

module.exports = router;
