const db = require('../config/database');
const format = require('../utils/persianFormat.util');
const conversationService = require('./conversation.service');
const messageService = require('./message.service');
const capabilityService = require('./capability.service');

const STATUS_LABELS = {
    pending: 'در انتظار پذیرش',
    accepted: 'پذیرفته‌شده',
    declined: 'رد شده',
    done: 'انجام شد',
    failed: 'انجام نشد'
};

const NOTE_MAX = 1000;

function trim(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim().slice(0, NOTE_MAX);
    return trimmed || null;
}

function serialize(row) {
    return {
        referralId: row.id,
        requestId: row.request_id,
        requestTitle: row.request_title,
        requestType: row.request_type,
        requester: row.requester_name || 'کاربر حذف‌شده',
        assigneeId: row.assignee_id,
        assignee: row.assignee_name || 'کاربر حذف‌شده',
        assigneeInitials: format.initials(row.assignee_name),
        referredById: row.referred_by,
        referredBy: row.referred_by_name || 'مدیریت',
        conversationId: row.conversation_id,
        note: row.note || null,
        status: row.status,
        statusLabel: STATUS_LABELS[row.status],
        resultNote: row.result_note || null,
        respondedAt: row.responded_at,
        createdAt: row.created_at
    };
}

const BASE_SELECT = `
    SELECT f.*, r.title AS request_title, r.type AS request_type,
           q.full_name AS requester_name,
           a.full_name AS assignee_name,
           b.full_name AS referred_by_name
    FROM approval_referrals f
    JOIN approval_requests r ON r.id = f.request_id
    LEFT JOIN users q ON q.id = r.requester_id
    LEFT JOIN users a ON a.id = f.assignee_id
    LEFT JOIN users b ON b.id = f.referred_by
`;

async function getById(referralId) {
    const result = await db.query(`${BASE_SELECT} WHERE f.id = $1`, [referralId]);
    return result.rows[0] ? serialize(result.rows[0]) : null;
}

async function listForRequest(requestId) {
    const result = await db.query(`${BASE_SELECT} WHERE f.request_id = $1 ORDER BY f.created_at`, [
        requestId
    ]);
    return result.rows.map(serialize);
}

async function listForViewer(viewer) {
    const result = await db.query(
        `${BASE_SELECT} WHERE f.assignee_id = $1 OR f.referred_by = $1 ORDER BY f.created_at DESC LIMIT 100`,
        [viewer.sub]
    );
    return result.rows.map(serialize);
}

async function countOpenForAssignee(userId) {
    const result = await db.query(
        `SELECT count(*)::int AS count FROM approval_referrals
         WHERE assignee_id = $1 AND status IN ('pending', 'accepted')`,
        [userId]
    );
    return result.rows[0].count;
}

async function createReferral(request, viewer, assigneeId, note) {
    if (assigneeId === viewer.sub) {
        return { error: 'INVALID_ASSIGNEE' };
    }
    const assignee = await db.query('SELECT id, full_name, is_active, is_bot FROM users WHERE id = $1', [
        assigneeId
    ]);
    const person = assignee.rows[0];
    if (!person || !person.is_active || person.is_bot) {
        return { error: 'ASSIGNEE_NOT_FOUND' };
    }
    const open = await db.query(
        `SELECT 1 FROM approval_referrals
         WHERE request_id = $1 AND assignee_id = $2 AND status IN ('pending', 'accepted')`,
        [request.id, assigneeId]
    );
    if (open.rows[0]) {
        return { error: 'REFERRAL_ALREADY_OPEN' };
    }

    const conversation = await conversationService.getOrCreateApprovedDirect(
        assigneeId,
        viewer.sub,
        viewer.sub
    );
    const inserted = await db.query(
        `INSERT INTO approval_referrals (request_id, assignee_id, referred_by, conversation_id, note)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [request.id, assigneeId, viewer.sub, conversation.id, trim(note)]
    );
    const referralId = inserted.rows[0].id;

    const message = await messageService.createMessage({
        conversationId: conversation.id,
        senderId: viewer.sub,
        body: trim(note) || `بررسی درخواست «${request.title}»`,
        type: 'referral'
    });
    await db.query('UPDATE messages SET referral_id = $1 WHERE id = $2', [referralId, message.id]);

    return {
        referral: await getById(referralId),
        conversationId: conversation.id,
        messageId: message.id
    };
}

async function respond(referralId, viewer, accepted) {
    const referral = await getById(referralId);
    if (!referral) {
        return { error: 'NOT_FOUND' };
    }
    if (referral.assigneeId !== viewer.sub) {
        return { error: 'FORBIDDEN' };
    }
    if (referral.status !== 'pending') {
        return { error: 'ALREADY_ANSWERED' };
    }
    await db.query(
        'UPDATE approval_referrals SET status = $2, responded_at = now() WHERE id = $1',
        [referralId, accepted ? 'accepted' : 'declined']
    );
    return { referral: await getById(referralId) };
}

async function report(referralId, viewer, done, note) {
    const referral = await getById(referralId);
    if (!referral) {
        return { error: 'NOT_FOUND' };
    }
    if (referral.assigneeId !== viewer.sub) {
        return { error: 'FORBIDDEN' };
    }
    if (referral.status !== 'accepted') {
        return { error: 'INVALID_TRANSITION' };
    }
    await db.query(
        'UPDATE approval_referrals SET status = $2, result_note = $3, responded_at = now() WHERE id = $1',
        [referralId, done ? 'done' : 'failed', trim(note)]
    );
    return { referral: await getById(referralId) };
}

function canRefer(viewer) {
    return capabilityService.isExecutive(viewer.role);
}

module.exports = {
    STATUS_LABELS,
    canRefer,
    getById,
    listForRequest,
    listForViewer,
    countOpenForAssignee,
    createReferral,
    respond,
    report
};
