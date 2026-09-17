const db = require('../config/database');
const channelGroupLinkService = require('./channelGroupLink.service');
const forwardQueue = require('../queue/forwardQueue');
const attachmentClassifier = require('../utils/attachmentClassifier');

const SEARCH_RESULT_LIMIT = 100;
const ATTACHMENT_PAGE_SIZE = 30;

async function withSenderName(row) {
    if (!row) {
        return row;
    }
    const sender = await db.query('SELECT full_name FROM users WHERE id = $1', [row.sender_id]);
    const enriched = { ...row, sender_name: sender.rows[0] ? sender.rows[0].full_name : 'کاربر حذف‌شده' };
    const forwardOriginService = require('./forwardOrigin.service');
    return forwardOriginService.enrichForwardMeta(enriched);
}

async function scheduleAutoForwardIfLinked(channelId, channelMessageId) {
    try {
        const link = await channelGroupLinkService.getActiveLinkByChannel(channelId);
        if (!link) {
            return;
        }
        await forwardQueue.enqueueForward({
            channelId,
            channelMessageId,
            groupId: link.group_id
        });
    } catch (err) {

        console.error('[channelMessage.service] failed to enqueue auto-forward:', err.message);
    }
}

async function createChannelMessage({ channelId, senderId, body, type, fileId, forwardOrigin, isConfidential }) {
    const result = await db.query(
        `INSERT INTO channel_messages
            (channel_id, sender_id, body, type, file_id, is_confidential,
             forward_origin_type, forward_origin_ref_id, forward_origin_message_id, forward_origin_sender_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
            channelId,
            senderId,
            body,
            type || 'text',
            fileId || null,
            Boolean(isConfidential),
            forwardOrigin ? forwardOrigin.originType : null,
            forwardOrigin ? forwardOrigin.originRefId : null,
            forwardOrigin ? forwardOrigin.originMessageId : null,
            forwardOrigin ? forwardOrigin.originSenderId : null
        ]
    );
    const message = result.rows[0];
    await scheduleAutoForwardIfLinked(channelId, message.id);
    return withSenderName(message);
}

async function getChannelMessageById(messageId) {
    const result = await db.query('SELECT * FROM channel_messages WHERE id = $1', [messageId]);
    return result.rows[0] || null;
}

async function listChannelMessages(channelId, { before, limit } = {}) {
    const pageSize = Math.min(Number(limit) || 50, 100);
    const params = [channelId];
    let condition = '';
    if (before) {
        params.push(before);
        condition = 'AND cm.id < $2';
    }
    params.push(pageSize);
    const result = await db.query(
        `SELECT cm.*, COALESCE(u.full_name, 'کاربر حذف‌شده') AS sender_name,
                (SELECT count(*)::int FROM channel_members mem
                  WHERE mem.channel_id = cm.channel_id
                    AND mem.user_id <> cm.sender_id
                    AND mem.last_read_message_id >= cm.id) AS seen_by_count,
                (SELECT count(*)::int FROM channel_members mem
                  WHERE mem.channel_id = cm.channel_id
                    AND mem.user_id <> cm.sender_id) AS audience_count,
                f.id AS file_row_id, f.mode AS file_mode, f.mime_type AS file_mime_type,
                f.size_bytes AS file_size_bytes, f.av_scan_status AS file_av_scan_status,
                f.original_name AS file_original_name,
                fg.title AS forward_origin_group_title,
                fc.title AS forward_origin_channel_title,
                COALESCE(fu.full_name, 'کاربر حذف‌شده') AS forward_origin_sender_name
         FROM channel_messages cm
         LEFT JOIN message_files f ON f.id = cm.file_id
         LEFT JOIN users u ON u.id = cm.sender_id
         LEFT JOIN groups fg ON fg.id = cm.forward_origin_ref_id AND cm.forward_origin_type = 'group'
         LEFT JOIN channels fc ON fc.id = cm.forward_origin_ref_id AND cm.forward_origin_type = 'channel'
         LEFT JOIN users fu ON fu.id = cm.forward_origin_sender_id
         WHERE cm.channel_id = $1 AND cm.is_deleted = false ${condition}
         ORDER BY cm.id DESC
         LIMIT $${params.length}`,
        params
    );
    return result.rows.reverse();
}

async function getChannelAttachments(channelId, { category, cursor, limit } = {}) {
    if (!attachmentClassifier.isValidCategory(category)) {
        return [];
    }
    const pageSize = Math.min(Number(limit) || ATTACHMENT_PAGE_SIZE, 60);
    const params = [channelId];
    let condition = '';
    if (cursor) {
        params.push(cursor);
        condition = `AND cm.id < $${params.length}`;
    }

    const fileJoin = "LEFT JOIN message_files f ON f.id = cm.file_id AND f.av_scan_status <> 'infected'";
    const categoryCondition = attachmentClassifier.buildCategoryCondition(category, 'cm', 'f');

    params.push(pageSize);

    const result = await db.query(
        `SELECT cm.id, cm.body, cm.type, cm.sender_id, cm.created_at,
                COALESCE(u.full_name, 'کاربر حذف‌شده') AS sender_name,
                f.id AS file_row_id, f.mode AS file_mode, f.mime_type AS file_mime_type,
                f.size_bytes AS file_size_bytes, f.original_name AS file_original_name
         FROM channel_messages cm
         ${fileJoin}
         LEFT JOIN users u ON u.id = cm.sender_id
         WHERE cm.channel_id = $1 AND cm.is_deleted = false
           AND ${categoryCondition}
           ${condition}
         ORDER BY cm.id DESC
         LIMIT $${params.length}`,
        params
    );
    return result.rows;
}

async function searchChannelMessages(channelId, term) {
    const trimmed = String(term || '').trim();
    if (!trimmed) {
        return [];
    }
    const likeTerm = `%${trimmed.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    const result = await db.query(
        `SELECT * FROM (
             SELECT cm.id, cm.body, cm.type, cm.created_at,
                    COALESCE(u.full_name, 'کاربر حذف‌شده') AS sender_name,
                    f.original_name AS file_original_name, f.mime_type AS file_mime_type
             FROM channel_messages cm
             LEFT JOIN users u ON u.id = cm.sender_id
             LEFT JOIN message_files f ON f.id = cm.file_id
             WHERE cm.channel_id = $1
               AND cm.is_deleted = false
               AND (cm.body ILIKE $2 ESCAPE '\\' OR f.original_name ILIKE $2 ESCAPE '\\')
             ORDER BY cm.id DESC
             LIMIT $3
         ) recent
         ORDER BY recent.id ASC`,
        [channelId, likeTerm, SEARCH_RESULT_LIMIT]
    );
    return result.rows;
}

async function editChannelMessage(messageId, body) {
    const result = await db.query(
        `UPDATE channel_messages SET body = $1, is_edited = true, edited_at = now()
         WHERE id = $2 RETURNING *`,
        [body, messageId]
    );
    return withSenderName(result.rows[0]);
}

async function deleteChannelMessage(messageId) {
    const result = await db.query(
        `UPDATE channel_messages SET is_deleted = true WHERE id = $1 RETURNING *`,
        [messageId]
    );
    return result.rows[0] || null;
}

async function setChannelMessagePinned(messageId, pinned) {
    const result = await db.query(
        `UPDATE channel_messages SET is_pinned = $1 WHERE id = $2 RETURNING *`,
        [Boolean(pinned), messageId]
    );
    return result.rows[0] || null;
}

async function markChannelRead(channelId, userId, messageId) {
    await db.query(
        `UPDATE channel_members
         SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), $3)
         WHERE channel_id = $1 AND user_id = $2`,
        [channelId, userId, messageId]
    );
}

async function getChannelSummaries(channelIds, userId) {
    const summaries = {};
    for (const id of channelIds) {
        summaries[id] = { lastMessage: null, unreadCount: 0 };
    }
    if (!channelIds.length) {
        return summaries;
    }

    const lastMessages = await db.query(
        `SELECT DISTINCT ON (cm.channel_id) cm.channel_id, cm.id, cm.sender_id, cm.body, cm.type, cm.created_at
         FROM channel_messages cm
         WHERE cm.channel_id = ANY($1::int[]) AND cm.is_deleted = false
         ORDER BY cm.channel_id, cm.id DESC`,
        [channelIds]
    );
    for (const row of lastMessages.rows) {
        summaries[row.channel_id].lastMessage = {
            id: row.id,
            senderId: row.sender_id,
            body: row.body,
            type: row.type,
            createdAt: row.created_at
        };
    }

    const unread = await db.query(
        `SELECT cm.channel_id, COUNT(*)::int AS count
         FROM channel_messages cm
         JOIN channel_members mem ON mem.channel_id = cm.channel_id AND mem.user_id = $2
         WHERE cm.channel_id = ANY($1::int[]) AND cm.is_deleted = false AND cm.sender_id != $2
           AND cm.id > COALESCE(mem.last_read_message_id, 0)
         GROUP BY cm.channel_id`,
        [channelIds, userId]
    );
    for (const row of unread.rows) {
        summaries[row.channel_id].unreadCount = row.count;
    }
    return summaries;
}

module.exports = {
    createChannelMessage,
    getChannelMessageById,
    listChannelMessages,
    getChannelAttachments,
    searchChannelMessages,
    editChannelMessage,
    deleteChannelMessage,
    setChannelMessagePinned,
    markChannelRead,
    getChannelSummaries
};
