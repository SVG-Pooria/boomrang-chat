const express = require('express');
const controller = require('../controllers/channelFile.controller');
const summaryController = require('../controllers/summary.controller');
const chatHistoryController = require('../controllers/chatHistory.controller');
const requireAuth = require('../middleware/auth.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');

const router = express.Router();

router.get('/:targetType/:targetId', requireAuth, lockGuard, controller.getPanel);
router.get('/:targetType/:targetId/pinned', requireAuth, lockGuard, chatHistoryController.getPinned);
router.get('/:targetType/:targetId/media-archive', requireAuth, lockGuard, controller.downloadMedia);
router.post('/:targetType/:targetId/links', requireAuth, lockGuard, controller.addLink);
router.delete('/links/:linkId', requireAuth, lockGuard, controller.removeLink);
router.post(
    '/:targetType/:targetId/summary',
    requireAuth,
    lockGuard,
    summaryController.requireMember,
    summaryController.publishSummary
);
router.delete(
    '/:targetType/:targetId/summary',
    requireAuth,
    lockGuard,
    summaryController.requireMember,
    summaryController.clearManual
);
router.post('/:targetType/:targetId/polls', requireAuth, lockGuard, controller.createPoll);
router.post('/polls/:pollId/vote', requireAuth, lockGuard, controller.votePoll);
router.post('/polls/:pollId/close', requireAuth, lockGuard, controller.closePoll);

module.exports = router;
