const crypto = require('crypto');
const db = require('../config/database');
const format = require('../utils/persianFormat.util');
const targetService = require('./workspaceTarget.service');

const PRIORITIES = ['فوری', 'بالا', 'عادی'];
const DECISIONS = ['تأیید', 'رد', 'ارجاع'];

const MANAGER_STEP = {
    step_name: 'تأیید مدیر',
    approver_role: 'manager',
    approver_scope: 'direct_manager'
};

const MANAGEMENT_STEP = {
    step_name: 'تأیید مدیریت',
    approver_role: 'management',
    approver_scope: 'role'
};

async function buildFlow(requesterId) {
    const result = await db.query(
        `SELECT m.id AS manager_id, m.role AS manager_role
         FROM users u LEFT JOIN users m ON m.id = u.manager_id
         WHERE u.id = $1`,
        [requesterId]
    );
    const row = result.rows[0];
    const steps = [];
    if (row && row.manager_id && row.manager_role === 'manager') {
        steps.push(MANAGER_STEP);
    }
    steps.push(MANAGEMENT_STEP);
    return steps;
}

function isValidType(value) {
    return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 60;
}

function isValidPriority(value) {
    return PRIORITIES.includes(value);
}

function isValidDecision(value) {
    return DECISIONS.includes(value);
}

function signatureFor(requestId, stepNumber, userId, decidedAt) {
    return crypto
        .createHash('sha256')
        .update(`${requestId}:${stepNumber}:${userId}:${decidedAt.toISOString()}`)
        .digest('hex')
        .slice(0, 32);
}

function dateLabel(row) {
    if (row.period_start && row.period_end) {
        return `${format.jalaliDate(row.period_start)} تا ${format.jalaliDate(row.period_end)}`;
    }
    return format.jalaliDate(row.created_at);
}

function serialize(row, now = new Date()) {
    const serialized = {
        id: format.referenceId('REQ', row.id),
        requestId: row.id,
        title: row.title,
        description: row.description || null,
        requester: row.requester_name || 'کاربر حذف‌شده',
        requesterId: row.requester_id,
        initials: format.initials(row.requester_name),
        type: row.type,
        date: dateLabel(row),
        deadline: format.deadlineLabel(row.deadline_at, now),
        priority: row.priority,
        step: row.current_step,
        totalSteps: row.total_steps,
        stepName: row.step_name || 'تکمیل‌شده',
        fromChat: row.from_chat || 'گفتگوی شخصی',
        status: row.status,
        canDecide: Boolean(row.can_decide),
        sourceTargetType: row.source_target_type || null,
        sourceTargetId: row.source_target_id || null
    };
    const amount = format.rials(row.amount_rials);
    if (amount) {
        serialized.amount = amount;
    }
    return serialized;
}

async function attachSourceLabels(rows, viewerUserId) {
    return Promise.all(
        rows.map(async (row) => {
            if (!row.source_target_type || !row.source_target_id) {
                return { ...row, from_chat: 'گفتگوی شخصی' };
            }
            const label = await targetService.displayName(
                row.source_target_type,
                row.source_target_id,
                viewerUserId
            );
            return { ...row, from_chat: label };
        })
    );
}

const CAN_DECIDE_SQL = `
    r.status = 'pending' AND (
        $1::varchar = 'super_admin'
        OR (s.approver_scope = 'role' AND s.approver_role = $1)
        OR (
            s.approver_scope = 'direct_manager'
            AND (u.manager_id = $2 OR (u.manager_id IS NULL AND s.approver_role = $1))
        )
    )
`;

function canDecideStep(step, requesterManagerId, viewer) {
    if (viewer.role === 'super_admin') {
        return true;
    }
    if (step.approver_scope === 'direct_manager') {
        if (requesterManagerId) {
            return requesterManagerId === viewer.sub;
        }
        return step.approver_role === viewer.role;
    }
    return step.approver_role === viewer.role;
}

const BASE_SELECT = `
    SELECT r.*,
           u.full_name AS requester_name,
           u.unit AS requester_unit,
           s.step_name,
           s.approver_role,
           s.step_number,
           (${CAN_DECIDE_SQL}) AS can_decide
    FROM approval_requests r
    LEFT JOIN users u ON u.id = r.requester_id
    LEFT JOIN approval_steps s ON s.request_id = r.id AND s.step_number = r.current_step
`;

async function listForViewer(viewer) {
    const result = await db.query(
        `${BASE_SELECT}
         WHERE $1::varchar = 'super_admin' OR r.requester_id = $2 OR u.manager_id = $2 OR (${CAN_DECIDE_SQL})
            OR EXISTS (SELECT 1 FROM approval_steps ds WHERE ds.request_id = r.id AND ds.decided_by = $2)
         ORDER BY r.created_at DESC LIMIT 100`,
        [viewer.role, viewer.sub]
    );
    const enriched = await attachSourceLabels(result.rows, viewer.sub);
    return enriched.map((row) => serialize(row));
}

