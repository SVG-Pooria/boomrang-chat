const db = require('../config/database');

const SCOPES = ['all', 'direct', 'group', 'channel'];
const TARGET_TYPES = ['direct', 'group', 'channel'];

function isValidScope(value) {
    return SCOPES.includes(value);
}

function isValidTargetType(value) {
    return TARGET_TYPES.includes(value);
}

async function listForUser(userId) {
    const result = await db.query(
        'SELECT scope, target_type, target_id FROM chat_pins WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
    );
    return result.rows.map((row) => ({
        scope: row.scope,
        targetType: row.target_type,
        targetId: row.target_id
    }));
}

async function setPin(userId, scope, targetType, targetId, pinned) {
    if (!isValidScope(scope) || !isValidTargetType(targetType)) {
        return { error: 'INVALID_TARGET' };
    }
    if (pinned) {
        await db.query(
            `INSERT INTO chat_pins (user_id, scope, target_type, target_id) VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`,
            [userId, scope, targetType, targetId]
        );
    } else {
        await db.query(
            'DELETE FROM chat_pins WHERE user_id = $1 AND scope = $2 AND target_type = $3 AND target_id = $4',
            [userId, scope, targetType, targetId]
        );
    }
    return { pins: await listForUser(userId) };
}

module.exports = { SCOPES, TARGET_TYPES, isValidScope, isValidTargetType, listForUser, setPin };
