const express = require('express');
const controller = require('../controllers/workspace.controller');
const requireAuth = require('../middleware/auth.middleware');
const requireRole = require('../middleware/role.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');

const router = express.Router();

router.get('/approvals', requireAuth, lockGuard, controller.listApprovals);
router.post('/approvals', requireAuth, lockGuard, controller.createApproval);
router.post('/approvals/:id/decision', requireAuth, lockGuard, controller.decideApproval);

router.get('/tasks', requireAuth, lockGuard, controller.listTasks);
router.post('/tasks', requireAuth, lockGuard, controller.createTask);
router.patch('/tasks/:id', requireAuth, lockGuard, controller.updateTask);

router.get('/meetings', requireAuth, lockGuard, controller.listMeetings);
router.post('/meetings', requireAuth, lockGuard, controller.createMeeting);
router.post('/meetings/:id/minutes', requireAuth, lockGuard, controller.saveMinutes);

router.get('/directory', requireAuth, lockGuard, controller.listDirectory);
router.post('/directory/:id/leave', requireAuth, lockGuard, controller.setLeave);

router.get('/announcements', requireAuth, lockGuard, controller.listAnnouncements);
router.post(
    '/announcements',
    requireAuth,
    lockGuard,
    requireRole('management', 'super_admin'),
    controller.createAnnouncement
);
router.post('/announcements/:id/ack', requireAuth, lockGuard, controller.acknowledgeAnnouncement);

router.get('/compliance', requireAuth, lockGuard, controller.getCompliance);

module.exports = router;
