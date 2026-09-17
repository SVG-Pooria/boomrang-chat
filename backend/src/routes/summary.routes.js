const express = require('express');
const controller = require('../controllers/summary.controller');
const requireAuth = require('../middleware/auth.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');

const router = express.Router();

router.get('/:targetType/:targetId', requireAuth, lockGuard, controller.requireMember, controller.getSummary);
router.post(
    '/:targetType/:targetId/refresh',
    requireAuth,
    lockGuard,
    controller.requireMember,
    controller.refreshSummary
);
router.post(
    '/:targetType/:targetId/publish',
    requireAuth,
    lockGuard,
    controller.requireMember,
    controller.publishSummary
);
router.post(
    '/:targetType/:targetId/send',
    requireAuth,
    lockGuard,
    controller.requireMember,
    controller.sendSummary
);
router.delete(
    '/:targetType/:targetId/manual',
    requireAuth,
    lockGuard,
    controller.requireMember,
    controller.clearManual
);

module.exports = router;
