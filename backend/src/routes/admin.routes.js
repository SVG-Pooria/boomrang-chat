const express = require('express');
const controller = require('../controllers/admin.controller');
const requireAuth = require('../middleware/auth.middleware');
const requireRole = require('../middleware/role.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');
const asyncHandler = require('../utils/asyncHandler');
const { uploadOptionalFile } = require('../middleware/upload.middleware');

const router = express.Router();

router.get('/users/:id/password', requireAuth, lockGuard, requireRole('super_admin'), asyncHandler(controller.viewPassword));
router.patch('/users/:id/password', requireAuth, lockGuard, requireRole('super_admin'), asyncHandler(controller.resetPassword));
router.get('/settings/max-file-size', requireAuth, lockGuard, requireRole('super_admin'), asyncHandler(controller.getMaxFileSize));
router.patch('/settings/max-file-size', requireAuth, lockGuard, requireRole('super_admin'), asyncHandler(controller.setMaxFileSize));
router.get('/settings/message-cooldown', requireAuth, lockGuard, requireRole('super_admin'), asyncHandler(controller.getMessageCooldown));
router.patch('/settings/message-cooldown', requireAuth, lockGuard, requireRole('super_admin'), asyncHandler(controller.setMessageCooldown));
router.get('/tags', requireAuth, lockGuard, requireRole('super_admin'), asyncHandler(controller.listTags));
router.post('/tags', requireAuth, lockGuard, requireRole('super_admin'), asyncHandler(controller.createTag));
router.get('/activity-log', requireAuth, lockGuard, requireRole('super_admin'), asyncHandler(controller.getActivityLog));
router.get('/exports', requireAuth, lockGuard, requireRole('super_admin'), asyncHandler(controller.listExports));
router.get('/exports/:id/download', requireAuth, lockGuard, requireRole('super_admin'), asyncHandler(controller.downloadExport));
router.get('/bot/settings', requireAuth, lockGuard, requireRole('super_admin'), asyncHandler(controller.getBotSettings));
router.patch('/bot/settings', requireAuth, lockGuard, requireRole('super_admin'), asyncHandler(controller.updateBotSettings));
router.get('/bot/reminders', requireAuth, lockGuard, requireRole('management', 'super_admin'), asyncHandler(controller.listBotReminders));
router.post('/bot/reminders', requireAuth, lockGuard, requireRole('management', 'super_admin'), uploadOptionalFile, asyncHandler(controller.createBotReminder));
router.put('/bot/reminders/:id', requireAuth, lockGuard, requireRole('management', 'super_admin'), asyncHandler(controller.updateBotReminder));
router.patch('/bot/reminders/:id/active', requireAuth, lockGuard, requireRole('management', 'super_admin'), asyncHandler(controller.setBotReminderActive));
router.patch('/bot/reminders/:id/attachment', requireAuth, lockGuard, requireRole('management', 'super_admin'), uploadOptionalFile, asyncHandler(controller.updateBotReminderAttachment));
router.delete('/bot/reminders/:id', requireAuth, lockGuard, requireRole('management', 'super_admin'), asyncHandler(controller.deleteBotReminder));
router.get('/bot/targets', requireAuth, lockGuard, requireRole('management', 'super_admin'), asyncHandler(controller.listBotTargets));
router.get('/bot/reminders/:id/deliveries', requireAuth, lockGuard, requireRole('management', 'super_admin'), asyncHandler(controller.listBotReminderDeliveries));

router.get('/channels-groups', requireAuth, lockGuard, requireRole('super_admin'), asyncHandler(controller.listChannelsAndGroups));

module.exports = router;
