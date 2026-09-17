const db = require('../config/database');
const format = require('../utils/persianFormat.util');
const targetService = require('./workspaceTarget.service');
const attachmentClassifier = require('../utils/attachmentClassifier');

const MESSAGE_TABLES = {
    conversation: { table: 'messages', column: 'conversation_id', alias: 'm' },
    channel: { table: 'channel_messages', column: 'channel_id', alias: 'm' },
    group: { table: 'group_messages', column: 'group_id', alias: 'm' }
};

function sizeLabel(bytes) {
    if (!bytes || bytes <= 0) {
        return '';
    }
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) {
        return `${format.toPersianDigits(mb.toFixed(1))} مگابایت`;
    }
    return `${format.toPersianDigits(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`;
}

function vaultType(mimeType, name) {
    const mime = mimeType || '';
    const lower = String(name || '').toLowerCase();
    if (lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.7z')) {
        return 'zip';
    }
    if (lower.endsWith('.mp4') || mime.startsWith('video/')) {
        return 'mp4';
    }
    return 'pdf';
}

async function listAttachments(targetType, targetId, mode) {
    const spec = MESSAGE_TABLES[targetType];
    const mediaCondition =
        mode === 'media'
            ? "f.mode = 'compressed' AND (f.mime_type LIKE 'image/%' OR f.mime_type LIKE 'video/%')"
            : "NOT (f.mode = 'compressed' AND (f.mime_type LIKE 'image/%' OR f.mime_type LIKE 'video/%'))";

    const result = await db.query(
        `SELECT f.id, f.mime_type, f.size_bytes, f.original_name, f.mode, m.created_at
         FROM ${spec.table} m
         JOIN message_files f ON f.id = m.file_id
         WHERE m.${spec.column} = $1
           AND m.is_deleted = false
           AND m.is_confidential = false
           AND f.av_scan_status <> 'infected'
           AND ${mediaCondition}
         ORDER BY m.id DESC
         LIMIT 40`,
        [targetId]
    );
    const now = new Date();
    return result.rows.map((row) => ({
        fileId: row.id,
        name: row.original_name || 'پیوست',
        size: `${sizeLabel(row.size_bytes)} • ${format.relativeTime(new Date(row.created_at), now)}`,
        type: vaultType(row.mime_type, row.original_name),
        mimeType: row.mime_type,
        mode: row.mode
    }));
}

async function listLinks(targetType, targetId) {
    const result = await db.query(
        `SELECT l.*, u.full_name AS creator_name
         FROM related_links l
         LEFT JOIN users u ON u.id = l.created_by
         WHERE l.target_type = $1 AND l.target_id = $2
         ORDER BY l.created_at DESC
         LIMIT 30`,
        [targetType, targetId]
    );
    return result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        url: row.url,
        icon: row.icon || 'link',
        addedBy: row.creator_name || 'همکار'
    }));
}

async function addLink(targetType, targetId, userId, { title, url, icon }) {
    const result = await db.query(
        `INSERT INTO related_links (target_type, target_id, title, url, icon, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [targetType, targetId, title, url, icon || 'link', userId]
    );
    return result.rows[0].id;
}

async function removeLink(linkId, viewer) {
    const existing = await db.query('SELECT * FROM related_links WHERE id = $1', [linkId]);
    const row = existing.rows[0];
    if (!row) {
        return { error: 'NOT_FOUND' };
    }
    if (row.created_by !== viewer.sub && !(await targetService.canModerate(row.target_type, row.target_id, viewer))) {
        return { error: 'FORBIDDEN' };
    }
    await db.query('DELETE FROM related_links WHERE id = $1', [linkId]);
    return { success: true, targetType: row.target_type, targetId: row.target_id };
}

module.exports = {
    MESSAGE_TABLES,
    CATEGORIES: attachmentClassifier.CATEGORIES,
    listAttachments,
    listLinks,
    addLink,
    removeLink
};
