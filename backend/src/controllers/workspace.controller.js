const approvalService = require('../services/approval.service');
const taskService = require('../services/task.service');
const meetingService = require('../services/meeting.service');
const directoryService = require('../services/directory.service');
const announcementService = require('../services/announcement.service');
const complianceService = require('../services/compliance.service');
const targetService = require('../services/workspaceTarget.service');
const summaryService = require('../services/summary.service');
const notifier = require('../socket/notifier');
const asyncHandler = require('../utils/asyncHandler');

const DECISION_VERBS = { 'تأیید': 'تأیید کرد', 'رد': 'رد کرد', 'ارجاع': 'برگشت داد' };

function parseId(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseDate(value) {
    if (!value) {
        return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function assertSource(req) {
    const { sourceTargetType, sourceTargetId } = req.body || {};
    if (!sourceTargetType || !sourceTargetId) {
        return { ok: true, sourceTargetType: null, sourceTargetId: null };
    }
    if (!targetService.isValidTargetType(sourceTargetType)) {
        return { ok: false, error: 'INVALID_TARGET_TYPE' };
    }
    const targetId = parseId(sourceTargetId);
    if (!targetId) {
        return { ok: false, error: 'INVALID_TARGET_ID' };
    }
    const membership = await targetService.getMembership(sourceTargetType, targetId, req.user.sub);
    if (!membership) {
        return { ok: false, error: 'NOT_A_MEMBER' };
    }
    return { ok: true, sourceTargetType, sourceTargetId: targetId };
}

async function listApprovals(req, res) {
    const items = await approvalService.listForViewer(req.user);
    const pending = await approvalService.countPendingFor(req.user);
    return res.status(200).json({ approvals: items, pendingForMe: pending });
}

async function createApproval(req, res) {
    const { title, type, priority, amountRials, periodStart, periodEnd, deadlineAt } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'INVALID_TITLE' });
    }
    if (!(await require('../services/approvalType.service').exists(type))) {
        return res.status(400).json({ error: 'INVALID_TYPE' });
    }
    if (priority && !approvalService.isValidPriority(priority)) {
        return res.status(400).json({ error: 'INVALID_PRIORITY' });
    }
    const source = await assertSource(req);
    if (!source.ok) {
        return res.status(source.error === 'NOT_A_MEMBER' ? 403 : 400).json({ error: source.error });
    }

    const request = await approvalService.createRequest({
        title: title.trim(),
        requesterId: req.user.sub,
        type,
        priority: priority || 'عادی',
        amountRials: amountRials ? Number(amountRials) : null,
        periodStart: parseDate(periodStart),
        periodEnd: parseDate(periodEnd),
        deadlineAt: parseDate(deadlineAt),
        sourceTargetType: source.sourceTargetType,
        sourceTargetId: source.sourceTargetId
    });

    await complianceService.record(
        req.user.sub,
        'approval.created',
        `ثبت درخواست «${title.trim()}» در کارتابل`,
        { requestId: request.id, type }
    );
    await complianceService.recordTeamActivity(
        req.user.sub,
        'approval.submitted',
        `درخواست «${title.trim()}» را در کارتابل ثبت کرد`,
        { requestId: request.id }
    );
    const serialized = await approvalService.getById(request.id, req.user);
    notifier.notifyWorkspaceChanged('approvals');
    summaryService.touch(source.sourceTargetType, source.sourceTargetId, { force: true });
    return res.status(201).json({ approval: serialized });
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
    const serialized = await approvalService.getById(requestId, req.user);
    await complianceService.record(
        req.user.sub,
        'approval.decided',
        `${decision} درخواست ${serialized.id} با امضای دیجیتال`,
        { requestId, decision, signature: result.signature }
    );
    await complianceService.recordTeamActivity(
        req.user.sub,
        'approval.decided',
        `درخواست «${serialized.title}» را ${DECISION_VERBS[decision]}`,
        { requestId, decision }
    );
    notifier.notifyWorkspaceChanged('approvals');
    return res.status(200).json({ approval: serialized, signature: result.signature });
}

async function listTasks(req, res) {
    const [items, active] = await Promise.all([
        taskService.listForViewer(req.user),
        taskService.countActiveForViewer(req.user)
    ]);
    return res.status(200).json({ tasks: items, activeCount: active });
}