async function getById(requestId, viewer) {
    const result = await db.query(`${BASE_SELECT} WHERE r.id = $3`, [
        viewer.role,
        viewer.sub,
        requestId
    ]);
    if (!result.rows[0]) {
        return null;
    }
    const [enriched] = await attachSourceLabels(result.rows, viewer.sub);
    return serialize(enriched);
}

async function countPendingFor(viewer) {
    const result = await db.query(
        `SELECT count(*)::int AS count
         FROM approval_requests r
         JOIN approval_steps s ON s.request_id = r.id AND s.step_number = r.current_step
         LEFT JOIN users u ON u.id = r.requester_id
         WHERE ${CAN_DECIDE_SQL}`,
        [viewer.role, viewer.sub]
    );
    return result.rows[0].count;
}

const PRIORITY_TONES = { 'فوری': 'rose', 'بالا': 'lemon', 'عادی': 'sky' };
const CLOSED_STAGE_LABELS = { approved: 'تأییدشده', rejected: 'ردشده', referred: 'برگشت‌خورده' };

function managerStage(row) {
    if (row.status !== 'pending') {
        return CLOSED_STAGE_LABELS[row.status];
    }
    return `مرحله ${format.toPersianDigits(row.current_step)} از ${format.toPersianDigits(row.total_steps)}`;
}

function requestDetails(row) {
    const details = [`نوع: ${row.type}`];
    const amount = format.rials(row.amount_rials);
    if (amount) {
        details.push(`مبلغ: ${amount}`);
    }
    if (row.period_start && row.period_end) {
        details.push(`بازه: ${dateLabel(row)}`);
    }
    if (row.deadline_at) {
        details.push(`مهلت: ${format.deadlineLabel(row.deadline_at)}`);
    }
    details.push(`ثبت‌شده از ${row.from_chat}`);
    return details.join(' • ');
}

function stepTrail(row, steps) {
    const trail = [{ step: 'ثبت توسط کارمند', who: row.requester_name || 'کاربر حذف‌شده', done: true }];
    for (const step of steps) {
        let who = '—';
        if (step.decision) {
            who = `${step.decided_by_name || 'کاربر حذف‌شده'} — ${step.decision}`;
        } else if (row.status === 'pending' && step.step_number === row.current_step) {
            who = row.can_decide ? 'شما — در انتظار' : 'در انتظار';
        }
        trail.push({ step: step.step_name, who, done: step.decision === 'تأیید' });
    }
    return trail;
}

function nextStepName(row, steps) {
    const next = steps.find((step) => step.step_number === row.current_step + 1);
    return next ? next.step_name : null;
}

function serializeForManager(row, steps, now = new Date()) {
    const ownSteps = steps.filter((step) => step.request_id === row.id);
    return {
        id: format.referenceId('REQ', row.id),
        requestId: row.id,
        title: row.title,
        type: row.type,
        requesterId: row.requester_id,
        person: row.requester_name || 'کاربر حذف‌شده',
        unit: row.requester_unit || 'سازمان',
        time: format.dayClock(new Date(row.created_at), now),
        stage: managerStage(row),
        priority: row.priority,
        tone: PRIORITY_TONES[row.priority] || 'sky',
        status: row.status,
        canDecide: Boolean(row.can_decide),
        details: requestDetails(row),
        steps: stepTrail(row, ownSteps),
        stepName: row.status === 'pending' ? row.step_name : null,
        nextStep: row.status === 'pending' ? nextStepName(row, ownSteps) : null
    };
}

async function listForManager(viewer, teamIds) {
    const result = await db.query(
        `${BASE_SELECT}
         WHERE (${CAN_DECIDE_SQL})
            OR r.requester_id = ANY($3::int[])
            OR EXISTS (SELECT 1 FROM approval_steps d WHERE d.request_id = r.id AND d.decided_by = $2)
         ORDER BY (${CAN_DECIDE_SQL}) DESC,
                  (r.status = 'pending') DESC,
                  array_position(ARRAY['فوری', 'بالا', 'عادی']::varchar[], r.priority),
                  r.created_at DESC
         LIMIT 100`,
        [viewer.role, viewer.sub, teamIds]
    );
    if (result.rows.length === 0) {
        return [];
    }
    const steps = await db.query(
        `SELECT s.request_id, s.step_number, s.step_name, s.decision, d.full_name AS decided_by_name
         FROM approval_steps s
         LEFT JOIN users d ON d.id = s.decided_by
         WHERE s.request_id = ANY($1::int[])
         ORDER BY s.request_id, s.step_number`,
        [result.rows.map((row) => row.id)]
    );
    const enriched = await attachSourceLabels(result.rows, viewer.sub);
    const now = new Date();
    return enriched.map((row) => serializeForManager(row, steps.rows, now));
}

