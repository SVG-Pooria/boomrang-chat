const db = require('../config/database');

async function markOnline(userId) {
    await db.query(
        `INSERT INTO presence (user_id, status, last_seen_at) VALUES ($1, 'online', now())
         ON CONFLICT (user_id) DO UPDATE SET status = 'online', last_seen_at = now()`,
        [userId]
    );
}

async function markOffline(userId) {
    await db.query(
        `INSERT INTO presence (user_id, status, last_seen_at) VALUES ($1, 'offline', now())
         ON CONFLICT (user_id) DO UPDATE SET status = 'offline', last_seen_at = now()`,
        [userId]
    );
}

async function getStatus(userId) {
    const result = await db.query('SELECT status, last_seen_at FROM presence WHERE user_id = $1', [userId]);
    return result.rows[0] || { status: 'offline', last_seen_at: null };
}

async function listOnline() {
    const result = await db.query("SELECT user_id, last_seen_at FROM presence WHERE status = 'online'");
    return result.rows;
}

module.exports = { markOnline, markOffline, getStatus, listOnline };
