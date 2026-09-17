const crypto = require('crypto');
const db = require('../config/database');
const jwtUtil = require('../utils/jwt.util');
const format = require('../utils/persianFormat.util');
const redis = require('../config/redis');

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOUCH_INTERVAL_SECONDS = 60;
const USER_AGENT_LIMIT = 500;
const REAUTH_WINDOW_SECONDS = 300;

const BROWSERS = [
    [/Edg\//, 'Edge'],
    [/OPR\/|Opera/, 'Opera'],
    [/Firefox\//, 'Firefox'],
    [/Chrome\//, 'Chrome'],
    [/Safari\//, 'Safari']
];

const SYSTEMS = [
    [/iPhone/, 'iPhone'],
    [/iPad/, 'iPad'],
    [/Android/, 'Android'],
    [/Windows/, 'Windows'],
    [/Macintosh|Mac OS X/, 'macOS'],
    [/Ubuntu/, 'Ubuntu'],
    [/Linux/, 'Linux']
];

function notifier() {
    return require('../socket/notifier');
}

function firstMatch(patterns, userAgent) {
    const found = patterns.find(([pattern]) => pattern.test(userAgent));
    return found ? found[1] : null;
}

function deviceLabel(userAgent) {
    const agent = String(userAgent || '');
    const browser = firstMatch(BROWSERS, agent);
    const system = firstMatch(SYSTEMS, agent);
    if (!browser && !system) {
        return agent ? agent.slice(0, 60) : 'دستگاه نامشخص';
    }
    return [browser, system].filter(Boolean).join(' · ');
}

function normalizeIp(ip) {
    return ip ? String(ip).replace(/^::ffff:/, '') : null;
}

function isValidSessionId(value) {
    return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

async function issue(user, { userAgent, ip } = {}) {
    const sessionId = crypto.randomUUID();
    const token = jwtUtil.sign({ sub: user.id, role: user.role, phone: user.phone, sid: sessionId });
    const { exp } = jwtUtil.decode(token);
    await db.query(
        `INSERT INTO user_sessions (id, user_id, user_agent, ip_address, expires_at)
         VALUES ($1, $2, $3, $4, to_timestamp($5))`,
        [sessionId, user.id, userAgent ? String(userAgent).slice(0, USER_AGENT_LIMIT) : null, normalizeIp(ip), exp]
    );
    notifier().notifyAdmins('admin:sessions');
    return token;
}

async function authenticate(token) {
    let payload;
    try {
        payload = jwtUtil.verify(token);
    } catch (err) {
        return { error: 'INVALID_TOKEN' };
    }
    if (!isValidSessionId(payload.sid)) {
        return { error: 'INVALID_TOKEN' };
    }
    const result = await db.query(
        `SELECT u.id, u.full_name, u.phone, u.role, u.tag_id, u.is_active, u.is_lock_enabled, u.is_locked,
                u.password_must_change, s.id AS session_id, s.revoked_at
         FROM users u
         LEFT JOIN user_sessions s ON s.id = $2 AND s.user_id = u.id
         WHERE u.id = $1`,
        [payload.sub, payload.sid]
    );
    const row = result.rows[0];
    if (!row || !row.is_active) {
        return { error: 'ACCOUNT_DISABLED' };
    }
    if (!row.session_id || row.revoked_at) {
        return { error: 'SESSION_REVOKED' };
    }
    return { row, sessionId: payload.sid };
}

function touch(sessionId) {
    return db.query(
        `UPDATE user_sessions SET last_seen_at = now()
         WHERE id = $1 AND last_seen_at < now() - make_interval(secs => $2)`,
        [sessionId, TOUCH_INTERVAL_SECONDS]
    );
}

async function listActive() {
    const result = await db.query(
        `SELECT s.id, s.user_id, s.user_agent, s.ip_address, s.created_at, s.last_seen_at, u.full_name
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active = true AND u.is_bot = false
         ORDER BY s.last_seen_at DESC`
    );
    return result.rows;
}

function serialize(row, currentSessionId, now = new Date()) {
    return {
        id: row.id,
        userId: row.user_id,
        user: row.full_name,
        device: deviceLabel(row.user_agent),
        ip: row.ip_address || '—',
        since: format.relativeTime(new Date(row.created_at), now),
        current: row.id === currentSessionId
    };
}

async function revoke(sessionId, actorId) {
    const result = await db.query(
        `UPDATE user_sessions s SET revoked_at = now(), revoked_by = $2
         FROM users u
         WHERE s.id = $1 AND u.id = s.user_id AND s.revoked_at IS NULL AND s.expires_at > now()
         RETURNING s.id, s.user_id, s.user_agent, u.full_name`,
        [sessionId, actorId || null]
    );
    const row = result.rows[0] || null;
    if (row) {
        notifier().endSessionSockets(row.id);
        notifier().notifyAdmins('admin:sessions');
    }
    return row;
}

async function revokeForUser(userId, actorId) {
    const result = await db.query(
        `UPDATE user_sessions SET revoked_at = now(), revoked_by = $2
         WHERE user_id = $1 AND revoked_at IS NULL
         RETURNING id`,
        [userId, actorId || null]
    );
    notifier().endUserSockets(userId);
    notifier().notifyAdmins('admin:sessions');
    return result.rows.length;
}

async function revokeOtherSessions(userId, keepSessionId) {
    const result = await db.query(
        `UPDATE user_sessions SET revoked_at = now(), revoked_by = $1
         WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL
         RETURNING id`,
        [userId, keepSessionId]
    );
    result.rows.forEach((row) => notifier().endSessionSockets(row.id));
    if (result.rows.length) {
        notifier().notifyAdmins('admin:sessions');
    }
    return result.rows.length;
}

function reauthKey(sessionId) {
    return `reauth:${sessionId}`;
}

async function markReauthenticated(sessionId) {
    if (!isValidSessionId(sessionId)) {
        return;
    }
    await redis.getClient().set(reauthKey(sessionId), '1', 'EX', REAUTH_WINDOW_SECONDS);
}

async function isRecentlyReauthenticated(sessionId) {
    if (!isValidSessionId(sessionId)) {
        return false;
    }
    return (await redis.getClient().exists(reauthKey(sessionId))) === 1;
}

module.exports = {
    REAUTH_WINDOW_SECONDS,
    deviceLabel,
    isValidSessionId,
    issue,
    authenticate,
    touch,
    listActive,
    serialize,
    revoke,
    revokeForUser,
    revokeOtherSessions,
    markReauthenticated,
    isRecentlyReauthenticated
};
