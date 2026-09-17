const fs = require('fs/promises');
const taskService = require('../services/task.service');
const capabilityService = require('../services/capability.service');
const conversationService = require('../services/conversation.service');
const managementTicketService = require('../services/managementTicket.service');
const fileUploadService = require('../services/fileUpload.service');
const complianceService = require('../services/compliance.service');
const activityLogService = require('../services/activityLog.service');
const notifier = require('../socket/notifier');
const asyncHandler = require('../utils/asyncHandler');

const TICKET_SUBJECT_MAX = 160;

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
    return 400;
}

async function listTasks(req, res) {
    const [tasks, counts, capabilities] = await Promise.all([
        taskService.listForViewer(req.user),
        taskService.countsForViewer(req.user),
        capabilityService.capabilitiesFor(req.user)
    ]);
    return res.status(200).json({ tasks, counts, capabilities });
}

async function createTask(req, res) {
    const { title, description, ownerId, dueAt, priority, tag } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'INVALID_TITLE' });
    }
    if (priority && !taskService.isValidPriority(priority)) {
        return res.status(400).json({ error: 'INVALID_PRIORITY' });
    }
    const assignee = parseId(ownerId);
    if (!assignee) {
        return res.status(400).json({ error: 'INVALID_OWNER' });
    }
    if (!(await capabilityService.has(req.user, 'assign_tasks'))) {
        return res.status(403).json({ error: 'FORBIDDEN' });
    }
    if (!(await taskService.canAssign(assignee, req.user))) {
        return res.status(403).json({ error: 'FORBIDDEN' });
    }

    const task = await taskService.createTask({
        title: title.trim(),
        description,
        ownerId: assignee,
        dueAt: parseDate(dueAt),
        priority,
        tag,
        createdBy: req.user.sub
    });
    await complianceService.recordTeamActivity(
        req.user.sub,
        'task.created',
        `وظیفهٔ «${task.title}» را به ${task.owner} سپرد`,
        { taskId: task.taskId }
    );
    notifier.notifyWorkspaceChanged('tasks');
    return res.status(201).json({ task });
}

async function updateTask(req, res) {
    const taskId = parseId(req.params.id);
    if (!taskId) {
        return res.status(400).json({ error: 'INVALID_TASK_ID' });
    }
    const { title, description, dueAt, priority, tag } = req.body || {};
    if (priority && !taskService.isValidPriority(priority)) {
        return res.status(400).json({ error: 'INVALID_PRIORITY' });
    }
    const patch = { title, priority, tag };
    if (description !== undefined) {
        patch.description = description;
    }
    if (dueAt !== undefined) {
        patch.dueAt = parseDate(dueAt);
    }
    const result = await taskService.updateTask(taskId, req.user, patch);
    if (result.error) {
        return res.status(statusCode(result.error)).json({ error: result.error });
    }
    notifier.notifyWorkspaceChanged('tasks');
    return res.status(200).json({ task: result.task });
}

async function acceptTask(req, res) {
    const taskId = parseId(req.params.id);
    if (!taskId) {
        return res.status(400).json({ error: 'INVALID_TASK_ID' });
    }
    const result = await taskService.acceptTask(taskId, req.user);
    if (result.error) {
        return res.status(statusCode(result.error)).json({ error: result.error });
    }
    await complianceService.recordTeamActivity(
        req.user.sub,
        'task.accepted',
        `وظیفهٔ «${result.task.title}» را پذیرفت`,
        { taskId }
    );
    notifier.notifyWorkspaceChanged('tasks');
    return res.status(200).json({ task: result.task });
}

async function submitTask(req, res) {
    const taskId = parseId(req.params.id);
    if (!taskId) {
        return res.status(400).json({ error: 'INVALID_TASK_ID' });
    }
    const result = await taskService.submitTask(taskId, req.user);
    if (result.error) {
        return res.status(statusCode(result.error)).json({ error: result.error });
    }
    await complianceService.recordTeamActivity(
        req.user.sub,
        'task.submitted',
        `وظیفهٔ «${result.task.title}» را برای بررسی فرستاد`,
        { taskId }
    );
    notifier.notifyWorkspaceChanged('tasks');
    return res.status(200).json({ task: result.task });
}

async function reviewTask(req, res) {
    const taskId = parseId(req.params.id);
    if (!taskId) {
        return res.status(400).json({ error: 'INVALID_TASK_ID' });
    }
    const { approved, note } = req.body || {};
    if (typeof approved !== 'boolean') {
        return res.status(400).json({ error: 'INVALID_DECISION' });
    }
    const result = await taskService.reviewTask(taskId, req.user, approved, note);
    if (result.error) {
        return res.status(statusCode(result.error)).json({ error: result.error });
    }
    if (!approved) {
        await taskService.addReport(taskId, req.user, note, 'review');
    }
    await complianceService.recordTeamActivity(
        req.user.sub,
        approved ? 'task.approved' : 'task.returned',
        approved
            ? `وظیفهٔ «${result.task.title}» را تأیید کرد`
            : `وظیفهٔ «${result.task.title}» را برای اصلاح برگرداند`,
        { taskId }
    );
    notifier.notifyWorkspaceChanged('tasks');
    return res.status(200).json({ task: result.task });
}

