const express = require('express');
const controller = require('../controllers/managementTicket.controller');
const requireAuth = require('../middleware/auth.middleware');
const requireRole = require('../middleware/role.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');

const router = express.Router();

router.post('/', requireAuth, lockGuard, requireRole('employee'), controller.createTicket);
router.get('/mine', requireAuth, lockGuard, requireRole('employee'), controller.listMine);
router.get('/', requireAuth, lockGuard, requireRole('management'), controller.listQueue);
router.post('/:id/approve', requireAuth, lockGuard, requireRole('management'), controller.approve);
router.post('/:id/reject', requireAuth, lockGuard, requireRole('management'), controller.reject);

module.exports = router;
