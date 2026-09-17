const db = require('../config/database');
const attachmentClassifier = require('../utils/attachmentClassifier');

const SEARCH_RESULT_LIMIT = 100;
const ATTACHMENT_PAGE_SIZE = 30;

async function withSenderName(row) {
    if (!row) {
        return row;
    }
    const sender = await db.query('SELECT full_name FROM users WHERE id = $1', [row.sender_id]);
    const enriched = { ...row, sender_name: sender.rows[0] ? sender.rows[0].full_name : 'کاربر حذف‌شده' };
    if (row.forwarded_from_channel_id) {
        const channel = await db.query('SELECT title FROM channels WHERE id = $1', [row.forwarded_from_channel_id]);
        enriched.forwarded_from_channel_title = channel.rows[0] ? channel.rows[0].title : null;
    }
    const forwardOriginService = require('./forwardOrigin.service');
    return forwardOriginService.enrichForwardMeta(enriched);
}

async function createGroupMessage({ groupId, senderId, body, type, fileId, replyToId, forwardOrigin, isConfidential }) {
    const result = await db.query(
        `INSERT INTO group_messages
            (group_id, sender_id, body, type, file_id, reply_to_id, is_confidential,
             forward_origin_type, forward_origin_ref_id, forward_origin_message_id, forward_origin_sender_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
            groupId,
            senderId,
            body,
            type || 'text',
            fileId || null,
            replyToId || null,
            Boolean(isConfidential),
            forwardOrigin ? forwardOrigin.originType : null,
            forwardOrigin ? forwardOrigin.originRefId : null,
            forwardOrigin ? forwardOrigin.originMessageId : null,
            forwardOrigin ? forwardOrigin.originSenderId : null
        ]
    );
    return withSenderName(result.rows[0]);
}

async function createForwardedGroupMessage({ groupId, sourceChannelId, sourceMessage }) {
    const result = await db.query(
        `INSERT INTO group_messages
            (group_id, sender_id, body, type, file_id, is_confidential, forwarded_from_channel_id, forwarded_from_message_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
            groupId,
            sourceMessage.sender_id,
            sourceMessage.body,
            sourceMessage.type,
            sourceMessage.file_id,
            Boolean(sourceMessage.is_confidential),
            sourceChannelId,
            sourceMessage.id
        ]
    );
    return withSenderName(result.rows[0]);
}

async function getGroupMessageById(messageId) {
    const result = await db.query('SELECT * FROM group_messages WHERE id = $1', [messageId]);
    return result.rows[0] || null;
}

async function listGroupMessages(groupId, { before, limit } = {}) {
    const pageSize = Math.min(Number(limit) || 50, 100);
    const params = [groupId];
    let condition = '';
    if (before) {
        params.push(before);
        condition = 'AND gm.id < $2';
    }
    params.push(pageSize);
    const result = await db.query(
        `SELECT gm.*, COALESCE(u.full_name, 'کاربر حذف‌شده') AS sender_name,
                (SELECT count(*)::int FROM group_members mem
                  WHERE mem.group_id = gm.group_id
                    AND mem.user_id <> gm.sender_id
                    AND mem.last_read_message_id >= gm.id) AS seen_by_count,
                (SELECT count(*)::int FROM group_members mem
                  WHERE mem.group_id = gm.group_id
                    AND mem.user_id <> gm.sender_id) AS audience_count,
                f.id AS file_row_id, f.mode AS file_mode, f.mime_type AS file_mime_type,
                f.size_bytes AS file_size_bytes, f.av_scan_status AS file_av_scan_status,
                f.original_name AS file_original_name,
                c.title AS forwarded_from_channel_title,
                fg.title AS forward_origin_group_title,
                fc.title AS forward_origin_channel_title,
                COALESCE(fu.full_name, 'کاربر حذف‌شده') AS forward_origin_sender_name
         FROM group_messages gm
         LEFT JOIN message_files f ON f.id = gm.file_id
         LEFT JOIN users u ON u.id = gm.sender_id
         LEFT JOIN channels c ON c.id = gm.forwarded_from_channel_id
         LEFT JOIN groups fg ON fg.id = gm.forward_origin_ref_id AND gm.forward_origin_type = 'group'
         LEFT JOIN channels fc ON fc.id = gm.forward_origin_ref_id AND gm.forward_origin_type = 'channel'
         LEFT JOIN users fu ON fu.id = gm.forward_origin_sender_id
         WHERE gm.group_id = $1 AND gm.is_deleted = false ${condition}
         ORDER BY gm.id DESC
         LIMIT $${params.length}`,
        params
    );
    return result.rows.reverse();
}

