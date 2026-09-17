const express = require('express');
const controller = require('../controllers/approval.controller');
const requireAuth = require('../middleware/auth.middleware');
const lockGuard = require('../middleware/lockGuard.middleware');

const router = express.Router();

router.get('/types', requireAuth, lockGuard, controller.listTypes);
router.post('/types', requireAuth, lockGuard, controller.createType);
router.patch('/types/:id', requireAuth, lockGuard, controller.updateType);
router.delete('/types/:id', requireAuth, lockGuard, controller.deleteType);

router.get('/', requireAuth, lockGuard, controller.listApprovals);
router.post('/', requireAuth, lockGuard, controller.createApproval);
router.post('/referrals/:id/respond', requireAuth, lockGuard, controller.respondReferral);
router.post('/referrals/:id/result', requireAuth, lockGuard, controller.reportReferral);
router.post('/:id/decision', requireAuth, lockGuard, controller.decideApproval);
router.get('/:id/referrals', requireAuth, lockGuard, controller.listReferrals);
router.post('/:id/refer', requireAuth, lockGuard, controller.referApproval);

module.exports = router;