async function createTask(req, res) {
    const { title, ownerId, dueAt, priority, sourceDescription, progress, status, tag } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'INVALID_TITLE' });
    }
    if (priority && !taskService.isValidPriority(priority)) {
        return res.status(400).json({ error: 'INVALID_PRIORITY' });
    }
    if (status && !taskService.isValidStatus(status)) {
        return res.status(400).json({ error: 'INVALID_STATUS' });
    }
    const source = await assertSource(req);
    if (!source.ok) {
        return res.status(source.error === 'NOT_A_MEMBER' ? 403 : 400).json({ error: source.error });
    }

    const assignee = parseId(ownerId) || req.user.sub;
    if (!(await taskService.canAssign(assignee, req.user))) {
        return res.status(403).json({ error: 'FORBIDDEN' });
    }

    const task = await taskService.createTask({
        title: title.trim(),
        ownerId: assignee,
        dueAt: parseDate(dueAt),
        status,
        priority,
        sourceDescription,
        progress: progress === undefined ? 0 : Number(progress),
        sourceTargetType: source.sourceTargetType,
        sourceTargetId: source.sourceTargetId,
        createdBy: req.user.sub,
        tag
    });
    await complianceService.recordTeamActivity(
        req.user.sub,
        'task.created',
        task.ownerId && task.ownerId !== req.user.sub
            ? `وظیفهٔ «${task.title}» را به ${task.owner} سپرد`
            : `وظیفهٔ «${task.title}» را ساخت`,
        { taskId: task.taskId }
    );
    notifier.notifyWorkspaceChanged('tasks');
    summaryService.touch(source.sourceTargetType, source.sourceTargetId, { force: true });
    return res.status(201).json({ task });
}

async function updateTask(req, res) {
    const taskId = parseId(req.params.id);
    if (!taskId) {
        return res.status(400).json({ error: 'INVALID_TASK_ID' });
    }
    const { status, progress, priority, title, tag } = req.body || {};
    if (status && !taskService.isValidStatus(status)) {
        return res.status(400).json({ error: 'INVALID_STATUS' });
    }
    if (priority && !taskService.isValidPriority(priority)) {
        return res.status(400).json({ error: 'INVALID_PRIORITY' });
    }
    if (progress !== undefined && (Number(progress) < 0 || Number(progress) > 100)) {
        return res.status(400).json({ error: 'INVALID_PROGRESS' });
    }
    const result = await taskService.updateTask(taskId, req.user, {
        status,
        progress: progress === undefined ? undefined : Number(progress),
        priority,
        title,
        tag
    });
    if (result.error === 'NOT_FOUND') {
        return res.status(404).json({ error: 'NOT_FOUND' });
    }
    if (result.error === 'FORBIDDEN') {
        return res.status(403).json({ error: 'FORBIDDEN' });
    }
    if (status && status !== result.previousStatus) {
        await complianceService.recordTeamActivity(
            req.user.sub,
            'task.moved',
            `وظیفهٔ «${result.task.title}» را به «${status}» برد`,
            { taskId, from: result.previousStatus, to: status }
        );
    }
    notifier.notifyWorkspaceChanged('tasks');
    return res.status(200).json({ task: result.task });
}

async function listMeetings(req, res) {
    const [items, upcoming] = await Promise.all([
        meetingService.listForUser(req.user),
        meetingService.countUpcoming(req.user)
    ]);
    return res.status(200).json({ meetings: items, upcomingCount: upcoming });
}

async function createMeeting(req, res) {
    const { title, startsAt, endsAt, room, attendeeIds } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'INVALID_TITLE' });
    }
    const starts = parseDate(startsAt);
    const ends = parseDate(endsAt);
    if (!starts || !ends || ends.getTime() <= starts.getTime()) {
        return res.status(400).json({ error: 'INVALID_TIME_RANGE' });
    }
    const source = await assertSource(req);
    if (!source.ok) {
        return res.status(source.error === 'NOT_A_MEMBER' ? 403 : 400).json({ error: source.error });
    }

    let resolvedAttendees = Array.isArray(attendeeIds) ? attendeeIds.map(parseId).filter(Boolean) : [];
    if (resolvedAttendees.length === 0 && source.sourceTargetType) {
        resolvedAttendees = await targetService.listMemberIds(
            source.sourceTargetType,
            source.sourceTargetId
        );
    }

    const meeting = await meetingService.createMeeting({
        title: title.trim(),
        startsAt: starts,
        endsAt: ends,
        room,
        attendeeIds: resolvedAttendees,
        sourceTargetType: source.sourceTargetType,
        sourceTargetId: source.sourceTargetId,
        createdBy: req.user.sub
    });
    notifier.notifyWorkspaceChanged('meetings');
    summaryService.touch(source.sourceTargetType, source.sourceTargetId, { force: true });
    return res.status(201).json({ meeting });
}

