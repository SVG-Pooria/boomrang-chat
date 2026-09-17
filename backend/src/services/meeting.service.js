const db = require('../config/database');
const format = require('../utils/persianFormat.util');
const capabilityService = require('./capability.service');

const DEFAULT_ROOM = 'اتاق تصویری داخلی — سرور سازمان';
const SCOPES = ['participant', 'organizer', 'all'];
const TITLE_MAX = 255;
const LOCATION_MAX = 200;
const DESCRIPTION_MAX = 2000;

function statusOf(row, now = new Date()) {
    const starts = new Date(row.starts_at);
    const ends = new Date(row.ends_at);
    if (row.canceled_at) {
        return 'لغو شده';
    }
    if (ends.getTime() < now.getTime()) {
        return 'برگزار شده';
    }
    if (format.daysBetween(now, starts) === 0) {
        return 'امروز';
    }
    return 'آینده';
}

function trim(value, max) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim().slice(0, max);
    return trimmed || null;
}

function serialize(row, now = new Date()) {
    const status = statusOf(row, now);
    const participants = (row.participants || []).map((person) => ({
        userId: person.userId,
        name: person.name,
        initials: format.initials(person.name),
        confirmed: Boolean(person.confirmedAt),
        attended: Boolean(person.attendedAt)
    }));
    const serialized = {
        id: format.referenceId('M', row.id),
        meetingId: row.id,
        ownerId: row.created_by,
        organizer: row.organizer_name || 'نامشخص',
        title: row.title,
        description: row.description || null,
        location: row.location || row.room || DEFAULT_ROOM,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        time: format.timeRange(new Date(row.starts_at), new Date(row.ends_at)),
        jalali: format.jalaliDayLabel(new Date(row.starts_at), now),
        room: row.room || DEFAULT_ROOM,
        attendees: participants.map((person) => person.initials),
        participants,
        attendeeCount: participants.length,
        confirmedCount: participants.filter((person) => person.confirmed).length,
        attendedCount: participants.filter((person) => person.attended).length,
        status,
        canceled: Boolean(row.canceled_at),
        sourceTargetType: row.source_target_type || null,
        sourceTargetId: row.source_target_id || null
    };
    if (Array.isArray(row.minutes) && row.minutes.length > 0) {
        serialized.minutes = row.minutes;
        serialized.decisions = row.decisions_count ?? row.minutes.length;
        serialized.actions = row.actions_count ?? 0;
    }
    return serialized;
}

const BASE_SELECT = `
    SELECT m.*, o.full_name AS organizer_name,
           COALESCE(
               array_agg(u.full_name ORDER BY u.full_name) FILTER (WHERE u.id IS NOT NULL),
               '{}'
           ) AS attendee_names,
           COALESCE(
               json_agg(
                   json_build_object(
                       'userId', u.id,
                       'name', u.full_name,
                       'confirmedAt', a.confirmed_at,
                       'attendedAt', a.attended_at
                   ) ORDER BY u.full_name
               ) FILTER (WHERE u.id IS NOT NULL),
               '[]'
           ) AS participants
    FROM meetings m
    LEFT JOIN users o ON o.id = m.created_by
    LEFT JOIN meeting_attendees a ON a.meeting_id = m.id
    LEFT JOIN users u ON u.id = a.user_id
`;

const GROUP_BY = 'GROUP BY m.id, o.full_name';
const TIMELINE_ORDER = `ORDER BY (m.ends_at < now()) ASC,
    CASE WHEN m.ends_at >= now() THEN m.starts_at END ASC,
    m.starts_at DESC`;

const VISIBLE_MEETING_SQL = `($1::varchar = 'super_admin' OR m.created_by = $2
    OR EXISTS (SELECT 1 FROM meeting_attendees va WHERE va.meeting_id = m.id AND va.user_id = $2))`;

function isValidScope(value) {
    return SCOPES.includes(value);
}

async function listForUser(viewer) {
    const result = await db.query(
        `${BASE_SELECT} WHERE ${VISIBLE_MEETING_SQL} ${GROUP_BY} ${TIMELINE_ORDER} LIMIT 100`,
        [viewer.role, viewer.sub]
    );
    const now = new Date();
    return result.rows.map((row) => serialize(row, now));
}

