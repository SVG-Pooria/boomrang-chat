const fs = require('fs/promises');
const fssync = require('fs');
const path = require('path');
const archiver = require('archiver');
const db = require('../config/database');
const conversationService = require('./conversation.service');
const messageService = require('./message.service');
const fileUploadService = require('./fileUpload.service');
const activityLogService = require('./activityLog.service');

const EXPORTS_DIR = path.join(__dirname, '..', '..', 'exports');
const MESSAGE_PAGE_SIZE = 100;
const DELETED_USER_LABEL = 'کاربر حذف‌شده';
const RETENTION_DAYS = 90;
const SPACE_LABELS = { channel: 'کانال', group: 'گروه' };

async function ensureExportsDir() {
    await fs.mkdir(EXPORTS_DIR, { recursive: true });
}

function sanitizeForPath(value) {
    const cleaned = String(value || '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned.slice(0, 80) || 'بدون_نام';
}

function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatDateForFolder(date) {
    return date.toISOString().slice(0, 10);
}

async function fetchTargetUserSnapshot(targetUserId) {
    const result = await db.query(
        `SELECT u.id, u.full_name, u.phone, u.role, t.name AS tag_name
         FROM users u
         LEFT JOIN tags t ON t.id = u.tag_id
         WHERE u.id = $1`,
        [targetUserId]
    );
    return result.rows[0] || null;
}

async function fetchAllMessages(conversationId) {
    let collected = [];
    let before;
    for (;;) {
        const batch = await messageService.listMessages(conversationId, { limit: MESSAGE_PAGE_SIZE, before });
        if (!batch.length) {
            break;
        }
        collected = batch.concat(collected);
        before = batch[0].id;
        if (batch.length < MESSAGE_PAGE_SIZE) {
            break;
        }
    }
    return collected;
}

async function resolveConversationLabel(conversation, targetUserId) {
    if (conversation.type === 'direct') {
        const other = await conversationService.otherDirectUser(conversation, targetUserId);
        return other ? other.fullName : DELETED_USER_LABEL;
    }
    const kind = conversation.type === 'channel' ? 'کانال' : 'گروه';
    return `${kind}: ${conversation.title || 'بدون عنوان'}`;
}

async function resolveConversationMemberNames(conversation) {
    if (conversation.type === 'direct') {
        return null;
    }
    const memberIds = await conversationService.listMemberIds(conversation.id);
    if (!memberIds.length) {
        return [];
    }
    const result = await db.query(
        'SELECT full_name FROM users WHERE id = ANY($1::int[]) ORDER BY full_name',
        [memberIds]
    );
    return result.rows.map((row) => row.full_name);
}

function buildConversationHtml({ label, memberNames, messages, filesByMessageId }) {
    const rows = messages.map((message) => {
        const senderName = escapeHtml(message.sender_name || DELETED_USER_LABEL);
        const time = new Date(message.created_at).toLocaleString('fa-IR');
        const bodyText = message.is_deleted ? '(پیام حذف‌شده)' : escapeHtml(message.body);
        const fileInfo = filesByMessageId.get(message.id);
        const fileLink = fileInfo
            ? `<div class="attachment">پیوست: <a href="${escapeHtml(fileInfo.relativeHref)}">${escapeHtml(fileInfo.displayName)}</a></div>`
            : '';
        const editedTag = message.is_edited ? ' <span class="edited-tag">(ویرایش‌شده)</span>' : '';
        return `<div class="message">
    <div class="meta"><span class="sender">${senderName}</span><span class="time">${escapeHtml(time)}</span></div>
    <div class="body">${bodyText}${editedTag}</div>
    ${fileLink}
</div>`;
    }).join('\n');

    const membersBlock = memberNames
        ? `<p class="members">اعضا: ${memberNames.map(escapeHtml).join('، ') || '—'}</p>`
        : '';

    return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(label)}</title>
<style>
body { font-family: Tahoma, Arial, sans-serif; background:#f4f4f4; margin:0; padding:20px; }
h1 { font-size:18px; }
.members { color:#555; font-size:13px; }
.message { background:#fff; border-radius:8px; padding:10px 14px; margin-bottom:8px; max-width:720px; }
.meta { display:flex; justify-content:space-between; font-size:12px; color:#777; margin-bottom:4px; }
.sender { font-weight:bold; color:#333; }
.body { white-space:pre-wrap; word-break:break-word; }
.attachment { margin-top:6px; font-size:13px; }
.edited-tag { font-size:11px; color:#999; }
</style>
</head>
<body>
<h1>${escapeHtml(label)}</h1>
${membersBlock}
${rows || '<p>پیامی وجود ندارد.</p>'}
</body>
</html>`;
}

async function copyMessageFile(message, destDir) {
    if (!message.file_id) {
        return null;
    }
    const fileRecord = await fileUploadService.getFileById(message.file_id);
    if (!fileRecord || !fileRecord.original_path) {
        return null;
    }
    const originalName = message.body || `file_${message.id}`;
    const safeName = sanitizeForPath(originalName) || `file_${message.id}`;
    const destName = `${message.id}_${safeName}`;
    const destPath = path.join(destDir, destName);
    try {
        await fs.copyFile(fileRecord.original_path, destPath);
    } catch (err) {
        return null;
    }
    return {
        displayName: originalName,
        destPath,
        mimeType: fileRecord.mime_type,
        sizeBytes: fileRecord.size_bytes
    };
}

async function zipDirectory(sourceDir, destZipPath) {
    return new Promise((resolve, reject) => {
        const output = fssync.createWriteStream(destZipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(sourceDir, false);
        archive.finalize();
    });
}

async function removeDirectoryRecursive(dirPath) {
    await fs.rm(dirPath, { recursive: true, force: true });
}

async function fetchSpaceFiles(targetUserId) {
    const result = await db.query(
        `SELECT 'channel' AS kind, c.id AS space_id, c.title AS space_title, cm.id AS message_id,
                f.original_path, f.original_name, f.mime_type, f.size_bytes
         FROM channel_messages cm
         JOIN message_files f ON f.id = cm.file_id
         JOIN channels c ON c.id = cm.channel_id
         WHERE cm.sender_id = $1 AND cm.is_deleted = false
         UNION ALL
         SELECT 'group' AS kind, g.id, g.title, gm.id,
                f.original_path, f.original_name, f.mime_type, f.size_bytes
         FROM group_messages gm
         JOIN message_files f ON f.id = gm.file_id
         JOIN groups g ON g.id = gm.group_id
         WHERE gm.sender_id = $1 AND gm.is_deleted = false
         ORDER BY kind, space_id, message_id`,
        [targetUserId]
    );
    return result.rows;
}

async function copySpaceFiles(rows, filesRootDir) {
    const spaces = new Map();
    for (const row of rows) {
        const key = `${row.kind}_${row.space_id}`;
        if (!spaces.has(key)) {
            spaces.set(key, {
                kind: row.kind,
                spaceId: row.space_id,
                label: `${SPACE_LABELS[row.kind]}: ${row.space_title}`,
                files: []
            });
        }
        const space = spaces.get(key);
        const folder = path.join(filesRootDir, `${sanitizeForPath(space.label)}_${key}`);
        await fs.mkdir(folder, { recursive: true });
        const displayName = row.original_name || `file_${row.message_id}`;
        const destPath = path.join(folder, `${row.message_id}_${sanitizeForPath(displayName)}`);
        try {
            await fs.copyFile(row.original_path, destPath);
        } catch (err) {
            continue;
        }
        space.files.push({
            messageId: row.message_id,
            fileName: displayName,
            storedAs: path.relative(filesRootDir, destPath).split(path.sep).join('/'),
            mimeType: row.mime_type,
            sizeBytes: row.size_bytes
        });
    }
    return [...spaces.values()].filter((space) => space.files.length > 0);
}

async function markDeleted(archiveId) {
    await db.query(
        `UPDATE user_export_archives
         SET deleted_at = now(), purge_after = now() + make_interval(days => $2)
         WHERE id = $1`,
        [archiveId, RETENTION_DAYS]
    );
}

async function exportUserArchive(targetUserId, adminId) {
    const target = await fetchTargetUserSnapshot(targetUserId);
    if (!target) {
        throw new Error('USER_NOT_FOUND');
    }

    await ensureExportsDir();

    const dateLabel = formatDateForFolder(new Date());
    const workDirName = `user_${targetUserId}_${dateLabel}`;
    const workDir = path.join(EXPORTS_DIR, workDirName);
    const conversationsDir = path.join(workDir, 'conversations');
    const filesRootDir = path.join(workDir, 'files');
    await fs.mkdir(conversationsDir, { recursive: true });
    await fs.mkdir(filesRootDir, { recursive: true });

    const conversations = await conversationService.listForUser(targetUserId);
    const manifestConversations = [];
    const indexEntries = [];

    for (const conversation of conversations) {
        const label = await resolveConversationLabel(conversation, targetUserId);
        const memberNames = await resolveConversationMemberNames(conversation);
        const messages = await fetchAllMessages(conversation.id);

        const folderBaseName = sanitizeForPath(label);
        const counterpartDir = path.join(filesRootDir, `${folderBaseName}_${conversation.id}`);

        const filesByMessageId = new Map();
        const manifestFiles = [];
        for (const message of messages) {
            if (!message.file_id) {
                continue;
            }
            await fs.mkdir(counterpartDir, { recursive: true });
            const copied = await copyMessageFile(message, counterpartDir);
            if (copied) {
                const relativeHref = path.join('..', 'files', `${folderBaseName}_${conversation.id}`, path.basename(copied.destPath));
                filesByMessageId.set(message.id, {
                    relativeHref: relativeHref.split(path.sep).join('/'),
                    displayName: copied.displayName
                });
                manifestFiles.push({
                    messageId: message.id,
                    fileName: copied.displayName,
                    storedAs: path.basename(copied.destPath),
                    mimeType: copied.mimeType,
                    sizeBytes: copied.sizeBytes
                });
            }
        }

        const html = buildConversationHtml({ label, memberNames, messages, filesByMessageId });
        const conversationFileName = `${folderBaseName}_${conversation.id}.html`;
        await fs.writeFile(path.join(conversationsDir, conversationFileName), html, 'utf8');

        manifestConversations.push({
            conversationId: conversation.id,
            type: conversation.type,
            label,
            members: memberNames,
            messageCount: messages.length,
            fileCount: manifestFiles.length,
            files: manifestFiles,
            htmlFile: `conversations/${conversationFileName}`
        });
        indexEntries.push({ label, conversationFileName, messageCount: messages.length, fileCount: manifestFiles.length });
    }

    const spaceFiles = await copySpaceFiles(await fetchSpaceFiles(targetUserId), filesRootDir);
    const fileCount =
        manifestConversations.reduce((sum, entry) => sum + entry.fileCount, 0) +
        spaceFiles.reduce((sum, space) => sum + space.files.length, 0);

    const spacesTable = spaceFiles.length
        ? `<h2>فایل‌های ارسالی در کانال‌ها و گروه‌ها</h2>
<table>
<tr><th>فضا</th><th>تعداد فایل</th></tr>
${spaceFiles.map((space) => `<tr>
<td>${escapeHtml(space.label)}</td>
<td>${space.files.length}</td>
</tr>`).join('\n')}
</table>`
        : '';

    const indexHtml = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<title>آرشیو ${escapeHtml(target.full_name)}</title>
<style>
body { font-family: Tahoma, Arial, sans-serif; background:#f4f4f4; padding:20px; }
h1 { font-size:20px; }
h2 { font-size:16px; margin-top:24px; }
table { border-collapse:collapse; width:100%; max-width:820px; background:#fff; }
td, th { border:1px solid #ddd; padding:8px 12px; text-align:right; font-size:13px; }
th { background:#eee; }
</style>
</head>
<body>
<h1>آرشیو مکالمات: ${escapeHtml(target.full_name)}</h1>
<p>شماره تماس: ${escapeHtml(target.phone)} — نقش: ${escapeHtml(target.role)} — تگ: ${escapeHtml(target.tag_name || '—')}</p>
<p>تاریخ تهیه آرشیو: ${escapeHtml(dateLabel)}</p>
<table>
<tr><th>مکالمه</th><th>تعداد پیام</th><th>تعداد فایل</th><th></th></tr>
${indexEntries.map((entry) => `<tr>
<td>${escapeHtml(entry.label)}</td>
<td>${entry.messageCount}</td>
<td>${entry.fileCount}</td>
<td><a href="conversations/${entry.conversationFileName}">مشاهده</a></td>
</tr>`).join('\n')}
</table>
${spacesTable}
</body>
</html>`;
    await fs.writeFile(path.join(workDir, 'index.html'), indexHtml, 'utf8');

    const manifest = {
        targetUserId,
        targetFullName: target.full_name,
        targetPhone: target.phone,
        targetRole: target.role,
        targetTag: target.tag_name || null,
        generatedAt: new Date().toISOString(),
        generatedBy: adminId,
        fileCount,
        conversations: manifestConversations,
        spaces: spaceFiles
    };
    await fs.writeFile(path.join(workDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    const zipFileName = `${workDirName}.zip`;
    const zipPath = path.join(EXPORTS_DIR, zipFileName);
    await zipDirectory(workDir, zipPath);
    await removeDirectoryRecursive(workDir);

    const stats = await fs.stat(zipPath);

    const inserted = await db.query(
        `INSERT INTO user_export_archives
            (target_user_id_snapshot, target_full_name_snapshot, target_phone_snapshot,
             target_role_snapshot, target_tag_snapshot, file_path, size_bytes, created_by, file_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
            targetUserId,
            target.full_name,
            target.phone,
            target.role,
            target.tag_name || null,
            zipPath,
            stats.size,
            adminId,
            fileCount
        ]
    );

    await activityLogService.log(adminId, 'admin.user.exported', {
        targetUserId,
        archiveId: inserted.rows[0].id,
        sizeBytes: stats.size,
        fileCount,
        conversationCount: manifestConversations.length
    });

    return inserted.rows[0];
}

async function listArchives({ search } = {}) {
    const params = [];
    let condition = '1=1';
    if (search) {
        params.push(`%${search}%`);
        condition += ` AND target_full_name_snapshot ILIKE $${params.length}`;
    }
    const result = await db.query(
        `SELECT * FROM user_export_archives WHERE ${condition} ORDER BY created_at DESC`,
        params
    );
    return result.rows;
}

async function getArchiveById(archiveId) {
    const result = await db.query('SELECT * FROM user_export_archives WHERE id = $1', [archiveId]);
    return result.rows[0] || null;
}

module.exports = {
    EXPORTS_DIR,
    RETENTION_DAYS,
    exportUserArchive,
    markDeleted,
    listArchives,
    getArchiveById
};
