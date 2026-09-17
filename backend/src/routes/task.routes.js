const express = require('express');
const controller = require('../controllers/task.controller');
const requireAuth = require('../middleware/auth.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');
const uploadFile = require('../middleware/upload.middleware');

const router = express.Router();

router.get('/', requireAuth, lockGuard, controller.listTasks);
router.post('/', requireAuth, lockGuard, controller.createTask);
router.patch('/:id', requireAuth, lockGuard, controller.updateTask);
router.post('/:id/accept', requireAuth, lockGuard, controller.acceptTask);
router.post('/:id/submit', requireAuth, lockGuard, controller.submitTask);
router.post('/:id/review', requireAuth, lockGuard, controller.reviewTask);
router.post('/:id/progress', requireAuth, lockGuard, controller.setProgress);
router.get('/:id/reports', requireAuth, lockGuard, controller.listReports);
router.post('/:id/reports', requireAuth, lockGuard, controller.addReport);
router.post('/:id/reports/:reportId/files', requireAuth, lockGuard, uploadFile, controller.addReportFile);
router.post('/:id/chat', requireAuth, lockGuard, controller.openTaskChat);

module.exports = router;