async function listForViewer(viewer, scope = 'participant') {
    const executive = capabilityService.isExecutive(viewer.role);
    const attending = 'EXISTS (SELECT 1 FROM meeting_attendees va WHERE va.meeting_id = m.id AND va.user_id = $1)';
    let condition;
    let params = [viewer.sub];
    if (scope === 'organizer') {
        condition = 'm.created_by = $1';
    } else if (scope === 'all') {
        if (executive) {
            condition = 'true';
            params = [];
        } else {
            condition = `(m.created_by = $1 OR ${attending})`;
        }
    } else {
        condition = attending;
    }
    const result = await db.query(
        `${BASE_SELECT} WHERE ${condition} ${GROUP_BY} ${TIMELINE_ORDER} LIMIT 200`,
        params
    );
    const now = new Date();
    return result.rows.map((row) => serialize(row, now));
}

async function getById(meetingId) {
    const result = await db.query(`${BASE_SELECT} WHERE m.id = $1 ${GROUP_BY}`, [meetingId]);
    return result.rows[0] ? serialize(result.rows[0]) : null;
}

async function findRow(meetingId) {
    const result = await db.query('SELECT * FROM meetings WHERE id = $1', [meetingId]);
    return result.rows[0] || null;
}

async function countUpcoming(viewer, now = new Date()) {
    const result = await db.query(
        `SELECT count(*)::int AS count FROM meetings m
         WHERE m.ends_at >= $3 AND m.canceled_at IS NULL AND ${VISIBLE_MEETING_SQL}`,
        [viewer.role, viewer.sub, now]
    );
    return result.rows[0].count;
}

async function countAwaitingConfirmation(userId, now = new Date()) {
    const result = await db.query(
        `SELECT count(*)::int AS count
         FROM meeting_attendees a
         JOIN meetings m ON m.id = a.meeting_id
         WHERE a.user_id = $1 AND a.confirmed_at IS NULL AND m.ends_at >= $2 AND m.canceled_at IS NULL`,
        [userId, now]
    );
    return result.rows[0].count;
}

