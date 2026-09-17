const express = require('express');
const controller = require('../controllers/meeting.controller');
const requireAuth = require('../middleware/auth.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');

const router = express.Router();

router.get('/', requireAuth, lockGuard, controller.listMeetings);
router.post('/', requireAuth, lockGuard, controller.createMeeting);
router.patch('/:id', requireAuth, lockGuard, controller.updateMeeting);
router.post('/:id/cancel', requireAuth, lockGuard, controller.cancelMeeting);
router.post('/:id/confirm', requireAuth, lockGuard, controller.confirmAttendance);
router.post('/:id/attendance', requireAuth, lockGuard, controller.markAttendance);
router.post('/:id/minutes', requireAuth, lockGuard, controller.saveMinutes);

module.exports = router;
