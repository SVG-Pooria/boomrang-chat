const db = require('../config/database');
const redis = require('../config/redis');

const EXEMPT_ROLES = ['management', 'super_admin'];
const SETTING_KEY = 'message_cooldown_seconds';

async function getCooldownSeconds() {
    const result = await db.query('SELECT value FROM system_settings WHERE key = $1', [SETTING_KEY]);
    const raw = result.rows[0] ? result.rows[0].value : '0';
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

async function setCooldownSeconds(seconds) {
    const normalized = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    await db.query(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [SETTING_KEY, String(normalized)]
    );
    return normalized;
}

async function checkAndApply(user) {
    if (EXEMPT_ROLES.includes(user.role)) {
        return { allowed: true };
    }
    const seconds = await getCooldownSeconds();
    if (seconds <= 0) {
        return { allowed: true };
    }
    const key = `cooldown:${user.sub}`;
    const client = redis.getClient();
    const existing = await client.get(key);
    if (existing) {
        const ttl = await client.pttl(key);
        return { allowed: false, retryAfterMs: ttl > 0 ? ttl : seconds * 1000 };
    }
    await client.set(key, '1', 'PX', seconds * 1000);
    return { allowed: true };
}

module.exports = { EXEMPT_ROLES, getCooldownSeconds, setCooldownSeconds, checkAndApply };