async function createMeeting(input) {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const inserted = await client.query(
            `INSERT INTO meetings
                (title, starts_at, ends_at, room, location, description,
                 source_target_type, source_target_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            [
                trim(input.title, TITLE_MAX),
                input.startsAt,
                input.endsAt,
                input.room || DEFAULT_ROOM,
                trim(input.location, LOCATION_MAX),
                trim(input.description, DESCRIPTION_MAX),
                input.sourceTargetType || null,
                input.sourceTargetId || null,
                input.createdBy
            ]
        );
        const meetingId = inserted.rows[0].id;
        const attendees = new Set([input.createdBy, ...(input.attendeeIds || [])]);
        for (const userId of attendees) {
            await client.query(
                `INSERT INTO meeting_attendees (meeting_id, user_id, invited_by, confirmed_at)
                 VALUES ($1, $2, $3, CASE WHEN $4::boolean THEN now() ELSE NULL END)
                 ON CONFLICT DO NOTHING`,
                [meetingId, userId, input.createdBy, userId === input.createdBy]
            );
        }
        await client.query('COMMIT');
        return getById(meetingId);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

function canManage(row, viewer) {
    return row.created_by === viewer.sub || capabilityService.isExecutive(viewer.role);
}

async function updateMeeting(meetingId, viewer, patch) {
    const row = await findRow(meetingId);
    if (!row) {
        return { error: 'NOT_FOUND' };
    }
    if (!canManage(row, viewer)) {
        return { error: 'FORBIDDEN' };
    }
    await db.query(
        `UPDATE meetings
         SET title = COALESCE($2::varchar, title),
             starts_at = COALESCE($3::timestamptz, starts_at),
             ends_at = COALESCE($4::timestamptz, ends_at),
             location = CASE WHEN $5::boolean THEN $6::varchar ELSE location END,
             description = CASE WHEN $7::boolean THEN $8::text ELSE description END
         WHERE id = $1`,
        [
            meetingId,
            trim(patch.title, TITLE_MAX),
            patch.startsAt || null,
            patch.endsAt || null,
            patch.location !== undefined,
            trim(patch.location, LOCATION_MAX),
            patch.description !== undefined,
            trim(patch.description, DESCRIPTION_MAX)
        ]
    );
    if (Array.isArray(patch.attendeeIds)) {
        const keep = new Set([row.created_by, ...patch.attendeeIds]);
        await db.query('DELETE FROM meeting_attendees WHERE meeting_id = $1 AND user_id <> ALL($2::int[])', [
            meetingId,
            [...keep]
        ]);
        for (const userId of keep) {
            await db.query(
                `INSERT INTO meeting_attendees (meeting_id, user_id, invited_by) VALUES ($1, $2, $3)
                 ON CONFLICT DO NOTHING`,
                [meetingId, userId, viewer.sub]
            );
        }
    }
    return { meeting: await getById(meetingId) };
}

async function cancelMeeting(meetingId, viewer) {
    const row = await findRow(meetingId);
    if (!row) {
        return { error: 'NOT_FOUND' };
    }
    if (!canManage(row, viewer)) {
        return { error: 'FORBIDDEN' };
    }
    await db.query('UPDATE meetings SET canceled_at = now() WHERE id = $1', [meetingId]);
    return { meeting: await getById(meetingId) };
}

async function confirmAttendance(meetingId, viewer, confirmed) {
    const row = await findRow(meetingId);
    if (!row) {
        return { error: 'NOT_FOUND' };
    }
    const result = await db.query(
        `UPDATE meeting_attendees
         SET confirmed_at = CASE WHEN $3::boolean THEN now() ELSE NULL END
         WHERE meeting_id = $1 AND user_id = $2
         RETURNING user_id`,
        [meetingId, viewer.sub, confirmed]
    );
    if (!result.rows[0]) {
        return { error: 'NOT_INVITED' };
    }
    return { meeting: await getById(meetingId) };
}

async function markAttendance(meetingId, viewer, attendedIds) {
    const row = await findRow(meetingId);
    if (!row) {
        return { error: 'NOT_FOUND' };
    }
    if (!canManage(row, viewer)) {
        return { error: 'FORBIDDEN' };
    }
    await db.query(
        `UPDATE meeting_attendees
         SET attended_at = CASE WHEN user_id = ANY($2::int[]) THEN COALESCE(attended_at, now()) ELSE NULL END
         WHERE meeting_id = $1`,
        [meetingId, attendedIds]
    );
    return { meeting: await getById(meetingId) };
}

async function saveMinutes(meetingId, viewer, minutes, actionsCount) {
    const row = await findRow(meetingId);
    if (!row) {
        return { error: 'NOT_FOUND' };
    }
    if (!canManage(row, viewer)) {
        const attendee = await db.query(
            'SELECT 1 FROM meeting_attendees WHERE meeting_id = $1 AND user_id = $2',
            [meetingId, viewer.sub]
        );
        if (viewer.role !== 'management' || !attendee.rows[0]) {
            return { error: 'FORBIDDEN' };
        }
    }
    if (new Date(row.ends_at).getTime() > Date.now()) {
        return { error: 'MEETING_NOT_ENDED' };
    }
    await db.query(
        `UPDATE meetings SET minutes = $1::jsonb, decisions_count = $2, actions_count = $3 WHERE id = $4`,
        [JSON.stringify(minutes), minutes.length, actionsCount ?? 0, meetingId]
    );
    return { meeting: await getById(meetingId) };
}

async function listUpcomingForAttendees(userIds, limit, now = new Date()) {
    const result = await db.query(
        `SELECT m.id, m.title, m.starts_at, m.ends_at, m.room, m.location,
                (SELECT count(*)::int FROM meeting_attendees a WHERE a.meeting_id = m.id) AS people
         FROM meetings m
         WHERE m.ends_at >= $1 AND m.canceled_at IS NULL
           AND EXISTS (
               SELECT 1 FROM meeting_attendees a
               WHERE a.meeting_id = m.id AND a.user_id = ANY($2::int[])
           )
         ORDER BY m.starts_at ASC
         LIMIT $3`,
        [now, userIds, limit]
    );
    return result.rows;
}

async function listActiveAttendeeIds(now = new Date()) {
    const result = await db.query(
        `SELECT DISTINCT a.user_id
         FROM meetings m
         JOIN meeting_attendees a ON a.meeting_id = m.id
         WHERE m.starts_at <= $1 AND m.ends_at >= $1 AND m.canceled_at IS NULL`,
        [now]
    );
    return result.rows.map((row) => row.user_id);
}

module.exports = {
    DEFAULT_ROOM,
    SCOPES,
    isValidScope,
    canManage,
    listForUser,
    listForViewer,
    getById,
    findRow,
    countUpcoming,
    countAwaitingConfirmation,
    createMeeting,
    updateMeeting,
    cancelMeeting,
    confirmAttendance,
    markAttendance,
    saveMinutes,
    listUpcomingForAttendees,
    listActiveAttendeeIds
};
