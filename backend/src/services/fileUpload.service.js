const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/database');
const uploadPaths = require('../config/uploadPaths');
const backupMirror = require('../config/backupMirror');
const clamav = require('../utils/clamav.util');
const imageProcessor = require('../utils/imageProcessor.util');
const videoProcessor = require('../utils/videoProcessor.util');
const activityLogService = require('./activityLog.service');
const adminAudit = require('./adminAudit.service');
const systemSettings = require('./systemSettings.service');

const SETTING_KEY = 'max_file_size_bytes';
const SOFT_WARN_BYTES = 500 * 1024 * 1024;
const IMAGE_MIME_PREFIX = 'image/';
const VIDEO_MIME_PREFIX = 'video/';
const VARIANT_COLUMNS = {
    original: 'original_path',
    compressed: 'compressed_path',
    thumbnail: 'thumbnail_path'
};

async function ensureDirectories() {
    await fs.mkdir(uploadPaths.TEMP_DIR, { recursive: true });
    await fs.mkdir(uploadPaths.ORIGINAL_DIR, { recursive: true });
    await fs.mkdir(uploadPaths.COMPRESSED_DIR, { recursive: true });
    await fs.mkdir(uploadPaths.THUMBNAIL_DIR, { recursive: true });
}

async function getMaxFileSizeBytes() {
    const result = await db.query('SELECT value FROM system_settings WHERE key = $1', [SETTING_KEY]);
    const raw = result.rows[0] ? result.rows[0].value : 'unlimited';
    if (!raw || raw === 'unlimited' || raw === '-1') {
        return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function setMaxFileSizeBytes(value) {
    const stored = value === null ? 'unlimited' : String(value);
    await db.query(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [SETTING_KEY, stored]
    );
    return stored;
}

function randomFileName(originalName) {
    const ext = path.extname(originalName || '').slice(0, 10);
    return `${crypto.randomUUID()}${ext}`;
}

async function checkSoftLimit(actorId, sizeBytes) {
    if (sizeBytes > SOFT_WARN_BYTES) {
        await activityLogService.log(actorId, 'upload.soft_limit_warning', {
            sizeBytes,
            softLimitBytes: SOFT_WARN_BYTES
        });
    }
}

async function removeTempFile(tempPath) {
    try {
        await fs.unlink(tempPath);
    } catch (err) {
        return;
    }
}

async function scanUpload(tempPath) {
    if (!(await systemSettings.getFlag('fileScanEnabled'))) {
        return 'unscanned';
    }
    return clamav.scanFile(tempPath);
}

async function storeUpload({ tempPath, originalName, mimeType, sizeBytes, requestedMode, actorId }) {
    const scanResult = await scanUpload(tempPath);
    if (scanResult === 'infected') {
        await removeTempFile(tempPath);
        await activityLogService.log(actorId, 'upload.infected_file_blocked', { originalName, mimeType });
        await adminAudit.record(actorId, 'upload.infected_blocked', originalName || 'فایل بدون نام', { mimeType });
        return { status: 'infected' };
    }

    let avScanStatus = scanResult;
    if (scanResult === 'error') {
        if (!clamav.shouldFailOpen()) {
            await removeTempFile(tempPath);
            await activityLogService.log(actorId, 'upload.scan_error_blocked', { originalName, mimeType });
            return { status: 'scan_error' };
        }
        avScanStatus = 'unscanned';
        await activityLogService.log(actorId, 'upload.scan_unavailable_allowed', { originalName, mimeType });
    }

    const isImage = (mimeType || '').startsWith(IMAGE_MIME_PREFIX);
    const isVideo = (mimeType || '').startsWith(VIDEO_MIME_PREFIX);
    const storedName = randomFileName(originalName);
    const originalDestPath = path.join(uploadPaths.ORIGINAL_DIR, storedName);
    await fs.copyFile(tempPath, originalDestPath);
    await backupMirror.mirrorFile(originalDestPath);

    let compressedPath = null;
    let thumbnailPath = null;
    let mode = 'file';

    if (requestedMode === 'compressed' && isImage) {
        mode = 'compressed';
        const baseName = storedName.replace(/\.[^.]+$/, '');
        const compressedDestPath = path.join(uploadPaths.COMPRESSED_DIR, `${baseName}.png`);
        const thumbnailDestPath = path.join(uploadPaths.THUMBNAIL_DIR, `${baseName}.png`);
        try {
            await imageProcessor.createCompressed(tempPath, compressedDestPath);
            await imageProcessor.createThumbnail(tempPath, thumbnailDestPath);
            compressedPath = compressedDestPath;
            thumbnailPath = thumbnailDestPath;
            await backupMirror.mirrorFile(compressedDestPath);
            await backupMirror.mirrorFile(thumbnailDestPath);
        } catch (err) {
            mode = 'file';
        }
    } else if (requestedMode === 'compressed' && isVideo) {
        mode = 'compressed';
        const baseName = storedName.replace(/\.[^.]+$/, '');
        const compressedDestPath = path.join(uploadPaths.COMPRESSED_DIR, `${baseName}.mp4`);
        const thumbnailDestPath = path.join(uploadPaths.THUMBNAIL_DIR, `${baseName}.png`);
        try {
            await videoProcessor.createCompressed(tempPath, compressedDestPath);
            await videoProcessor.createThumbnail(tempPath, thumbnailDestPath);
            compressedPath = compressedDestPath;
            thumbnailPath = thumbnailDestPath;
            await backupMirror.mirrorFile(compressedDestPath);
            await backupMirror.mirrorFile(thumbnailDestPath);
        } catch (err) {
            mode = 'file';
        }
    }

    await removeTempFile(tempPath);
    await checkSoftLimit(actorId, sizeBytes);

    return {
        status: 'clean',
        mode,
        originalName: (originalName || '').slice(0, 255),
        originalPath: originalDestPath,
        compressedPath,
        thumbnailPath,
        mimeType,
        sizeBytes,
        avScanStatus
    };
}

async function createFileRecord({ messageId, storedResult, targetTable }) {
    const columnMap = {
        messages: 'message_id',
        group_messages: 'group_message_id',
        channel_messages: 'channel_message_id',
        bot_reminders: 'reminder_id',
        task_reports: 'task_report_id'
    };
    const targetColumn = columnMap[targetTable] || 'message_id';
    const result = await db.query(
        `INSERT INTO message_files
            (${targetColumn}, original_path, compressed_path, thumbnail_path, mode, mime_type, size_bytes, av_scan_status, original_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
            messageId,
            storedResult.originalPath,
            storedResult.compressedPath,
            storedResult.thumbnailPath,
            storedResult.mode,
            storedResult.mimeType,
            storedResult.sizeBytes,
            storedResult.avScanStatus,
            storedResult.originalName || null
        ]
    );
    return result.rows[0];
}

async function getFileById(fileId) {
    const result = await db.query('SELECT * FROM message_files WHERE id = $1', [fileId]);
    return result.rows[0] || null;
}

async function cloneFileForOwner({ sourceFileId, ownerId, targetTable }) {
    const columnMap = {
        messages: 'message_id',
        group_messages: 'group_message_id',
        channel_messages: 'channel_message_id'
    };
    const targetColumn = columnMap[targetTable];
    if (!targetColumn) {
        throw new Error(`INVALID_CLONE_TARGET_TABLE: ${targetTable}`);
    }

    const source = await getFileById(sourceFileId);
    if (!source) {
        return null;
    }

    const copyIfPresent = async (sourcePath, destDir) => {
        if (!sourcePath) {
            return null;
        }
        const destPath = path.join(destDir, randomFileName(sourcePath));
        await fs.copyFile(sourcePath, destPath);
        await backupMirror.mirrorFile(destPath);
        return destPath;
    };

    const clonedOriginalPath = await copyIfPresent(source.original_path, uploadPaths.ORIGINAL_DIR);
    const clonedCompressedPath = await copyIfPresent(source.compressed_path, uploadPaths.COMPRESSED_DIR);
    const clonedThumbnailPath = await copyIfPresent(source.thumbnail_path, uploadPaths.THUMBNAIL_DIR);

    const result = await db.query(
        `INSERT INTO message_files
            (${targetColumn}, original_path, compressed_path, thumbnail_path, mode, mime_type, size_bytes, av_scan_status, original_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
            ownerId,
            clonedOriginalPath,
            clonedCompressedPath,
            clonedThumbnailPath,
            source.mode,
            source.mime_type,
            source.size_bytes,
            source.av_scan_status,
            source.original_name
        ]
    );
    return result.rows[0];
}

async function deleteReminderAttachment(fileId) {
    const result = await db.query(
        'DELETE FROM message_files WHERE id = $1 AND reminder_id IS NOT NULL RETURNING *',
        [fileId]
    );
    const fileRow = result.rows[0];
    if (!fileRow) {
        return false;
    }
    const variantPaths = [fileRow.original_path, fileRow.compressed_path, fileRow.thumbnail_path].filter(Boolean);
    for (const variantPath of variantPaths) {
        await removeLocalFile(variantPath);
        await backupMirror.removeMirroredCopy(variantPath);
    }
    return true;
}

async function removeLocalFile(filePath) {
    if (!filePath) {
        return;
    }
    try {
        await fs.unlink(filePath);
    } catch (err) {

    }
}

async function deleteFileCompletely(fileId) {
    const client = await db.pool.connect();
    let fileRow;
    const deletedMessages = {};
    try {
        await client.query('BEGIN');
        const result = await client.query('SELECT * FROM message_files WHERE id = $1 FOR UPDATE', [fileId]);
        fileRow = result.rows[0];
        if (!fileRow) {
            await client.query('ROLLBACK');
            return null;
        }

        deletedMessages.conversation = (await client.query(
            `UPDATE messages SET is_deleted = true, body = NULL
             WHERE (id = $1 OR file_id = $2) AND is_deleted = false
             RETURNING id, conversation_id, sender_id`,
            [fileRow.message_id, fileId]
        )).rows;
        deletedMessages.channel = (await client.query(
            `UPDATE channel_messages SET is_deleted = true, body = NULL
             WHERE (id = $1 OR file_id = $2) AND is_deleted = false
             RETURNING id, channel_id, sender_id`,
            [fileRow.channel_message_id, fileId]
        )).rows;
        deletedMessages.group = (await client.query(
            `UPDATE group_messages SET is_deleted = true, body = NULL
             WHERE (id = $1 OR file_id = $2) AND is_deleted = false
             RETURNING id, group_id, sender_id`,
            [fileRow.group_message_id, fileId]
        )).rows;
        if (fileRow.reminder_id) {
            await client.query(
                `UPDATE bot_reminders SET attachment_file_id = NULL, message_type = 'text' WHERE id = $1`,
                [fileRow.reminder_id]
            );
        }
        await client.query('DELETE FROM message_files WHERE id = $1', [fileId]);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    const variantPaths = [fileRow.original_path, fileRow.compressed_path, fileRow.thumbnail_path].filter(Boolean);
    let backupCopyRemoved = false;
    for (const variantPath of variantPaths) {
        await removeLocalFile(variantPath);
        const removed = await backupMirror.removeMirroredCopy(variantPath);
        backupCopyRemoved = backupCopyRemoved || removed;
    }

    const conversationMessage = deletedMessages.conversation[0];
    return {
        conversationId: conversationMessage ? conversationMessage.conversation_id : null,
        messageId: conversationMessage ? conversationMessage.id : fileRow.message_id,
        fileName: fileRow.original_name,
        senderId: conversationMessage ? conversationMessage.sender_id : null,
        deletedMessages,
        backupCopyRemoved,
        backupMirrorConfigured: backupMirror.isConfigured()
    };
}

module.exports = {
    ensureDirectories,
    getMaxFileSizeBytes,
    setMaxFileSizeBytes,
    scanUpload,
    storeUpload,
    createFileRecord,
    cloneFileForOwner,
    deleteReminderAttachment,
    getFileById,
    deleteFileCompletely,
    removeLocalFile,
    SOFT_WARN_BYTES,
    VARIANT_COLUMNS
};
