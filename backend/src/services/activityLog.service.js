const db = require('../config/database');

async function log(actorId, action, meta) {
    await db.query(
        'INSERT INTO activity_log (actor_id, action, meta) VALUES ($1, $2, $3)',
        [actorId, action, meta ? JSON.stringify(meta) : null]
    );
}

async function list(limit) {
    const result = await db.query(
        'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT $1',
        [limit || 100]
    );
    return result.rows;
}

module.exports = { log, list };
