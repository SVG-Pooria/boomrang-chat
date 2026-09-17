const approvalService = require('../services/approval.service');
const approvalTypeService = require('../services/approvalType.service');
const referralService = require('../services/approvalReferral.service');
const capabilityService = require('../services/capability.service');
const complianceService = require('../services/compliance.service');
const messageService = require('../services/message.service');
const notifier = require('../socket/notifier');
const asyncHandler = require('../utils/asyncHandler');

const DECISION_VERBS = { 'تأیید': 'تأیید کرد', 'رد': 'رد کرد', 'ارجاع': 'برگرداند' };

function parseId(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseDate(value) {
    if (!value) {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function statusCode(error) {
    if (error === 'NOT_FOUND') {
        return 404;
    }
    if (error === 'FORBIDDEN') {
        return 403;
    }
    if (error === 'ALREADY_ANSWERED' || error === 'REFERRAL_ALREADY_OPEN') {
        return 409;
    }
    return 400;
}

async function listTypes(req, res) {
    const includeInactive =
        capabilityService.isExecutive(req.user.role) && req.query.all === '1';
    const types = await approvalTypeService.listTypes({ includeInactive });
    return res.status(200).json({ types });
}

async function createType(req, res) {
    if (!capabilityService.isExecutive(req.user.role)) {
        return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const result = await approvalTypeService.createType(req.body || {}, req.user.sub);
    if (result.error) {
        return res.status(result.error === 'TYPE_EXISTS' ? 409 : 400).json({ error: result.error });
    }
    notifier.notifyWorkspaceChanged('approvals');
    return res.status(201).json({ type: result.type });
}

async function updateType(req, res) {
    if (!capabilityService.isExecutive(req.user.role)) {
        return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const typeId = parseId(req.params.id);
    if (!typeId) {
        return res.status(400).json({ error: 'INVALID_TYPE_ID' });
    }
    const result = await approvalTypeService.updateType(typeId, req.body || {});
    if (result.error) {
        return res.status(statusCode(result.error)).json({ error: result.error });
    }
    notifier.notifyWorkspaceChanged('approvals');
    return res.status(200).json({ type: result.type });
}

async function deleteType(req, res) {
    if (!capabilityService.isExecutive(req.user.role)) {
        return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const typeId = parseId(req.params.id);
    if (!typeId) {
        return res.status(400).json({ error: 'INVALID_TYPE_ID' });
    }
    const result = await approvalTypeService.deleteType(typeId);
    if (result.error) {
        return res.status(statusCode(result.error)).json({ error: result.error });
    }
    notifier.notifyWorkspaceChanged('approvals');
    return res.status(200).json(result.type ? { type: result.type } : { deleted: true });
}

async function listApprovals(req, res) {
    const [approvals, pendingForMe, referrals, types, capabilities] = await Promise.all([
        approvalService.listForViewer(req.user),
        approvalService.countPendingFor(req.user),
        referralService.listForViewer(req.user),
        approvalTypeService.listTypes(),
        capabilityService.capabilitiesFor(req.user)
    ]);
    return res.status(200).json({ approvals, pendingForMe, referrals, types, capabilities });
}

async function createApproval(req, res) {
    const { title, type, priority, amountRials, periodStart, periodEnd, deadlineAt, description } =
        req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'INVALID_TITLE' });
    }
    if (!(await approvalTypeService.exists(type))) {
        return res.status(400).json({ error: 'INVALID_TYPE' });
    }
    if (priority && !approvalService.isValidPriority(priority)) {
        return res.status(400).json({ error: 'INVALID_PRIORITY' });
    }
    const request = await approvalService.createRequest({
        title: title.trim(),
        requesterId: req.user.sub,
        type: type.trim(),
        description: typeof description === 'string' ? description.trim().slice(0, 2000) : null,
        priority: priority || 'عادی',
        amountRials: amountRials ? Number(amountRials) : null,
        periodStart: parseDate(periodStart),
        periodEnd: parseDate(periodEnd),
        deadlineAt: parseDate(deadlineAt)
    });
    await complianceService.recordTeamActivity(
        req.user.sub,
        'approval.submitted',
        `درخواست «${title.trim()}» را در کارتابل ثبت کرد`,
        { requestId: request.id }
    );
    notifier.notifyWorkspaceChanged('approvals');
    return res.status(201).json({ approval: await approvalService.getById(request.id, req.user) });
}

async function decideApproval(req, res) {
    const requestId = parseId(req.params.id);
    const { decision, note } = req.body || {};
    if (!requestId) {
        return res.status(400).json({ error: 'INVALID_REQUEST_ID' });
    }
    if (!approvalService.isValidDecision(decision)) {
        return res.status(400).json({ error: 'INVALID_DECISION' });
    }
    const result = await approvalService.decide(requestId, req.user, decision, note);
    if (result.error === 'NOT_FOUND') {
        return res.status(404).json({ error: 'NOT_FOUND' });
    }
    if (result.error === 'NOT_STEP_APPROVER') {
        return res.status(403).json({ error: 'NOT_STEP_APPROVER' });
    }
    if (result.error === 'ALREADY_DECIDED') {
        return res.status(409).json({ error: 'ALREADY_DECIDED' });
    }
    const approval = await approvalService.getById(requestId, req.user);
    await complianceService.record(
        req.user.sub,
        'approval.decided',
        `${decision} درخواست ${approval.id} با امضای دیجیتال`,
        { requestId, decision, signature: result.signature }
    );
    await complianceService.recordTeamActivity(
        req.user.sub,
        'approval.decided',
        `درخواست «${approval.title}» را ${DECISION_VERBS[decision]}`,
        { requestId, decision }
    );
    notifier.notifyWorkspaceChanged('approvals');
    return res.status(200).json({ approval, signature: result.signature });
}

async function listReferrals(req, res) {
    const requestId = parseId(req.params.id);
    if (!requestId) {
        return res.status(400).json({ error: 'INVALID_REQUEST_ID' });
    }
    const approval = await approvalService.getById(requestId, req.user);
    if (!approval) {
        return res.status(404).json({ error: 'NOT_FOUND' });
    }
    return res.status(200).json({ referrals: await referralService.listForRequest(requestId) });
}

async function referApproval(req, res) {
    const requestId = parseId(req.params.id);
    const assigneeId = parseId(req.body ? req.body.assigneeId : null);
    if (!requestId || !assigneeId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    if (!referralService.canRefer(req.user)) {
        return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const approval = await approvalService.getById(requestId, req.user);
    if (!approval) {
        return res.status(404).json({ error: 'NOT_FOUND' });
    }
    if (approval.status !== 'pending') {
        return res.status(409).json({ error: 'ALREADY_DECIDED' });
    }
    const result = await referralService.createReferral(
        { id: requestId, title: approval.title },
        req.user,
        assigneeId,
        req.body ? req.body.note : null
    );
    if (result.error) {
        return res.status(statusCode(result.error)).json({ error: result.error });
    }
    const message = await messageService.findDeliverableMessage(result.messageId);
    if (message) {
        notifier.notifyConversationMessageCreated(result.conversationId, message);
    }
    notifier.notifySidebarChanged([req.user.sub, assigneeId]);
    await complianceService.recordTeamActivity(
        req.user.sub,
        'approval.referred',
        `بررسی درخواست «${approval.title}» را به ${result.referral.assignee} سپرد`,
        { requestId, referralId: result.referral.referralId }
    );
    notifier.notifyWorkspaceChanged('approvals');
    return res.status(201).json({ referral: result.referral, conversationId: result.conversationId });
}

async function respondReferral(req, res) {
    const referralId = parseId(req.params.id);
    if (!referralId) {
        return res.status(400).json({ error: 'INVALID_REFERRAL_ID' });
    }
    const accepted = Boolean(req.body && req.body.accepted);
    const result = await referralService.respond(referralId, req.user, accepted);
    if (result.error) {
        return res.status(statusCode(result.error)).json({ error: result.error });
    }
    notifier.notifyWorkspaceChanged('approvals');
    return res.status(200).json({ referral: result.referral });
}

async function reportReferral(req, res) {
    const referralId = parseId(req.params.id);
    if (!referralId) {
        return res.status(400).json({ error: 'INVALID_REFERRAL_ID' });
    }
    const done = Boolean(req.body && req.body.done);
    const result = await referralService.report(referralId, req.user, done, req.body && req.body.note);
    if (result.error) {
        return res.status(statusCode(result.error)).json({ error: result.error });
    }
    await complianceService.recordTeamActivity(
        req.user.sub,
        'approval.referral_result',
        done
            ? `بررسی درخواست «${result.referral.requestTitle}» را انجام داد`
            : `بررسی درخواست «${result.referral.requestTitle}» را ناتمام اعلام کرد`,
        { referralId }
    );
    notifier.notifyWorkspaceChanged('approvals');
    return res.status(200).json({ referral: result.referral });
}

module.exports = {
    listTypes: asyncHandler(listTypes),
    createType: asyncHandler(createType),
    updateType: asyncHandler(updateType),
    deleteType: asyncHandler(deleteType),
    listApprovals: asyncHandler(listApprovals),
    createApproval: asyncHandler(createApproval),
    decideApproval: asyncHandler(decideApproval),
    listReferrals: asyncHandler(listReferrals),
    referApproval: asyncHandler(referApproval),
    respondReferral: asyncHandler(respondReferral),
    reportReferral: asyncHandler(reportReferral)
};
