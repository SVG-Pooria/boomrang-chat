const db = require('../config/database');
const format = require('../utils/persianFormat.util');
const capabilityService = require('./capability.service');

const BOARD = [
    { status: 'در انتظار', managerColumn: 'در انتظار شروع', tone: 'sky' },
    { status: 'در حال انجام', managerColumn: 'در جریان', tone: 'violet' },
    { status: 'بررسی', managerColumn: 'منتظر تأیید مدیر', tone: 'lemon' },
    { status: 'انجام شد', managerColumn: 'انجام‌شده', tone: 'mint' }
];
const STATUSES = BOARD.map((column) => column.status);
const PENDING_STATUS = 'در انتظار';
const ACTIVE_STATUS = 'در حال انجام';
const REVIEW_STATUS = 'بررسی';
const DONE_STATUS = 'انجام شد';
const PRIORITIES = ['فوری', 'بالا', 'عادی'];
const TAG_MAX_LENGTH = 40;
const NOTE_MAX_LENGTH = 2000;

function isValidStatus(value) {
    return STATUSES.includes(value);
}

function isValidPriority(value) {
    return PRIORITIES.includes(value);
}

function normalizeTag(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim().slice(0, TAG_MAX_LENGTH);
    return trimmed || null;
}

function normalizeNote(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim().slice(0, NOTE_MAX_LENGTH);
    return trimmed || null;
}

function serialize(row, now = new Date()) {
    return {
        id: format.referenceId('T', row.id),
        taskId: row.id,
        title: row.title,
        description: row.description || null,
        owner: row.owner_name || 'بدون مسئول',
        initials: format.initials(row.owner_name),
        due: format.dueLabel(row.due_at, now),
        dueAt: row.due_at,
        status: row.status,
        priority: row.priority,
        source: row.source_description || 'ثبت مستقیم',
        progress: row.progress,
        ownerId: row.owner_id,
        tag: row.tag || null,
        assigner: row.assigner_name || 'نامشخص',
        assignerId: row.created_by,
        assignerRole: row.assigner_role || null,
        createdAt: row.created_at,
        acceptedAt: row.accepted_at,
        submittedAt: row.submitted_at,
        reviewedAt: row.reviewed_at,
        reviewNote: row.review_note || null,
        reportCount: row.report_count === undefined ? 0 : row.report_count,
        sourceTargetType: row.source_target_type || null,
        sourceTargetId: row.source_target_id || null
    };
}

function serializeReport(row) {
    return {
        reportId: row.id,
        body: row.body || '',
        kind: row.kind,
        author: row.author_name || 'کاربر حذف‌شده',
        authorId: row.author_id,
        initials: format.initials(row.author_name),
        createdAt: row.created_at,
        files: row.files || []
    };
}

const SELECT_TASK = `
    SELECT t.*, u.full_name AS owner_name, u.manager_id AS owner_manager_id,
           a.full_name AS assigner_name, a.role AS assigner_role,
           (SELECT count(*)::int FROM task_reports r WHERE r.task_id = t.id) AS report_count
    FROM tasks t
    LEFT JOIN users u ON u.id = t.owner_id
    LEFT JOIN users a ON a.id = t.created_by`;

const VISIBLE_TASK_SQL = `($1::varchar IN ('super_admin', 'management')
    OR t.owner_id = $2 OR t.created_by = $2 OR u.manager_id = $2)`;

async function listForViewer(viewer) {
    const result = await db.query(
        `${SELECT_TASK}
         WHERE ${VISIBLE_TASK_SQL}
         ORDER BY t.created_at DESC
         LIMIT 200`,
        [viewer.role, viewer.sub]
    );
    const now = new Date();
    return result.rows.map((row) => serialize(row, now));
}

async function listForOwners(ownerIds, doneSince) {
    const result = await db.query(
        `${SELECT_TASK}
         WHERE t.owner_id = ANY($1::int[])
           AND (t.status <> $2 OR COALESCE(t.completed_at, t.updated_at) >= $3)
         ORDER BY t.due_at ASC NULLS LAST, t.created_at DESC
         LIMIT 400`,
        [ownerIds, DONE_STATUS, doneSince]
    );
    const now = new Date();
    return result.rows.map((row) => serialize(row, now));
}

async function getById(taskId) {
    const result = await db.query(`${SELECT_TASK} WHERE t.id = $1`, [taskId]);
    return result.rows[0] ? serialize(result.rows[0]) : null;
}

async function findRow(taskId) {
    const result = await db.query(
        `SELECT t.*, u.manager_id AS owner_manager_id FROM tasks t
         LEFT JOIN users u ON u.id = t.owner_id
         WHERE t.id = $1`,
        [taskId]
    );
    return result.rows[0] || null;
}

async function countActiveForViewer(viewer) {
    const result = await db.query(
        `SELECT count(*)::int AS count
         FROM tasks t
         LEFT JOIN users u ON u.id = t.owner_id
         WHERE t.status <> $3 AND ${VISIBLE_TASK_SQL}`,
        [viewer.role, viewer.sub, DONE_STATUS]
    );
    return result.rows[0].count;
}

