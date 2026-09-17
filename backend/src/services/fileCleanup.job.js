const fs = require('fs/promises');
const path = require('path');
const cron = require('node-cron');
const db = require('../config/database');
const uploadPaths = require('../config/uploadPaths');
const backupMirror = require('../config/backupMirror');
const activityLogService = require('./activityLog.service');
const adminAudit = require('./adminAudit.service');

const SWEEP_DIRS = [uploadPaths.ORIGINAL_DIR, uploadPaths.COMPRESSED_DIR, uploadPaths.THUMBNAIL_DIR];
const MIN_ORPHAN_AGE_MS = 6 * 60 * 60 * 1000;

async function removeLocalFile(filePath) {
    try {
        await fs.unlink(filePath);
    } catch (err) {
        return;
    }
}

async function removeOrphanedRows() {
    const result = await db.query(
        `DELETE FROM message_files
         WHERE message_id IS NULL AND group_message_id IS NULL
           AND channel_message_id IS NULL AND reminder_id IS NULL
         RETURNING original_path, compressed_path, thumbnail_path`
    );
    for (const row of result.rows) {
        const variantPaths = [row.original_path, row.compressed_path, row.thumbnail_path].filter(Boolean);
        for (const variantPath of variantPaths) {
            await removeLocalFile(variantPath);
            await backupMirror.removeMirroredCopy(variantPath);
        }
    }
    return result.rows.length;
}

async function loadReferencedPaths() {
    const result = await db.query(
        'SELECT original_path, compressed_path, thumbnail_path FROM message_files'
    );
    const referenced = new Set();
    for (const row of result.rows) {
        if (row.original_path) referenced.add(path.resolve(row.original_path));
        if (row.compressed_path) referenced.add(path.resolve(row.compressed_path));
        if (row.thumbnail_path) referenced.add(path.resolve(row.thumbnail_path));
    }
    return referenced;
}

async function sweepDir(dir, referencedPaths) {
    let entries;
    try {
        entries = await fs.readdir(dir);
    } catch (err) {
        return 0;
    }
    let removed = 0;
    for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        if (referencedPaths.has(path.resolve(fullPath))) {
            continue;
        }
        let stats;
        try {
            stats = await fs.stat(fullPath);
        } catch (err) {
            continue;
        }
        if (!stats.isFile()) {
            continue;
        }
        const age = Date.now() - stats.mtimeMs;
        if (age < MIN_ORPHAN_AGE_MS) {
            continue;
        }
        await removeLocalFile(fullPath);
        await backupMirror.removeMirroredCopy(fullPath);
        removed += 1;
    }
    return removed;
}

async function sweepOrphanedFiles() {
    const referencedPaths = await loadReferencedPaths();
    let removed = 0;
    for (const dir of SWEEP_DIRS) {
        removed += await sweepDir(dir, referencedPaths);
    }
    return removed;
}

async function purgeExpiredArchives() {
    const result = await db.query(
        `SELECT id, file_path, target_full_name_snapshot
         FROM user_export_archives
         WHERE purged_at IS NULL AND purge_after IS NOT NULL AND purge_after <= now()`
    );
    for (const row of result.rows) {
        await removeLocalFile(row.file_path);
        await db.query('UPDATE user_export_archives SET purged_at = now() WHERE id = $1', [row.id]);
        await adminAudit.record(null, 'archive.purged', row.target_full_name_snapshot, { archiveId: row.id });
    }
    return result.rows.length;
}

async function runCleanup() {
    const removedRows = await removeOrphanedRows();
    const removedFiles = await sweepOrphanedFiles();
    const purgedArchives = await purgeExpiredArchives();
    if (removedRows > 0 || removedFiles > 0) {
        await activityLogService.log(null, 'system.file_cleanup.orphans_removed', {
            removedRows,
            removedFiles
        });
    }
    return { removedRows, removedFiles, purgedArchives };
}

function start() {
    cron.schedule('30 4 * * *', () => {
        runCleanup().catch((err) => {
            console.error('File cleanup job failed:', err.message);
        });
    });
}

module.exports = { start, runCleanup, purgeExpiredArchives };