async function getGroupAttachments(groupId, { category, cursor, limit } = {}) {
    if (!attachmentClassifier.isValidCategory(category)) {
        return [];
    }
    const pageSize = Math.min(Number(limit) || ATTACHMENT_PAGE_SIZE, 60);
    const params = [groupId];
    let condition = '';
    if (cursor) {
        params.push(cursor);
        condition = `AND gm.id < $${params.length}`;
    }

    const fileJoin = "LEFT JOIN message_files f ON f.id = gm.file_id AND f.av_scan_status <> 'infected'";
    const categoryCondition = attachmentClassifier.buildCategoryCondition(category, 'gm', 'f');

    params.push(pageSize);

    const result = await db.query(
        `SELECT gm.id, gm.body, gm.type, gm.sender_id, gm.created_at,
                COALESCE(u.full_name, 'کاربر حذف‌شده') AS sender_name,
                f.id AS file_row_id, f.mode AS file_mode, f.mime_type AS file_mime_type,
                f.size_bytes AS file_size_bytes, f.original_name AS file_original_name
         FROM group_messages gm
         ${fileJoin}
         LEFT JOIN users u ON u.id = gm.sender_id
         WHERE gm.group_id = $1 AND gm.is_deleted = false
           AND ${categoryCondition}
           ${condition}
         ORDER BY gm.id DESC
         LIMIT $${params.length}`,
        params
    );
    return result.rows;
}

async function searchGroupMessages(groupId, term) {
    const trimmed = String(term || '').trim();
    if (!trimmed) {
        return [];
    }
    const likeTerm = `%${trimmed.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    const result = await db.query(
        `SELECT * FROM (
             SELECT gm.id, gm.body, gm.type, gm.created_at,
                    COALESCE(u.full_name, 'کاربر حذف‌شده') AS sender_name,
                    f.original_name AS file_original_name, f.mime_type AS file_mime_type
             FROM group_messages gm
             LEFT JOIN users u ON u.id = gm.sender_id
             LEFT JOIN message_files f ON f.id = gm.file_id
             WHERE gm.group_id = $1
               AND gm.is_deleted = false
               AND (gm.body ILIKE $2 ESCAPE '\\' OR f.original_name ILIKE $2 ESCAPE '\\')
             ORDER BY gm.id DESC
             LIMIT $3
         ) recent
         ORDER BY recent.id ASC`,
        [groupId, likeTerm, SEARCH_RESULT_LIMIT]
    );
    return result.rows;
}

async function editGroupMessage(messageId, body) {
    const result = await db.query(
        `UPDATE group_messages SET body = $1, is_edited = true, edited_at = now()
         WHERE id = $2 RETURNING *`,
        [body, messageId]
    );
    return withSenderName(result.rows[0]);
}

async function deleteGroupMessage(messageId) {
    const result = await db.query(
        `UPDATE group_messages SET is_deleted = true WHERE id = $1 RETURNING *`,
        [messageId]
    );
    return result.rows[0] || null;
}

async function setGroupMessagePinned(messageId, pinned) {
    const result = await db.query(
        `UPDATE group_messages SET is_pinned = $1 WHERE id = $2 RETURNING *`,
        [Boolean(pinned), messageId]
    );
    return result.rows[0] || null;
}

async function markGroupRead(groupId, userId, messageId) {
    await db.query(
        `UPDATE group_members
         SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), $3)
         WHERE group_id = $1 AND user_id = $2`,
        [groupId, userId, messageId]
    );
}

async function getGroupSummaries(groupIds, userId) {
    const summaries = {};
    for (const id of groupIds) {
        summaries[id] = { lastMessage: null, unreadCount: 0 };
    }
    if (!groupIds.length) {
        return summaries;
    }

    const lastMessages = await db.query(
        `SELECT DISTINCT ON (gm.group_id) gm.group_id, gm.id, gm.sender_id, gm.body, gm.type, gm.created_at
         FROM group_messages gm
         WHERE gm.group_id = ANY($1::int[]) AND gm.is_deleted = false
         ORDER BY gm.group_id, gm.id DESC`,
        [groupIds]
    );
    for (const row of lastMessages.rows) {
        summaries[row.group_id].lastMessage = {
            id: row.id,
            senderId: row.sender_id,
            body: row.body,
            type: row.type,
            createdAt: row.created_at
        };
    }

    const unread = await db.query(
        `SELECT gm.group_id, COUNT(*)::int AS count
         FROM group_messages gm
         JOIN group_members mem ON mem.group_id = gm.group_id AND mem.user_id = $2
         WHERE gm.group_id = ANY($1::int[]) AND gm.is_deleted = false AND gm.sender_id != $2
           AND gm.id > COALESCE(mem.last_read_message_id, 0)
         GROUP BY gm.group_id`,
        [groupIds, userId]
    );
    for (const row of unread.rows) {
        summaries[row.group_id].unreadCount = row.count;
    }
    return summaries;
}

module.exports = {
    createGroupMessage,
    createForwardedGroupMessage,
    getGroupMessageById,
    listGroupMessages,
    getGroupAttachments,
    searchGroupMessages,
    editGroupMessage,
    deleteGroupMessage,
    setGroupMessagePinned,
    markGroupRead,
    getGroupSummaries
};
