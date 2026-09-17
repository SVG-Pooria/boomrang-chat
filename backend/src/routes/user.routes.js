const express = require('express');
const controller = require('../controllers/user.controller');
const requireAuth = require('../middleware/auth.middleware');
const requireRole = require('../middleware/role.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/me/status', requireAuth, lockGuard, controller.getMyStatus);
router.patch('/me/status', requireAuth, lockGuard, controller.updateMyStatus);
router.get('/presence', requireAuth, lockGuard, asyncHandler(controller.listPresence));
router.get(
    '/directory',
    requireAuth,
    lockGuard,
    requireRole('employee', 'management', 'super_admin'),
    controller.listDirectory
);
router.get('/', requireAuth, lockGuard, requireRole('management', 'super_admin'), asyncHandler(controller.listUsers));
router.post('/', requireAuth, lockGuard, requireRole('super_admin'), asyncHandler(controller.createUser));
router.patch('/:id/active', requireAuth, lockGuard, requireRole('super_admin'), asyncHandler(controller.setActive));
router.patch('/:id/tag', requireAuth, lockGuard, requireRole('super_admin'), asyncHandler(controller.setTag));
router.patch('/:id/role', requireAuth, lockGuard, requireRole('management', 'super_admin'), asyncHandler(controller.changeRole));
router.delete('/:id', requireAuth, lockGuard, requireRole('super_admin'), asyncHandler(controller.hardDeleteUser));

module.exports = router;
