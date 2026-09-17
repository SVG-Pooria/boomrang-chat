const db = require('../config/database');
const fileUploadService = require('./fileUpload.service');
const format = require('../utils/persianFormat.util');

const SCOPES = ['conversation', 'channel', 'group', 'reminder'];
const LIST_LIMIT = 300;
const SEARCH_LIMIT = 100;

const FILE_SELECT = `
    SELECT f.id, f.original_name, f.mime_type, f.size_bytes, f.created_at,
           CASE
               WHEN f.message_id IS NOT NULL THEN 'conversation'
               WHEN f.channel_message_id IS NOT NULL THEN 'channel'
               WHEN f.group_message_id IS NOT NULL THEN 'group'
               ELSE 'reminder'
           END AS scope,
           COALESCE(m.is_deleted, cm.is_deleted, gm.is_deleted, false) AS message_deleted,
           COALESCE(mu.full_name, cu.full_name, gu.full_name, ru.full_name) AS sender_name,
           c.type AS conversation_type, c.title AS conversation_title, c.is_system_channel,
           ua.full_name AS user_a_name, ub.full_name AS user_b_name,
           ch.title AS channel_title, g.title AS group_title, r.title AS reminder_title
    FROM message_files f
    LEFT JOIN messages m ON m.id = f.message_id
    LEFT JOIN conversations c ON c.id = m.conversation_id
    LEFT JOIN users ua ON ua.id = c.direct_user_a
    LEFT JOIN users ub ON ub.id = c.direct_user_b
    LEFT JOIN users mu ON mu.id = m.sender_id
    LEFT JOIN channel_messages cm ON cm.id = f.channel_message_id
    LEFT JOIN channels ch ON ch.id = cm.channel_id
    LEFT JOIN users cu ON cu.id = cm.sender_id
    LEFT JOIN group_messages gm ON gm.id = f.group_message_id
    LEFT JOIN groups g ON g.id = gm.group_id
    LEFT JOIN users gu ON gu.id = gm.sender_id
    LEFT JOIN bot_reminders r ON r.id = f.reminder_id
    LEFT JOIN users ru ON ru.id = r.created_by
    WHERE f.message_id IS NOT NULL OR f.channel_message_id IS NOT NULL
       OR f.group_message_id IS NOT NULL OR f.reminder_id IS NOT NULL`;

function placeLabel(row) {
    if (row.scope === 'conversation') {
        if (row.conversation_type === 'direct') {
            return `گفتگوی خصوصی: ${row.user_a_name || 'کاربر حذف‌شده'} و ${row.user_b_name || 'کاربر حذف‌شده'}`;
        }
        return row.conversation_title || (row.is_system_channel ? 'اطلاعیه‌ها' : 'گفتگوی سازمانی');
    }
    if (row.scope === 'channel') {
        return `کانال #${row.channel_title || 'حذف‌شده'}`;
    }
    if (row.scope === 'group') {
        return `گروه ${row.group_title || 'حذف‌شده'}`;
    }
    return `یادآوری بات: ${row.reminder_title || 'حذف‌شده'}`;
}

function serialize(row, now) {
    return {
        id: row.id,
        name: row.original_name || 'فایل بدون نام',
        scope: row.scope,
        place: placeLabel(row),
        sender: row.sender_name || 'کاربر حذف‌شده',
        size: format.fileSize(row.size_bytes),
        at: format.dayStamp(new Date(row.created_at), now),
        mimeType: row.mime_type || null,
        messageDeleted: Boolean(row.message_deleted)
    };
}

async function list({ scope = null, search = '' } = {}) {
    const params = [];
    const conditions = [];
    if (SCOPES.includes(scope)) {
        params.push(scope);
        conditions.push(`x.scope = $${params.length}`);
    }
    const term = String(search || '').trim().slice(0, SEARCH_LIMIT);
    if (term) {
        params.push(`%${term}%`);
        const index = params.length;
        conditions.push(
            `(x.original_name ILIKE $${index} OR x.sender_name ILIKE $${index}
              OR x.conversation_title ILIKE $${index} OR x.channel_title ILIKE $${index}
              OR x.group_title ILIKE $${index} OR x.reminder_title ILIKE $${index}
              OR x.user_a_name ILIKE $${index} OR x.user_b_name ILIKE $${index})`
        );
    }
    params.push(LIST_LIMIT);
    const result = await db.query(
        `SELECT * FROM (${FILE_SELECT}) x
         ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
         ORDER BY x.created_at DESC
         LIMIT $${params.length}`,
        params
    );
    const now = new Date();
    return result.rows.map((row) => serialize(row, now));
}

async function remove(fileId) {
    const found = await db.query(`SELECT * FROM (${FILE_SELECT}) x WHERE x.id = $1`, [fileId]);
    if (!found.rows[0]) {
        return null;
    }
    const outcome = await fileUploadService.deleteFileCompletely(fileId);
    if (!outcome) {
        return null;
    }
    const notifier = require('../socket/notifier');
    outcome.deletedMessages.conversation.forEach((row) => notifier.notifyMessageDeleted(row.conversation_id, row.id));
    outcome.deletedMessages.channel.forEach((row) => notifier.notifyChannelMessageDeleted(row.channel_id, row.id));
    outcome.deletedMessages.group.forEach((row) => notifier.notifyGroupMessageDeleted(row.group_id, row.id));
    return {
        ...serialize(found.rows[0], new Date()),
        backupCopyRemoved: outcome.backupCopyRemoved,
        backupMirrorConfigured: outcome.backupMirrorConfigured
    };
}

module.exports = { SCOPES, list, remove };