async function saveMinutes(req, res) {
    const meetingId = parseId(req.params.id);
    const { minutes, actionsCount } = req.body || {};
    if (!meetingId) {
        return res.status(400).json({ error: 'INVALID_MEETING_ID' });
    }
    if (!Array.isArray(minutes) || minutes.some((line) => typeof line !== 'string' || !line.trim())) {
        return res.status(400).json({ error: 'INVALID_MINUTES' });
    }
    const result = await meetingService.saveMinutes(
        meetingId,
        req.user,
        minutes.map((line) => line.trim()),
        actionsCount === undefined ? null : Number(actionsCount)
    );
    if (result.error) {
        const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'FORBIDDEN' ? 403 : 400;
        return res.status(status).json({ error: result.error });
    }
    notifier.notifyWorkspaceChanged('meetings');
    return res.status(200).json({ meeting: result.meeting });
}

async function listDirectory(req, res) {
    const people = await directoryService.listDirectory();
    return res.status(200).json({ directory: people });
}

async function setLeave(req, res) {
    const userId = parseId(req.params.id);
    const { startDate, endDate } = req.body || {};
    if (!userId || !parseDate(startDate) || !parseDate(endDate)) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const result = await directoryService.setLeave(userId, req.user, startDate, endDate);
    if (result.error) {
        return res.status(403).json({ error: result.error });
    }
    await complianceService.record(req.user.sub, 'leave.set', 'ثبت مرخصی برای همکار', { userId });
    notifier.notifyWorkspaceChanged('directory');
    return res.status(201).json({ leave: result.leave });
}

async function listAnnouncements(req, res) {
    const items = await announcementService.listForUser(req.user);
    await announcementService.markSeenAll(req.user.sub);
    const pending = await announcementService.countPendingAck(req.user);
    return res.status(200).json({ announcements: items, pendingAck: pending });
}

async function acknowledgeAnnouncement(req, res) {
    const announcementId = parseId(req.params.id);
    if (!announcementId) {
        return res.status(400).json({ error: 'INVALID_ANNOUNCEMENT_ID' });
    }
    const result = await announcementService.acknowledge(announcementId, req.user.sub);
    if (result.error) {
        return res.status(404).json({ error: result.error });
    }
    notifier.notifyWorkspaceChanged('announcements');
    return res.status(200).json({ success: true });
}

async function createAnnouncement(req, res) {
    const { title, body, tone, mustAck } = req.body || {};
    if (!title || !body) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    if (tone && !announcementService.isValidTone(tone)) {
        return res.status(400).json({ error: 'INVALID_TONE' });
    }
    const id = await announcementService.createAnnouncement({
        title,
        body,
        authorId: req.user.sub,
        authorDisplay: req.user.fullName,
        tone: tone || 'عادی',
        mustAck: Boolean(mustAck)
    });
    await complianceService.record(req.user.sub, 'announcement.published', `انتشار ابلاغیه «${title}»`, {
        announcementId: id
    });
    notifier.notifyWorkspaceChanged('announcements');
    return res.status(201).json({ announcementId: id });
}

async function getCompliance(req, res) {
    const [stats, log] = await Promise.all([complianceService.stats(), complianceService.auditLog()]);
    return res.status(200).json({ stats, auditLog: log });
}

module.exports = {
    listApprovals: asyncHandler(listApprovals),
    createApproval: asyncHandler(createApproval),
    decideApproval: asyncHandler(decideApproval),
    listTasks: asyncHandler(listTasks),
    createTask: asyncHandler(createTask),
    updateTask: asyncHandler(updateTask),
    listMeetings: asyncHandler(listMeetings),
    createMeeting: asyncHandler(createMeeting),
    saveMinutes: asyncHandler(saveMinutes),
    listDirectory: asyncHandler(listDirectory),
    setLeave: asyncHandler(setLeave),
    listAnnouncements: asyncHandler(listAnnouncements),
    acknowledgeAnnouncement: asyncHandler(acknowledgeAnnouncement),
    createAnnouncement: asyncHandler(createAnnouncement),
    getCompliance: asyncHandler(getCompliance)
};
