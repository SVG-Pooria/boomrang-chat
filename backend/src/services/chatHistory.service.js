const db = require('../config/database');

const TARGETS = {
    conversation: { table: 'messages', column: 'conversation_id', hidden: true },
    group: { table: 'group_messages', column: 'group_id', hidden: false },
    channel: { table: 'channel_messages', column: 'channel_id', hidden: false }
};

const WINDOW_AFTER = 25;
const WINDOW_SIZE = 60;
const PINNED_LIMIT = 20;

async function windowAround(targetType, targetId, messageId) {
    const spec = TARGETS[targetType];
    const anchor = await db.query(
        `SELECT id FROM ${spec.table} WHERE id = $1 AND ${spec.column} = $2 AND is_deleted = false`,
        [messageId, targetId]
    );
    if (!anchor.rows[0]) {
        return null;
    }
    const after = await db.query(
        `SELECT max(id) AS last_id FROM (
             SELECT id FROM ${spec.table}
             WHERE ${spec.column} = $1 AND is_deleted = false AND id > $2
             ORDER BY id ASC
             LIMIT $3
         ) following`,
        [targetId, messageId, WINDOW_AFTER]
    );
    const lastId = after.rows[0].last_id || messageId;
    return { before: Number(lastId) + 1, limit: WINDOW_SIZE };
}

async function pinned(targetType, targetId, viewerUserId) {
    const spec = TARGETS[targetType];
    const params = [targetId, PINNED_LIMIT];
    let hiddenJoin = '';
    let hiddenCondition = '';
    if (spec.hidden && viewerUserId) {
        params.push(viewerUserId);
        hiddenJoin = `LEFT JOIN message_hidden_for_user h ON h.message_id = m.id AND h.user_id = $${params.length}`;
        hiddenCondition = 'AND h.message_id IS NULL';
    }
    const result = await db.query(
        `SELECT m.id, m.body, m.type, m.created_at, m.sender_id,
                COALESCE(u.full_name, 'کاربر حذف‌شده') AS sender_name,
                f.id AS file_id, f.original_name AS file_name, f.mime_type AS file_mime_type, f.mode AS file_mode,
                p.id AS poll_id, p.question AS poll_question
         FROM ${spec.table} m
         LEFT JOIN users u ON u.id = m.sender_id
         LEFT JOIN message_files f ON f.id = m.file_id
         LEFT JOIN polls p ON p.target_type = '${targetType}' AND p.target_id = m.${spec.column} AND p.message_id = m.id
         ${hiddenJoin}
         WHERE m.${spec.column} = $1 AND m.is_deleted = false AND m.is_pinned = true ${hiddenCondition}
         ORDER BY m.id DESC
         LIMIT $2`,
        params
    );
    return result.rows.map((row) => ({
        messageId: row.id,
        kind: row.poll_id ? 'poll' : row.file_id ? 'file' : 'text',
        text: row.poll_question || row.body || null,
        fileName: row.file_name || null,
        fileMimeType: row.file_mime_type || null,
        fileMode: row.file_mode || null,
        senderName: row.sender_name,
        createdAt: row.created_at
    }));
}

module.exports = { TARGETS, WINDOW_SIZE, windowAround, pinned };
