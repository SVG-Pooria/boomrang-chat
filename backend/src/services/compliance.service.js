const db = require('../config/database');
const format = require('../utils/persianFormat.util');
const { HIDDEN_ROLE } = require('../config/visibility');

const RETENTION_KEY = 'archive_retention_years';
const DEFAULT_RETENTION_YEARS = 3;
const HOSTING_LABEL = 'میزبانی روی سرور سازمان';
const HOSTING_VALUE = '۱۰۰٪ داخلی';

const AUDITED_ACTIONS = {
    'approval.decided': { risk: 'متوسط' },
    'approval.created': { risk: 'کم' },
    'file.downloaded': { risk: 'کم' },
    'channel.member.added': { risk: 'متوسط' },
    'group.member.added': { risk: 'متوسط' },
    'user.login.blocked': { risk: 'بالا' },
    'user.password.viewed': { risk: 'بالا' },
    'announcement.published': { risk: 'کم' },
    'summary.published': { risk: 'کم' },
    'summary.unpinned': { risk: 'کم' },
    'leave.set': { risk: 'کم' }
};

async function retentionYears() {
    const result = await db.query('SELECT value FROM system_settings WHERE key = $1', [RETENTION_KEY]);
    const parsed = Number(result.rows[0] ? result.rows[0].value : NaN);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_YEARS;
}

async function stats() {
    const [spaces, lockEnabled, years] = await Promise.all([
        db.query(
            `SELECT
                (SELECT count(*)::int FROM channels WHERE is_active = true) AS channels,
                (SELECT count(*)::int FROM groups WHERE is_active = true) AS groups`
        ),
        db.query(
            `SELECT
                (SELECT count(*)::int FROM users WHERE is_active = true AND is_bot = false AND role <> $1) AS total,
                (SELECT count(*)::int FROM users WHERE is_active = true AND is_bot = false AND role <> $1 AND is_lock_enabled = true) AS enrolled`,
            [HIDDEN_ROLE]
        ),
        retentionYears()
    ]);

    const spaceCount = spaces.rows[0].channels + spaces.rows[0].groups;
    const { total, enrolled } = lockEnabled.rows[0];

    return [
        { label: HOSTING_LABEL, value: HOSTING_VALUE, tone: 'mint' },
        {
            label: 'رمزنگاری سرتاسری کانال‌ها',
            value: `${format.toPersianDigits(spaceCount)} کانال فعال`,
            tone: 'sky'
        },
        {
            label: 'نگهداشت آرشیو',
            value: `${format.toPersianDigits(await Promise.resolve(years))} سال`,
            tone: 'violet'
        },
        {
            label: 'ورود دومرحله‌ای',
            value: `${format.percent(enrolled, total)} کارکنان`,
            tone: 'lemon'
        }
    ];
}

async function auditLog(limit = 20) {
    const result = await db.query(
        `SELECT l.id, l.action, l.description, l.risk, l.created_at,
                COALESCE(u.full_name, 'سیستم') AS actor_name
         FROM activity_log l
         LEFT JOIN users u ON u.id = l.actor_id
         WHERE l.description IS NOT NULL AND l.audience = 'compliance'
         ORDER BY l.created_at DESC
         LIMIT $1`,
        [limit]
    );
    const now = new Date();
    return result.rows.map((row) => ({
        who: row.actor_name,
        what: row.description,
        when:
            format.daysBetween(new Date(row.created_at), now) === 0
                ? `${format.clock(new Date(row.created_at))} امروز`
                : `${format.relativeTime(new Date(row.created_at), now)} ${format.clock(new Date(row.created_at))}`,
        risk: row.risk
    }));
}

async function record(actorId, action, description, meta) {
    const known = AUDITED_ACTIONS[action];
    await db.query(
        `INSERT INTO activity_log (actor_id, action, description, risk, meta)
         VALUES ($1, $2, $3, $4, $5)`,
        [actorId, action, description, known ? known.risk : 'کم', meta ? JSON.stringify(meta) : null]
    );
}

const TEAM_ACTIVITY_TONES = {
    approval: 'violet',
    task: 'mint',
    access: 'lemon',
    file: 'sky',
    report: 'rose'
};

async function recordTeamActivity(actorId, action, description, meta) {
    await db.query(
        `INSERT INTO activity_log (actor_id, action, description, meta, audience)
         VALUES ($1, $2, $3, $4, 'team')`,
        [actorId, action, description, meta ? JSON.stringify(meta) : null]
    );
}

async function teamTimeline(actorIds, limit = 5) {
    const result = await db.query(
        `SELECT l.action, l.description, l.created_at, u.full_name
         FROM activity_log l
         JOIN users u ON u.id = l.actor_id
         WHERE l.audience = 'team' AND l.actor_id = ANY($1::int[])
         ORDER BY l.created_at DESC
         LIMIT $2`,
        [actorIds, limit]
    );
    const now = new Date();
    return result.rows.map((row) => {
        const createdAt = new Date(row.created_at);
        return {
            who: row.full_name,
            what: row.description,
            when:
                format.daysBetween(createdAt, now) === 0
                    ? format.clock(createdAt)
                    : format.dayClock(createdAt, now),
            tone: TEAM_ACTIVITY_TONES[row.action.split('.')[0]] || 'sky'
        };
    });
}

async function teamActionsPerDay(actorIds, from) {
    const result = await db.query(
        `SELECT to_char(l.created_at AT TIME ZONE $3, 'YYYY-MM-DD') AS day, count(*)::int AS count
         FROM activity_log l
         WHERE l.audience = 'team' AND l.actor_id = ANY($1::int[]) AND l.created_at >= $2
         GROUP BY 1`,
        [actorIds, from, format.TIMEZONE]
    );
    return Object.fromEntries(result.rows.map((row) => [row.day, row.count]));
}

module.exports = {
    AUDITED_ACTIONS,
    stats,
    auditLog,
    record,
    recordTeamActivity,
    teamTimeline,
    teamActionsPerDay,
    retentionYears
};
