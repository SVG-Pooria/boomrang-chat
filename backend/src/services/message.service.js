const db = require('../config/database');
const backupMirror = require('../config/backupMirror');
const fileUploadService = require('./fileUpload.service');
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

async function createMessage({ conversationId, senderId, body, type, replyToId, forwardOrigin, isConfidential }) {
    const result = await db.query(
        `INSERT INTO messages
            (conversation_id, sender_id, body, type, reply_to_id, is_confidential,
             forward_origin_type, forward_origin_ref_id, forward_origin_message_id, forward_origin_sender_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
            conversationId,
            senderId,
            body,
            type || 'text',
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

async function attachFile(messageId, fileId) {
    const result = await db.query(
        'UPDATE messages SET file_id = $1 WHERE id = $2 RETURNING *',
        [fileId, messageId]
    );
    return withSenderName(result.rows[0]);
}

async function getMessageById(messageId) {
    const result = await db.query('SELECT * FROM messages WHERE id = $1', [messageId]);
    return result.rows[0] || null;
}

const REFERRAL_COLUMNS = `ref.id AS referral_row_id, ref.status AS referral_status,
                ref.note AS referral_note, ref.result_note AS referral_result_note,
                ref.assignee_id AS referral_assignee_id,
                ar.id AS referral_request_id, ar.title AS referral_request_title,
                ar.type AS referral_request_type`;

const REFERRAL_JOINS = `LEFT JOIN approval_referrals ref ON ref.id = m.referral_id
         LEFT JOIN approval_requests ar ON ar.id = ref.request_id`;

async function listMessages(conversationId, { before, limit } = {}, viewerUserId) {
    const pageSize = Math.min(Number(limit) || 50, 100);
    const params = [conversationId];
    let condition = '';
    if (before) {
        params.push(before);
        condition = 'AND m.id < $2';
    }

    let hiddenJoin = '';
    let hiddenCondition = '';
    if (viewerUserId) {
        params.push(viewerUserId);
        hiddenJoin = `LEFT JOIN message_hidden_for_user h ON h.message_id = m.id AND h.user_id = $${params.length}`;
        hiddenCondition = 'AND h.message_id IS NULL';
    }
    params.push(pageSize);
    const result = await db.query(
        `SELECT m.*, COALESCE(u.full_name, 'کاربر حذف‌شده') AS sender_name,
                (SELECT count(*)::int FROM message_reads r
                  WHERE r.conversation_id = m.conversation_id
                    AND r.user_id <> m.sender_id
                    AND r.last_read_message_id >= m.id) AS seen_by_count,
                (SELECT count(*)::int FROM conversation_members cmem
                  WHERE cmem.conversation_id = m.conversation_id
                    AND cmem.user_id <> m.sender_id) AS audience_count,
                f.id AS file_row_id, f.mode AS file_mode, f.mime_type AS file_mime_type,
                f.size_bytes AS file_size_bytes, f.av_scan_status AS file_av_scan_status,
                f.original_name AS file_original_name,
                fg.title AS forward_origin_group_title,
                fc.title AS forward_origin_channel_title,
                COALESCE(fu.full_name, 'کاربر حذف‌شده') AS forward_origin_sender_name,
                ${REFERRAL_COLUMNS}
         FROM messages m
         LEFT JOIN message_files f ON f.id = m.file_id
         LEFT JOIN users u ON u.id = m.sender_id
         LEFT JOIN groups fg ON fg.id = m.forward_origin_ref_id AND m.forward_origin_type = 'group'
         LEFT JOIN channels fc ON fc.id = m.forward_origin_ref_id AND m.forward_origin_type = 'channel'
         LEFT JOIN users fu ON fu.id = m.forward_origin_sender_id
         ${REFERRAL_JOINS}
         ${hiddenJoin}
         WHERE m.conversation_id = $1 AND m.is_deleted = false ${condition} ${hiddenCondition}
         ORDER BY m.id DESC
         LIMIT $${params.length}`,
        params
    );
    return result.rows.reverse();

}

async function findDeliverableMessage(messageId) {
    const result = await db.query(
        `SELECT m.*, COALESCE(u.full_name, 'کاربر حذف‌شده') AS sender_name,
                f.id AS file_row_id, f.mode AS file_mode, f.mime_type AS file_mime_type,
                f.size_bytes AS file_size_bytes, f.av_scan_status AS file_av_scan_status,
                f.original_name AS file_original_name,
                ${REFERRAL_COLUMNS}
         FROM messages m
         LEFT JOIN message_files f ON f.id = m.file_id
         LEFT JOIN users u ON u.id = m.sender_id
         ${REFERRAL_JOINS}
         WHERE m.id = $1`,
        [messageId]
    );
    return result.rows[0] || null;
}

async function getAttachments(conversationId, { category, cursor, limit } = {}, viewerUserId) {
    if (!attachmentClassifier.isValidCategory(category)) {
        return [];
    }
    const pageSize = Math.min(Number(limit) || ATTACHMENT_PAGE_SIZE, 60);
    const params = [conversationId];
    let condition = '';
    if (cursor) {
        params.push(cursor);
        condition = `AND m.id < $${params.length}`;
    }

    let hiddenJoin = '';
    let hiddenCondition = '';
    if (viewerUserId) {
        params.push(viewerUserId);
        hiddenJoin = `LEFT JOIN message_hidden_for_user h ON h.message_id = m.id AND h.user_id = $${params.length}`;
        hiddenCondition = 'AND h.message_id IS NULL';
    }

    const fileJoin = "LEFT JOIN message_files f ON f.id = m.file_id AND f.av_scan_status <> 'infected'";
    const categoryCondition = attachmentClassifier.buildCategoryCondition(category, 'm', 'f');

    params.push(pageSize);

    const result = await db.query(
        `SELECT m.id, m.body, m.type, m.sender_id, m.created_at,
                COALESCE(u.full_name, 'کاربر حذف‌شده') AS sender_name,
                f.id AS file_row_id, f.mode AS file_mode, f.mime_type AS file_mime_type,
                f.size_bytes AS file_size_bytes, f.original_name AS file_original_name
         FROM messages m
         ${fileJoin}
         LEFT JOIN users u ON u.id = m.sender_id
         ${hiddenJoin}
         WHERE m.conversation_id = $1 AND m.is_deleted = false
           AND ${categoryCondition}
           ${condition} ${hiddenCondition}
         ORDER BY m.id DESC
         LIMIT $${params.length}`,
        params
    );
    return result.rows;
}

async function searchMessages(conversationId, term, viewerUserId) {
    const trimmed = String(term || '').trim();
    if (!trimmed) {
        return [];
    }
    const likeTerm = `%${trimmed.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    const params = [conversationId, likeTerm];

    let hiddenJoin = '';
    let hiddenCondition = '';
    if (viewerUserId) {
        params.push(viewerUserId);
        hiddenJoin = `LEFT JOIN message_hidden_for_user h ON h.message_id = m.id AND h.user_id = $${params.length}`;
        hiddenCondition = 'AND h.message_id IS NULL';
    }
    params.push(SEARCH_RESULT_LIMIT);

    const result = await db.query(
        `SELECT * FROM (
             SELECT m.id, m.body, m.type, m.created_at,
                    COALESCE(u.full_name, 'کاربر حذف‌شده') AS sender_name,
                    f.original_name AS file_original_name, f.mime_type AS file_mime_type
             FROM messages m
             LEFT JOIN users u ON u.id = m.sender_id
             LEFT JOIN message_files f ON f.id = m.file_id
             ${hiddenJoin}
             WHERE m.conversation_id = $1
               AND m.is_deleted = false
               AND (m.body ILIKE $2 ESCAPE '\\' OR f.original_name ILIKE $2 ESCAPE '\\')
               ${hiddenCondition}
             ORDER BY m.id DESC
             LIMIT $${params.length}
         ) recent
         ORDER BY recent.id ASC`,
        params
    );
    return result.rows;
}

async function editMessage(messageId, userId, newBody, conversationId) {
    const result = await db.query(
        `UPDATE messages
         SET body = $1, is_edited = true, edited_at = now()
         WHERE id = $2 AND sender_id = $3 AND conversation_id = $4 AND is_deleted = false AND file_id IS NULL
         RETURNING *`,
        [newBody, messageId, userId, conversationId]
    );
    if (!result.rows[0]) {

        return null;
    }
    return withSenderName(result.rows[0]);
}

async function hideMessageForUser(messageId, userId) {
    await db.query(
        `INSERT INTO message_hidden_for_user (message_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [messageId, userId]
    );
}

async function deleteMessageForEveryone(messageId, userId, conversationId) {
    const client = await db.pool.connect();
    let messageRow;
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `SELECT m.*, f.original_path, f.compressed_path, f.thumbnail_path
             FROM messages m
             LEFT JOIN message_files f ON f.id = m.file_id
             WHERE m.id = $1
             FOR UPDATE OF m`,
            [messageId]
        );
        messageRow = result.rows[0];
        if (!messageRow || messageRow.conversation_id !== Number(conversationId)) {
            await client.query('ROLLBACK');
            return { error: 'NOT_FOUND' };
        }
        if (messageRow.sender_id !== userId) {
            await client.query('ROLLBACK');
            return { error: 'FORBIDDEN' };
        }
        await client.query('UPDATE messages SET reply_to_id = NULL WHERE reply_to_id = $1', [messageId]);
        await client.query('UPDATE message_reads SET last_read_message_id = NULL WHERE last_read_message_id = $1', [messageId]);
        await client.query('DELETE FROM messages WHERE id = $1', [messageId]);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    const variantPaths = [messageRow.original_path, messageRow.compressed_path, messageRow.thumbnail_path].filter(Boolean);
    let backupCopyRemoved = false;
    for (const variantPath of variantPaths) {
        await fileUploadService.removeLocalFile(variantPath);
        const removed = await backupMirror.removeMirroredCopy(variantPath);
        backupCopyRemoved = backupCopyRemoved || removed;
    }

    return {
        success: true,
        conversationId: messageRow.conversation_id,
        senderId: messageRow.sender_id,
        hadFile: variantPaths.length > 0,
        backupCopyRemoved,
        backupMirrorConfigured: backupMirror.isConfigured()
    };
}

async function setPinned(conversationId, messageId, isPinned) {
    const result = await db.query(
        `UPDATE messages SET is_pinned = $1
         WHERE id = $2 AND conversation_id = $3 AND is_deleted = false
         RETURNING *`,
        [isPinned, messageId, conversationId]
    );
    if (!result.rows[0]) {
        return null;
    }
    return withSenderName(result.rows[0]);
}

async function markRead(conversationId, userId, messageId) {
    await db.query(
        `INSERT INTO message_reads (conversation_id, user_id, last_read_message_id, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (conversation_id, user_id)
         DO UPDATE SET last_read_message_id = GREATEST(message_reads.last_read_message_id, $3), updated_at = now()`,
        [conversationId, userId, messageId]
    );
}

async function getConversationSummaries(conversationIds, userId) {
    const summaries = {};
    for (const id of conversationIds) {
        summaries[id] = { lastMessage: null, unreadCount: 0 };
    }
    if (!conversationIds.length) {
        return summaries;
    }

    const lastMessages = await db.query(
        `SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.id, m.sender_id, m.body, m.type, m.created_at
         FROM messages m
         LEFT JOIN message_hidden_for_user h ON h.message_id = m.id AND h.user_id = $2
         WHERE m.conversation_id = ANY($1::int[]) AND m.is_deleted = false AND h.message_id IS NULL
         ORDER BY m.conversation_id, m.id DESC`,
        [conversationIds, userId]
    );
    for (const row of lastMessages.rows) {
        summaries[row.conversation_id].lastMessage = {
            id: row.id,
            senderId: row.sender_id,
            body: row.body,
            type: row.type,
            createdAt: row.created_at
        };
    }
    const unread = await db.query(
        `SELECT m.conversation_id, COUNT(*)::int AS count
         FROM messages m
         LEFT JOIN message_reads r ON r.conversation_id = m.conversation_id AND r.user_id = $2
         LEFT JOIN message_hidden_for_user h ON h.message_id = m.id AND h.user_id = $2
         WHERE m.conversation_id = ANY($1::int[]) AND m.is_deleted = false AND m.sender_id != $2
           AND m.id > COALESCE(r.last_read_message_id, 0) AND h.message_id IS NULL
         GROUP BY m.conversation_id`,
        [conversationIds, userId]
    );
    for (const row of unread.rows) {
        summaries[row.conversation_id].unreadCount = row.count;
    }
    return summaries;
}

module.exports = {
    createMessage,
    attachFile,
    getMessageById,
    findDeliverableMessage,
    listMessages,
    getAttachments,
    searchMessages,
    editMessage,
    hideMessageForUser,
    deleteMessageForEveryone,
    setPinned,
    markRead,
    getConversationSummaries
};
