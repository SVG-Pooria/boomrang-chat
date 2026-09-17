const express = require('express');
const controller = require('../controllers/manager.controller');
const requireAuth = require('../middleware/auth.middleware');
const requireRole = require('../middleware/role.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');

const router = express.Router();
const managerOnly = [requireAuth, lockGuard, requireRole('super_admin', 'management', 'manager')];

router.get('/profile', ...managerOnly, controller.getProfile);
router.get('/overview', ...managerOnly, controller.getOverview);
router.get('/inbox', ...managerOnly, controller.getInbox);
router.get('/tasks', ...managerOnly, controller.getTasks);
router.get('/team', ...managerOnly, controller.getTeam);
router.get('/spaces', ...managerOnly, controller.getSpaces);
router.post('/spaces/:targetType/:targetId/pin', ...managerOnly, controller.setSpacePinned);
router.get('/reports', ...managerOnly, controller.getReports);
router.get('/team/members', ...managerOnly, controller.getTeamMembers);
router.post('/team/:userId/tag', ...managerOnly, controller.setMemberTag);
router.post('/team/:userId/title', ...managerOnly, controller.setMemberTitle);
router.post('/team/:userId/permission', ...managerOnly, controller.setMemberPermission);
router.post('/team/:userId/role', ...managerOnly, controller.setMemberRole);

module.exports = router;
