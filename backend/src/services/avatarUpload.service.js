const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/database');
const uploadPaths = require('../config/uploadPaths');
const clamav = require('../utils/clamav.util');
const imageProcessor = require('../utils/imageProcessor.util');
const activityLogService = require('./activityLog.service');
const fileUploadService = require('./fileUpload.service');
const adminAudit = require('./adminAudit.service');

async function ensureDirectories() {
    await fs.mkdir(uploadPaths.AVATAR_DIR, { recursive: true });
}

async function removeTempFile(tempPath) {
    try {
        await fs.unlink(tempPath);
    } catch (err) {
        return;
    }
}

async function removeLocalFile(filePath) {
    if (!filePath) {
        return;
    }
    try {
        await fs.unlink(filePath);
    } catch (err) {
        return;
    }
}

async function processAvatarUpload({ tempPath, mimeType, actorId }) {
    const scanResult = await fileUploadService.scanUpload(tempPath);
    if (scanResult === 'infected') {
        await removeTempFile(tempPath);
        await activityLogService.log(actorId, 'avatar.infected_file_blocked', { mimeType });
        await adminAudit.record(actorId, 'upload.infected_blocked', 'تصویر پروفایل', { mimeType });
        return { status: 'infected' };
    }
    if (scanResult === 'error' && !clamav.shouldFailOpen()) {
        await removeTempFile(tempPath);
        await activityLogService.log(actorId, 'avatar.scan_error_blocked', { mimeType });
        return { status: 'scan_error' };
    }
    if (scanResult === 'error') {
        await activityLogService.log(actorId, 'avatar.scan_unavailable_allowed', { mimeType });
    }

    await ensureDirectories();
    const storedName = `${crypto.randomUUID()}.jpg`;
    const destPath = path.join(uploadPaths.AVATAR_DIR, storedName);

    try {
        await imageProcessor.createAvatar(tempPath, destPath);
    } catch (err) {
        await removeTempFile(tempPath);
        return { status: 'invalid_image' };
    }

    await removeTempFile(tempPath);

    return { status: 'clean', avatarPath: destPath };
}

async function getUserAvatarPath(userId) {
    const result = await db.query('SELECT avatar_path FROM users WHERE id = $1', [userId]);
    return result.rows[0] ? result.rows[0].avatar_path : null;
}

async function setUserAvatar(userId, avatarPath) {
    const previous = await getUserAvatarPath(userId);
    const result = await db.query(
        `UPDATE users SET avatar_path = $1, avatar_updated_at = now()
         WHERE id = $2 RETURNING id, avatar_path, avatar_updated_at`,
        [avatarPath, userId]
    );
    const row = result.rows[0] || null;
    if (row && previous && previous !== avatarPath) {
        await removeLocalFile(previous);
    }
    return row;
}

async function clearUserAvatar(userId) {
    const previous = await getUserAvatarPath(userId);
    const result = await db.query(
        `UPDATE users SET avatar_path = NULL, avatar_updated_at = NULL
         WHERE id = $1 RETURNING id, avatar_path, avatar_updated_at`,
        [userId]
    );
    const row = result.rows[0] || null;
    if (row && previous) {
        await removeLocalFile(previous);
    }
    return row;
}

function entityAvatarTable(kind) {
    if (kind === 'group') {
        return 'groups';
    }
    if (kind === 'channel') {
        return 'channels';
    }
    throw new Error(`UNKNOWN_AVATAR_ENTITY_KIND:${kind}`);
}

async function getEntityAvatarPath(kind, entityId) {
    const table = entityAvatarTable(kind);
    const result = await db.query(`SELECT avatar FROM ${table} WHERE id = $1`, [entityId]);
    return result.rows[0] ? result.rows[0].avatar : null;
}

async function setEntityAvatar(kind, entityId, avatarPath) {
    const table = entityAvatarTable(kind);
    const previous = await getEntityAvatarPath(kind, entityId);
    const result = await db.query(
        `UPDATE ${table} SET avatar = $1, updated_at = now()
         WHERE id = $2 RETURNING id, avatar, updated_at`,
        [avatarPath, entityId]
    );
    const row = result.rows[0] || null;
    if (row && previous && previous !== avatarPath) {
        await removeLocalFile(previous);
    }
    return row;
}

async function clearEntityAvatar(kind, entityId) {
    const table = entityAvatarTable(kind);
    const previous = await getEntityAvatarPath(kind, entityId);
    const result = await db.query(
        `UPDATE ${table} SET avatar = NULL, updated_at = now()
         WHERE id = $1 RETURNING id, avatar, updated_at`,
        [entityId]
    );
    const row = result.rows[0] || null;
    if (row && previous) {
        await removeLocalFile(previous);
    }
    return row;
}

module.exports = {
    ensureDirectories,
    processAvatarUpload,
    getUserAvatarPath,
    setUserAvatar,
    clearUserAvatar,
    getEntityAvatarPath,
    setEntityAvatar,
    clearEntityAvatar,
    removeLocalFile
};