async function setProgress(req, res) {
    const taskId = parseId(req.params.id);
    if (!taskId) {
        return res.status(400).json({ error: 'INVALID_TASK_ID' });
    }
    const progress = Number(req.body ? req.body.progress : NaN);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
        return res.status(400).json({ error: 'INVALID_PROGRESS' });
    }
    const result = await taskService.setProgress(taskId, req.user, progress);
    if (result.error) {
        return res.status(statusCode(result.error)).json({ error: result.error });
    }
    notifier.notifyWorkspaceChanged('tasks');
    return res.status(200).json({ task: result.task });
}

async function listReports(req, res) {
    const taskId = parseId(req.params.id);
    if (!taskId) {
        return res.status(400).json({ error: 'INVALID_TASK_ID' });
    }
    if (!(await taskService.canViewTask(taskId, req.user))) {
        return res.status(403).json({ error: 'FORBIDDEN' });
    }
    return res.status(200).json({ reports: await taskService.listReports(taskId) });
}

async function addReport(req, res) {
    const taskId = parseId(req.params.id);
    if (!taskId) {
        return res.status(400).json({ error: 'INVALID_TASK_ID' });
    }
    const body = req.body ? req.body.body : null;
    if ((!body || !String(body).trim()) && !req.body.allowEmpty) {
        return res.status(400).json({ error: 'INVALID_BODY' });
    }
    const result = await taskService.addReport(taskId, req.user, body);
    if (result.error) {
        return res.status(statusCode(result.error)).json({ error: result.error });
    }
    notifier.notifyWorkspaceChanged('tasks');
    return res.status(201).json({ report: result.report });
}

async function addReportFile(req, res) {
    const taskId = parseId(req.params.id);
    const reportId = parseId(req.params.reportId);
    if (!taskId || !reportId) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: 'INVALID_TASK_ID' });
    }
    const report = await taskService.findReport(reportId);
    if (!report || report.task_id !== taskId) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(404).json({ error: 'NOT_FOUND' });
    }
    if (report.author_id !== req.user.sub) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(403).json({ error: 'FORBIDDEN' });
    }

    const stored = await fileUploadService.storeUpload({
        tempPath: req.file.path,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        requestedMode: req.body && req.body.mode === 'compressed' ? 'compressed' : 'file',
        actorId: req.user.sub
    });
    if (stored.status === 'infected') {
        return res.status(422).json({ error: 'INFECTED_FILE' });
    }
    if (stored.status === 'scan_error') {
        return res.status(503).json({ error: 'SCAN_UNAVAILABLE' });
    }

    const fileRecord = await fileUploadService.createFileRecord({
        messageId: reportId,
        storedResult: stored,
        targetTable: 'task_reports'
    });
    await activityLogService.log(req.user.sub, 'task.report.file_added', {
        taskId,
        reportId,
        fileId: fileRecord.id
    });
    notifier.notifyWorkspaceChanged('tasks');
    return res.status(201).json({
        file: {
            id: fileRecord.id,
            mode: fileRecord.mode,
            mimeType: fileRecord.mime_type,
            sizeBytes: fileRecord.size_bytes,
            originalName: fileRecord.original_name
        }
    });
}

async function openTaskChat(req, res) {
    const taskId = parseId(req.params.id);
    if (!taskId) {
        return res.status(400).json({ error: 'INVALID_TASK_ID' });
    }
    const row = await taskService.findRow(taskId);
    if (!row) {
        return res.status(404).json({ error: 'NOT_FOUND' });
    }
    if (!taskService.canSee(row, req.user)) {
        return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const task = await taskService.getById(taskId);
    const message = req.body && typeof req.body.message === 'string' ? req.body.message.trim() : '';

    if (!row.created_by || row.created_by === req.user.sub) {
        return res.status(400).json({ error: 'NO_COUNTERPART' });
    }

    if (capabilityService.isExecutive(task.assignerRole)) {
        const ticket = await managementTicketService.createTicket(
            req.user.sub,
            `وظیفهٔ «${task.title}»`.slice(0, TICKET_SUBJECT_MAX),
            message || `پرسش دربارهٔ وظیفهٔ «${task.title}»`
        );
        notifier.notifyManagementNewTicket(ticket, req.user);
        return res.status(201).json({ ticketId: ticket.id });
    }

    const conversation = await conversationService.getOrCreateDirect(
        req.user.sub,
        row.created_by,
        req.user.sub
    );
    notifier.notifySidebarChanged([req.user.sub, row.created_by]);
    return res.status(200).json({ conversationId: conversation.id });
}

module.exports = {
    listTasks: asyncHandler(listTasks),
    createTask: asyncHandler(createTask),
    updateTask: asyncHandler(updateTask),
    acceptTask: asyncHandler(acceptTask),
    submitTask: asyncHandler(submitTask),
    reviewTask: asyncHandler(reviewTask),
    setProgress: asyncHandler(setProgress),
    listReports: asyncHandler(listReports),
    addReport: asyncHandler(addReport),
    addReportFile: asyncHandler(addReportFile),
    openTaskChat: asyncHandler(openTaskChat)
};
