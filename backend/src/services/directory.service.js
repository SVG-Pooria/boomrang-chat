const db = require('../config/database');
const format = require('../utils/persianFormat.util');
const meetingService = require('./meeting.service');
const { HIDDEN_ROLE } = require('../config/visibility');

const WORKING_HOURS_START_KEY = 'working_hours_start';
const WORKING_HOURS_END_KEY = 'working_hours_end';
const DEFAULT_START = 8;
const DEFAULT_END = 18;
const ROLE_RANK = { management: 0, manager: 1, employee: 2 };

const hourFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: format.TIMEZONE,
    hour: '2-digit',
    hour12: false
});

async function workingHours() {
    const result = await db.query('SELECT key, value FROM system_settings WHERE key = ANY($1::text[])', [
        [WORKING_HOURS_START_KEY, WORKING_HOURS_END_KEY]
    ]);
    const map = Object.fromEntries(result.rows.map((row) => [row.key, Number(row.value)]));
    const start = Number.isFinite(map[WORKING_HOURS_START_KEY]) ? map[WORKING_HOURS_START_KEY] : DEFAULT_START;
    const end = Number.isFinite(map[WORKING_HOURS_END_KEY]) ? map[WORKING_HOURS_END_KEY] : DEFAULT_END;
    return { start, end };
}

function isWithinWorkingHours(now, hours) {
    const hour = Number(hourFormatter.format(now));
    return hour >= hours.start && hour < hours.end;
}

async function listOnLeaveUserIds(now = new Date()) {
    const result = await db.query(
        `SELECT DISTINCT user_id FROM leave_periods
         WHERE start_date <= $1::date AND end_date >= $1::date`,
        [format.dayKey(now)]
    );
    return result.rows.map((row) => row.user_id);
}

async function statusResolver(now = new Date()) {
    const [presenceResult, inMeeting, onLeave, hours] = await Promise.all([
        db.query("SELECT user_id FROM presence WHERE status = 'online'"),
        meetingService.listActiveAttendeeIds(now),
        listOnLeaveUserIds(now),
        workingHours()
    ]);

    const online = new Set(presenceResult.rows.map((row) => row.user_id));
    const meeting = new Set(inMeeting);
    const leave = new Set(onLeave);
    const withinHours = isWithinWorkingHours(now, hours);

    return (userId) => {
        if (leave.has(userId)) {
            return 'مرخصی';
        }
        if (meeting.has(userId)) {
            return 'در جلسه';
        }
        if (online.has(userId)) {
            return 'آنلاین';
        }
        return withinHours ? 'خارج از ساعت کاری' : 'خارج از ساعت کاری';
    };
}

function avatarUrlOf(row) {
    if (!row.avatar_path) {
        return null;
    }
    const version = row.avatar_updated_at ? new Date(row.avatar_updated_at).getTime() : 0;
    return `/api/avatars/user/${row.id}?v=${version}`;
}

async function listDirectory(now = new Date()) {
    const [usersResult, statusOf] = await Promise.all([
        db.query(
            `SELECT u.id, u.full_name, u.job_title, u.unit, u.phone_extension, u.manager_id, u.role,
                    u.avatar_path, u.avatar_updated_at, t.name AS tag_name,
                    m.full_name AS manager_name
             FROM users u
             LEFT JOIN users m ON m.id = u.manager_id
             LEFT JOIN tags t ON t.id = u.tag_id
             WHERE u.is_active = true AND u.is_bot = false AND u.role <> $1
             ORDER BY u.full_name`,
            [HIDDEN_ROLE]
        ),
        statusResolver(now)
    ]);

    const collator = new Intl.Collator('fa');
    const rows = [...usersResult.rows].sort(
        (a, b) =>
            (ROLE_RANK[a.role] ?? 3) - (ROLE_RANK[b.role] ?? 3) || collator.compare(a.full_name, b.full_name)
    );

    return rows.map((row) => {
        const person = {
            userId: row.id,
            managerId: row.manager_id,
            name: row.full_name,
            role: row.job_title || 'همکار',
            accountRole: row.role,
            tag: row.tag_name || null,
            avatarUrl: avatarUrlOf(row),
            unit: row.unit || 'سازمان',
            initials: format.initials(row.full_name),
            status: statusOf(row.id),
            phone: row.phone_extension ? `داخلی ${format.toPersianDigits(row.phone_extension)}` : 'ثبت‌نشده'
        };
        if (row.manager_name) {
            person.reportsTo = row.manager_name;
        }
        return person;
    });
}

async function setLeave(userId, actor, startDate, endDate) {
    if (actor.sub === userId) {
        return { error: 'CANNOT_SET_OWN_LEAVE' };
    }
    if (actor.role !== 'super_admin') {
        const target = await db.query('SELECT manager_id FROM users WHERE id = $1', [userId]);
        if (!target.rows[0] || target.rows[0].manager_id !== actor.sub) {
            return { error: 'FORBIDDEN' };
        }
    }
    const result = await db.query(
        `INSERT INTO leave_periods (user_id, start_date, end_date, set_by)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [userId, startDate, endDate, actor.sub]
    );
    return { leave: result.rows[0] };
}

module.exports = {
    listDirectory,
    listOnLeaveUserIds,
    statusResolver,
    setLeave,
    workingHours
};