async function countsForViewer(viewer) {
    const result = await db.query(
        `SELECT t.status, count(*)::int AS count
         FROM tasks t
         LEFT JOIN users u ON u.id = t.owner_id
         WHERE ${VISIBLE_TASK_SQL}
         GROUP BY t.status`,
        [viewer.role, viewer.sub]
    );
    const counts = {};
    for (const status of STATUSES) {
        counts[status] = 0;
    }
    for (const row of result.rows) {
        counts[row.status] = row.count;
    }
    return counts;
}

async function countAwaitingAcceptance(userId) {
    const result = await db.query(
        'SELECT count(*)::int AS count FROM tasks WHERE owner_id = $1 AND status = $2',
        [userId, PENDING_STATUS]
    );
    return result.rows[0].count;
}

async function canAssign(ownerId, viewer) {
    if (ownerId === viewer.sub || capabilityService.isExecutive(viewer.role)) {
        return true;
    }
    const result = await db.query('SELECT manager_id, is_active FROM users WHERE id = $1', [ownerId]);
    const owner = result.rows[0];
    if (!owner || !owner.is_active) {
        return false;
    }
    if (owner.manager_id === viewer.sub) {
        return true;
    }
    return capabilityService.has(viewer, 'assign_tasks');
}

function isReviewer(row, viewer) {
    return (
        capabilityService.isExecutive(viewer.role) ||
        row.created_by === viewer.sub ||
        (Boolean(row.owner_manager_id) && row.owner_manager_id === viewer.sub)
    );
}

function canSee(row, viewer) {
    return isReviewer(row, viewer) || row.owner_id === viewer.sub;
}

async function canViewTask(taskId, viewer) {
    const row = await findRow(taskId);
    return Boolean(row) && canSee(row, viewer);
}

async function createTask(input) {
    const status = input.status || PENDING_STATUS;
    const result = await db.query(
        `INSERT INTO tasks
            (title, description, owner_id, due_at, status, priority, source_description, progress,
             source_target_type, source_target_id, created_by, tag, completed_at, accepted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 CASE WHEN $13 THEN now() ELSE NULL END,
                 CASE WHEN $14 THEN now() ELSE NULL END)
         RETURNING id`,
        [
            input.title,
            normalizeNote(input.description),
            input.ownerId || null,
            input.dueAt || null,
            status,
            input.priority || 'عادی',
            input.sourceDescription || null,
            input.progress || 0,
            input.sourceTargetType || null,
            input.sourceTargetId || null,
            input.createdBy,
            normalizeTag(input.tag),
            status === DONE_STATUS,
            status !== PENDING_STATUS
        ]
    );
    return getById(result.rows[0].id);
}

async function canEdit(row, viewer) {
    return isReviewer(row, viewer) || row.owner_id === viewer.sub;
}

async function updateTask(taskId, viewer, patch) {
    const row = await findRow(taskId);
    if (!row) {
        return { error: 'NOT_FOUND' };
    }
    if (!(await canEdit(row, viewer))) {
        return { error: 'FORBIDDEN' };
    }
    if (patch.progress !== undefined && !isReviewer(row, viewer)) {
        return { error: 'FORBIDDEN' };
    }
    const result = await db.query(
        `UPDATE tasks
         SET status = COALESCE($1::varchar, status),
             progress = COALESCE($2::int, progress),
             priority = COALESCE($3::varchar, priority),
             title = COALESCE($4::varchar, title),
             description = CASE WHEN $8::boolean THEN $9::text ELSE description END,
             due_at = CASE WHEN $10::boolean THEN $11::timestamptz ELSE due_at END,
             tag = CASE WHEN $6::boolean THEN $7::varchar ELSE tag END,
             completed_at = CASE
                 WHEN $1::varchar IS NULL THEN completed_at
                 WHEN $1::varchar = $12::varchar THEN COALESCE(completed_at, now())
                 ELSE NULL
             END,
             updated_at = now()
         WHERE id = $5
         RETURNING id`,
        [
            patch.status || null,
            patch.progress === undefined ? null : patch.progress,
            patch.priority || null,
            patch.title || null,
            taskId,
            patch.tag !== undefined,
            normalizeTag(patch.tag),
            patch.description !== undefined,
            normalizeNote(patch.description),
            patch.dueAt !== undefined,
            patch.dueAt || null,
            DONE_STATUS
        ]
    );
    return { task: await getById(result.rows[0].id), previousStatus: row.status };
}