async function decisionStats(deciderId, from, to) {
    const result = await db.query(
        `SELECT count(*)::int AS decisions,
                count(*) FILTER (WHERE s.decision = 'تأیید')::int AS approved,
                count(*) FILTER (WHERE s.decision = 'ارجاع')::int AS referred,
                avg(EXTRACT(EPOCH FROM (s.decided_at - COALESCE(prev.decided_at, r.created_at))))::float AS avg_seconds
         FROM approval_steps s
         JOIN approval_requests r ON r.id = s.request_id
         LEFT JOIN approval_steps prev ON prev.request_id = s.request_id AND prev.step_number = s.step_number - 1
         WHERE s.decided_by = $1 AND s.decided_at >= $2 AND s.decided_at < $3`,
        [deciderId, from, to]
    );
    const row = result.rows[0];
    return {
        decisions: row.decisions,
        approved: row.approved,
        referred: row.referred,
        averageMs: row.avg_seconds === null ? null : row.avg_seconds * 1000
    };
}

async function countReferredForRequesters(requesterIds, from, to) {
    const result = await db.query(
        `SELECT count(*)::int AS count
         FROM approval_steps s
         JOIN approval_requests r ON r.id = s.request_id
         WHERE r.requester_id = ANY($1::int[]) AND s.decision = 'ارجاع'
           AND s.decided_at >= $2 AND s.decided_at < $3`,
        [requesterIds, from, to]
    );
    return result.rows[0].count;
}

async function hasRequestsBefore(requesterIds, before) {
    const result = await db.query(
        'SELECT EXISTS (SELECT 1 FROM approval_requests WHERE requester_id = ANY($1::int[]) AND created_at < $2) AS found',
        [requesterIds, before]
    );
    return result.rows[0].found;
}

async function createRequest(input) {
    const flow = await buildFlow(input.requesterId);
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const inserted = await client.query(
            `INSERT INTO approval_requests
                (title, requester_id, type, amount_rials, period_start, period_end, deadline_at,
                 priority, current_step, total_steps, source_target_type, source_target_id, source_message_id,
                 description)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $11, $12, $13)
             RETURNING *`,
            [
                input.title,
                input.requesterId,
                input.type,
                input.amountRials || null,
                input.periodStart || null,
                input.periodEnd || null,
                input.deadlineAt || null,
                input.priority,
                flow.length,
                input.sourceTargetType || null,
                input.sourceTargetId || null,
                input.sourceMessageId || null,
                input.description || null
            ]
        );
        const request = inserted.rows[0];
        for (let index = 0; index < flow.length; index += 1) {
            await client.query(
                `INSERT INTO approval_steps (request_id, step_number, step_name, approver_role, approver_scope)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    request.id,
                    index + 1,
                    flow[index].step_name,
                    flow[index].approver_role,
                    flow[index].approver_scope || 'role'
                ]
            );
        }
        await client.query('COMMIT');
        return request;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function decide(requestId, viewer, decision, note) {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const requestResult = await client.query(
            'SELECT * FROM approval_requests WHERE id = $1 FOR UPDATE',
            [requestId]
        );
        const request = requestResult.rows[0];
        if (!request) {
            await client.query('ROLLBACK');
            return { error: 'NOT_FOUND' };
        }
        if (request.status !== 'pending') {
            await client.query('ROLLBACK');
            return { error: 'ALREADY_DECIDED' };
        }
        const stepResult = await client.query(
            'SELECT * FROM approval_steps WHERE request_id = $1 AND step_number = $2',
            [requestId, request.current_step]
        );
        const step = stepResult.rows[0];
        if (!step) {
            await client.query('ROLLBACK');
            return { error: 'NOT_FOUND' };
        }
        const requester = await client.query('SELECT manager_id FROM users WHERE id = $1', [
            request.requester_id
        ]);
        const requesterManagerId = requester.rows[0] ? requester.rows[0].manager_id : null;
        if (!canDecideStep(step, requesterManagerId, viewer)) {
            await client.query('ROLLBACK');
            return { error: 'NOT_STEP_APPROVER' };
        }

        const decidedAt = new Date();
        await client.query(
            `UPDATE approval_steps
             SET decision = $1, decided_by = $2, decided_at = $3, signature = $4, note = $5
             WHERE id = $6`,
            [
                decision,
                viewer.sub,
                decidedAt,
                signatureFor(requestId, step.step_number, viewer.sub, decidedAt),
                note || null,
                step.id
            ]
        );

        let nextStatus = 'pending';
        let nextStep = request.current_step;
        if (decision === 'رد') {
            nextStatus = 'rejected';
        } else if (decision === 'ارجاع') {
            nextStatus = 'referred';
        } else if (request.current_step >= request.total_steps) {
            nextStatus = 'approved';
        } else {
            nextStep = request.current_step + 1;
        }

        await client.query(
            `UPDATE approval_requests SET status = $1, current_step = $2, updated_at = now() WHERE id = $3`,
            [nextStatus, nextStep, requestId]
        );
        await client.query('COMMIT');
        return { success: true, signature: signatureFor(requestId, step.step_number, viewer.sub, decidedAt) };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    PRIORITIES,
    DECISIONS,
    isValidType,
    isValidPriority,
    isValidDecision,
    listForViewer,
    getById,
    countPendingFor,
    listForManager,
    decisionStats,
    countReferredForRequesters,
    hasRequestsBefore,
    buildFlow,
    createRequest,
    decide
};
