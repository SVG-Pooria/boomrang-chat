const db = require('../config/database');
const messageService = require('./message.service');

async function listPresence() {
    const result = await db.query(
        `SELECT u.id, u.full_name, u.phone, u.role, u.tag_id,
                COALESCE(p.status, 'offline') AS status, p.last_seen_at
         FROM users u
         LEFT JOIN presence p ON p.user_id = u.id
         ORDER BY status DESC, u.full_name`
    );
    return result.rows;
}

async function listAllConversations({ search, type } = {}) {
    const params = [];
    let condition = '1=1';
    if (type) {
        params.push(type);
        condition += ` AND c.type = $${params.length}`;
    }
    if (search) {
        params.push(`%${search}%`);
        condition += ` AND (c.title ILIKE $${params.length} OR ua.full_name ILIKE $${params.length} OR ub.full_name ILIKE $${params.length})`;
    }
    const result = await db.query(
        `SELECT c.*, ua.full_name AS user_a_name, ub.full_name AS user_b_name,
                (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id AND m.is_deleted = false) AS message_count
         FROM conversations c
         LEFT JOIN users ua ON ua.id = c.direct_user_a
         LEFT JOIN users ub ON ub.id = c.direct_user_b
         WHERE ${condition}
         ORDER BY c.created_at DESC`,
        params
    );
    return result.rows;
}

async function getConversationMessages(conversationId, options) {
    return messageService.listMessages(conversationId, options);
}

async function listFiles({ senderId, receiverId, dateFrom, dateTo, mimeType, mode } = {}) {
    const params = [];
    let condition = '1=1';
    if (senderId) {
        params.push(senderId);
        condition += ` AND m.sender_id = $${params.length}`;
    }
    if (receiverId) {
        params.push(receiverId);
        condition += ` AND (c.direct_user_a = $${params.length} OR c.direct_user_b = $${params.length}
            OR EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = c.id AND cm.user_id = $${params.length}))`;
    }
    if (dateFrom) {
        params.push(dateFrom);
        condition += ` AND f.created_at >= $${params.length}`;
    }
    if (dateTo) {
        params.push(dateTo);
        condition += ` AND f.created_at <= $${params.length}`;
    }
    if (mimeType) {
        params.push(`${mimeType}%`);
        condition += ` AND f.mime_type LIKE $${params.length}`;
    }
    if (mode) {
        params.push(mode);
        condition += ` AND f.mode = $${params.length}`;
    }
    const result = await db.query(
        `SELECT f.*, m.conversation_id, m.sender_id, COALESCE(f.original_name, m.body) AS filename,
                u.full_name AS sender_name, u.phone AS sender_phone,
                c.type AS conversation_type, c.title AS conversation_title,
                ua.full_name AS conversation_user_a_name, ub.full_name AS conversation_user_b_name
         FROM message_files f
         JOIN messages m ON m.id = f.message_id
         JOIN conversations c ON c.id = m.conversation_id
         JOIN users u ON u.id = m.sender_id
         LEFT JOIN users ua ON ua.id = c.direct_user_a
         LEFT JOIN users ub ON ub.id = c.direct_user_b
         WHERE ${condition}
         ORDER BY f.created_at DESC
         LIMIT 200`,
        params
    );
    return result.rows.map((row) => ({ ...row, conversation_label: buildConversationLabel(row) }));
}

function buildConversationLabel(row) {
    if (row.conversation_type === 'direct') {
        const a = row.conversation_user_a_name || 'کاربر حذف‌شده';
        const b = row.conversation_user_b_name || 'کاربر حذف‌شده';
        return `گفتگوی خصوصی: ${a} و ${b}`;
    }
    const kind = row.conversation_type === 'channel' ? 'کانال' : 'گروه';
    return `${kind}: ${row.conversation_title || 'بدون عنوان'}`;
}

module.exports = { listPresence, listAllConversations, getConversationMessages, listFiles };