async function moveStatus(taskId, status, extra = {}) {
    await db.query(
        `UPDATE tasks
         SET status = $2::varchar,
             progress = COALESCE($3::int, progress),
             accepted_at = CASE WHEN $4::boolean THEN now() ELSE accepted_at END,
             submitted_at = CASE WHEN $5::boolean THEN now() ELSE submitted_at END,
             reviewed_at = CASE WHEN $6::boolean THEN now() ELSE reviewed_at END,
             reviewed_by = COALESCE($7::int, reviewed_by),
             review_note = CASE WHEN $8::boolean THEN $9::text ELSE review_note END,
             completed_at = CASE WHEN $2::varchar = $10::varchar THEN COALESCE(completed_at, now()) ELSE NULL END,
             updated_at = now()
         WHERE id = $1`,
        [
            taskId,
            status,
            extra.progress === undefined ? null : extra.progress,
            Boolean(extra.accepted),
            Boolean(extra.submitted),
            Boolean(extra.reviewed),
            extra.reviewedBy || null,
            extra.note !== undefined,
            normalizeNote(extra.note),
            DONE_STATUS
        ]
    );
    return getById(taskId);
}

async function acceptTask(taskId, viewer) {
    const row = await findRow(taskId);
    if (!row) {
        return { error: 'NOT_FOUND' };
    }
    if (row.owner_id !== viewer.sub) {
        return { error: 'FORBIDDEN' };
    }
    if (row.status !== PENDING_STATUS) {
        return { error: 'INVALID_TRANSITION' };
    }
    return { task: await moveStatus(taskId, ACTIVE_STATUS, { accepted: true }) };
}

async function submitTask(taskId, viewer) {
    const row = await findRow(taskId);
    if (!row) {
        return { error: 'NOT_FOUND' };
    }
    if (row.owner_id !== viewer.sub) {
        return { error: 'FORBIDDEN' };
    }
    if (row.status !== ACTIVE_STATUS) {
        return { error: 'INVALID_TRANSITION' };
    }
    return { task: await moveStatus(taskId, REVIEW_STATUS, { submitted: true }) };
}

async function reviewTask(taskId, viewer, approved, note) {
    const row = await findRow(taskId);
    if (!row) {
        return { error: 'NOT_FOUND' };
    }
    if (!isReviewer(row, viewer)) {
        return { error: 'FORBIDDEN' };
    }
    if (row.status !== REVIEW_STATUS) {
        return { error: 'INVALID_TRANSITION' };
    }
    const task = await moveStatus(taskId, approved ? DONE_STATUS : ACTIVE_STATUS, {
        reviewed: true,
        reviewedBy: viewer.sub,
        note: approved ? null : note,
        ...(approved ? { progress: 100 } : {})
    });
    return { task };
}

async function setProgress(taskId, viewer, progress) {
    const row = await findRow(taskId);
    if (!row) {
        return { error: 'NOT_FOUND' };
    }
    if (!isReviewer(row, viewer)) {
        return { error: 'FORBIDDEN' };
    }
    await db.query('UPDATE tasks SET progress = $2, updated_at = now() WHERE id = $1', [taskId, progress]);
    return { task: await getById(taskId) };
}

async function addReport(taskId, viewer, body, kind = 'progress') {
    const row = await findRow(taskId);
    if (!row) {
        return { error: 'NOT_FOUND' };
    }
    if (!canSee(row, viewer)) {
        return { error: 'FORBIDDEN' };
    }
    const result = await db.query(
        `INSERT INTO task_reports (task_id, author_id, body, kind)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [taskId, viewer.sub, normalizeNote(body), kind]
    );
    const reports = await listReports(taskId);
    return { report: reports.find((item) => item.reportId === result.rows[0].id) || null };
}

async function listReports(taskId) {
    const result = await db.query(
        `SELECT r.*, u.full_name AS author_name,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', f.id,
                            'mode', f.mode,
                            'mimeType', f.mime_type,
                            'sizeBytes', f.size_bytes,
                            'originalName', f.original_name
                        ) ORDER BY f.id
                    ) FILTER (WHERE f.id IS NOT NULL),
                    '[]'
                ) AS files
         FROM task_reports r
         LEFT JOIN users u ON u.id = r.author_id
         LEFT JOIN message_files f ON f.task_report_id = r.id
         WHERE r.task_id = $1
         GROUP BY r.id, u.full_name
         ORDER BY r.created_at ASC, r.id ASC`,
        [taskId]
    );
    return result.rows.map(serializeReport);
}

async function findReport(reportId) {
    const result = await db.query('SELECT * FROM task_reports WHERE id = $1', [reportId]);
    return result.rows[0] || null;
}

module.exports = {
    BOARD,
    STATUSES,
    PENDING_STATUS,
    ACTIVE_STATUS,
    REVIEW_STATUS,
    DONE_STATUS,
    PRIORITIES,
    isValidStatus,
    isValidPriority,
    isReviewer,
    canSee,
    canViewTask,
    listForViewer,
    listForOwners,
    getById,
    findRow,
    countActiveForViewer,
    countsForViewer,
    countAwaitingAcceptance,
    canAssign,
    createTask,
    updateTask,
    acceptTask,
    submitTask,
    reviewTask,
    setProgress,
    addReport,
    listReports,
    findReport
};
