const db = require('../config/database');

const MESSAGE_LIMIT = 150;
const CHAT_LIMIT = 20;

function escapeLikeTerm(term) {
    return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function buildLikeParam(term) {
    return `%${escapeLikeTerm(term)}%`;
}

async function searchMessages(userId, likeTerm) {
    const result = await db.query(
        `SELECT * FROM (
             SELECT 'conversation' AS target_type, c.id AS target_id,
                    CASE WHEN c.is_system_channel THEN c.title ELSE ou.full_name END AS target_name,
                    m.id AS message_id, m.body, m.type, m.created_at,
                    COALESCE(su.full_name, 'کاربر حذف‌شده') AS sender_name,
                    f.original_name AS file_name, f.mime_type AS file_mime_type
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id AND c.type = 'direct'
             JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
             LEFT JOIN users ou ON ou.id = CASE WHEN c.direct_user_a = $1 THEN c.direct_user_b ELSE c.direct_user_a END
             LEFT JOIN users su ON su.id = m.sender_id
             LEFT JOIN message_files f ON f.id = m.file_id
             LEFT JOIN message_hidden_for_user h ON h.message_id = m.id AND h.user_id = $1
             WHERE m.is_deleted = false AND h.message_id IS NULL
               AND (m.body ILIKE $2 ESCAPE '\\' OR f.original_name ILIKE $2 ESCAPE '\\')
             UNION ALL
             SELECT 'group', g.id, g.title,
                    gm.id, gm.body, gm.type, gm.created_at,
                    COALESCE(su.full_name, 'کاربر حذف‌شده'),
                    f.original_name, f.mime_type
             FROM group_messages gm
             JOIN groups g ON g.id = gm.group_id
             JOIN group_members mem ON mem.group_id = g.id AND mem.user_id = $1
             LEFT JOIN users su ON su.id = gm.sender_id
             LEFT JOIN message_files f ON f.id = gm.file_id
             WHERE gm.is_deleted = false
               AND (gm.body ILIKE $2 ESCAPE '\\' OR f.original_name ILIKE $2 ESCAPE '\\')
             UNION ALL
             SELECT 'channel', ch.id, ch.title,
                    cmsg.id, cmsg.body, cmsg.type, cmsg.created_at,
                    COALESCE(su.full_name, 'کاربر حذف‌شده'),
                    f.original_name, f.mime_type
             FROM channel_messages cmsg
             JOIN channels ch ON ch.id = cmsg.channel_id
             JOIN channel_members mem ON mem.channel_id = ch.id AND mem.user_id = $1
             LEFT JOIN users su ON su.id = cmsg.sender_id
             LEFT JOIN message_files f ON f.id = cmsg.file_id
             WHERE cmsg.is_deleted = false
               AND (cmsg.body ILIKE $2 ESCAPE '\\' OR f.original_name ILIKE $2 ESCAPE '\\')
         ) hits
         ORDER BY created_at DESC, message_id DESC
         LIMIT $3`,
        [userId, likeTerm, MESSAGE_LIMIT]
    );
    return result.rows.map((row) => ({
        targetType: row.target_type,
        targetId: row.target_id,
        targetName: row.target_name,
        messageId: row.message_id,
        snippet: row.body || null,
        type: row.type,
        fileName: row.file_name || null,
        fileMimeType: row.file_mime_type || null,
        senderName: row.sender_name,
        createdAt: row.created_at
    }));
}

async function searchChats(userId, likeTerm) {
    const result = await db.query(
        `SELECT * FROM (
             SELECT 'conversation' AS target_type, c.id AS target_id,
                    CASE WHEN c.is_system_channel THEN c.title ELSE ou.full_name END AS name
             FROM conversations c
             JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
             LEFT JOIN users ou ON ou.id = CASE WHEN c.direct_user_a = $1 THEN c.direct_user_b ELSE c.direct_user_a END
             WHERE c.type = 'direct'
             UNION ALL
             SELECT 'group', g.id, g.title
             FROM groups g
             JOIN group_members mem ON mem.group_id = g.id AND mem.user_id = $1
             UNION ALL
             SELECT 'channel', ch.id, ch.title
             FROM channels ch
             JOIN channel_members mem ON mem.channel_id = ch.id AND mem.user_id = $1
         ) chats
         WHERE name ILIKE $2 ESCAPE '\\'
         ORDER BY name
         LIMIT $3`,
        [userId, likeTerm, CHAT_LIMIT]
    );
    return result.rows.map((row) => ({
        targetType: row.target_type,
        targetId: row.target_id,
        name: row.name
    }));
}

async function searchAll(userId, term) {
    const trimmed = String(term || '').trim();
    if (!trimmed) {
        return { chats: [], messages: [] };
    }
    const likeTerm = buildLikeParam(trimmed);
    const [chats, messages] = await Promise.all([searchChats(userId, likeTerm), searchMessages(userId, likeTerm)]);
    return { chats, messages };
}

module.exports = { searchAll };
