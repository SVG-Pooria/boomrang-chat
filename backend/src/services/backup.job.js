const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const archiver = require('archiver');
const db = require('../config/database');
const uploadPaths = require('../config/uploadPaths');
const format = require('../utils/persianFormat.util');
const adminAudit = require('./adminAudit.service');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');
const SCHEDULE = '0 3 * * *';
const STALE_RUNNING_HOURS = 6;
const HISTORY_LIMIT = 30;
const ERROR_LIMIT = 500;
const STATUS_LABELS = { success: 'موفق', failed: 'ناموفق', running: 'در حال اجرا' };
const SKIPPED_UPLOAD_DIRS = new Set([path.basename(uploadPaths.TEMP_DIR)]);

class BackupRunningError extends Error {
    constructor() {
        super('BACKUP_RUNNING');
        this.code = 'BACKUP_RUNNING';
    }
}

function notifyAdmins(backupId) {
    require('../socket/notifier').notifyAdmins('admin:backups', { id: backupId });
}

function resolvePgDump() {
    if (process.env.PG_DUMP_BIN) {
        return process.env.PG_DUMP_BIN;
    }
    if (process.platform === 'win32') {
        const root = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL');
        try {
            const found = fs.readdirSync(root)
                .filter((name) => /^\d+$/.test(name))
                .sort((a, b) => Number(b) - Number(a))
                .map((version) => path.join(root, version, 'bin', 'pg_dump.exe'))
                .find((candidate) => fs.existsSync(candidate));
            if (found) {
                return found;
            }
        } catch (err) {
            return 'pg_dump';
        }
    }
    return 'pg_dump';
}

function dumpDatabase(outputFile) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputFile);
        const child = spawn(resolvePgDump(), ['--no-owner', '--dbname', process.env.DATABASE_URL], {
            windowsHide: true
        });
        let stderr = '';
        let exitCode = null;
        let written = false;
        const settle = () => {
            if (exitCode === null || !written) {
                return;
            }
            if (exitCode === 0) {
                resolve();
                return;
            }
            reject(new Error(stderr.trim() || `pg_dump exited with code ${exitCode}`));
        };
        child.stdout.pipe(output);
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', (err) => {
            output.destroy();
            reject(err);
        });
        output.on('error', reject);
        output.on('close', () => {
            written = true;
            settle();
        });
        child.on('close', (code) => {
            exitCode = code;
            settle();
        });
    });
}

function includeUploadEntry(entry) {
    const parts = entry.name.split('/');
    const topLevel = parts[0] === 'uploads' ? parts[1] : parts[0];
    return SKIPPED_UPLOAD_DIRS.has(topLevel) ? false : entry;
}

function writeArchive(sqlFile, zipFile) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipFile);
        const archive = archiver('zip', { zlib: { level: 6 } });
        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);
        archive.on('warning', (err) => {
            if (err.code !== 'ENOENT') {
                reject(err);
            }
        });
        archive.pipe(output);
        archive.file(sqlFile, { name: 'database.sql' });
        if (fs.existsSync(uploadPaths.ROOT)) {
            archive.directory(uploadPaths.ROOT, 'uploads', includeUploadEntry);
        }
        archive.finalize();
    });
}

function markInterrupted(olderThanHours) {
    return db.query(
        `UPDATE backups SET status = 'failed', finished_at = now(), error_message = 'INTERRUPTED'
         WHERE status = 'running' AND started_at < now() - make_interval(hours => $1)`,
        [olderThanHours]
    );
}

async function begin(trigger, actorId) {
    await markInterrupted(STALE_RUNNING_HOURS);
    try {
        const result = await db.query(
            'INSERT INTO backups (trigger, triggered_by) VALUES ($1, $2) RETURNING *',
            [trigger, actorId || null]
        );
        return result.rows[0];
    } catch (err) {
        if (err.code === '23505') {
            throw new BackupRunningError();
        }
        throw err;
    }
}

function secondsSince(startedAt) {
    return Math.round((Date.now() - startedAt) / 1000);
}

async function complete(backup) {
    await fsp.mkdir(BACKUP_DIR, { recursive: true });
    const baseName = `boomrang-backup-${new Date(backup.started_at).toISOString().replace(/[:.]/g, '-')}`;
    const sqlFile = path.join(BACKUP_DIR, `${baseName}.sql`);
    const zipFile = path.join(BACKUP_DIR, `${baseName}.zip`);
    const startedAt = Date.now();
    let outcome;
    try {
        await dumpDatabase(sqlFile);
        await writeArchive(sqlFile, zipFile);
        const stats = await fsp.stat(zipFile);
        const result = await db.query(
            `UPDATE backups
             SET status = 'success', finished_at = now(), size_bytes = $1, duration_seconds = $2, file_path = $3
             WHERE id = $4 RETURNING *`,
            [stats.size, secondsSince(startedAt), zipFile, backup.id]
        );
        outcome = {
            row: result.rows[0],
            action: `backup.${backup.trigger}`,
            target: `پایگاه‌داده و فایل‌ها — ${format.fileSize(stats.size)}`
        };
    } catch (err) {
        const message = String(err.message || err).slice(0, ERROR_LIMIT);
        await fsp.rm(zipFile, { force: true }).catch(() => {});
        const result = await db.query(
            `UPDATE backups
             SET status = 'failed', finished_at = now(), duration_seconds = $1, error_message = $2
             WHERE id = $3 RETURNING *`,
            [secondsSince(startedAt), message, backup.id]
        );
        outcome = { row: result.rows[0], action: 'backup.failed', target: message.slice(0, 160) };
    } finally {
        await fsp.rm(sqlFile, { force: true }).catch(() => {});
    }
    await adminAudit.record(backup.triggered_by, outcome.action, outcome.target, { backupId: backup.id });
    notifyAdmins(backup.id);
    return outcome.row;
}

async function runBackup({ trigger = 'schedule', actorId = null } = {}) {
    const backup = await begin(trigger, actorId);
    notifyAdmins(backup.id);
    const completion = complete(backup).catch((err) => {
        console.error(`Backup #${backup.id} could not be finalised:`, err.message);
        return null;
    });
    return { backup, completion };
}

function serialize(row, now = new Date()) {
    return {
        id: row.id,
        at: format.dayStamp(new Date(row.started_at), now),
        size: row.size_bytes ? format.fileSize(row.size_bytes) : '—',
        status: row.status,
        statusLabel: STATUS_LABELS[row.status],
        duration: row.status === 'success' ? format.elapsed(row.duration_seconds) : '—',
        downloadable: row.status === 'success' && Boolean(row.file_path)
    };
}

async function overview() {
    const [history, latest] = await Promise.all([
        db.query('SELECT * FROM backups ORDER BY started_at DESC, id DESC LIMIT $1', [HISTORY_LIMIT]),
        db.query(`SELECT * FROM backups WHERE status = 'success' ORDER BY started_at DESC LIMIT 1`)
    ]);
    const now = new Date();
    const last = latest.rows[0];
    return {
        backups: history.rows.map((row) => serialize(row, now)),
        latest: last ? `${format.dayStamp(new Date(last.started_at), now)} — ${format.fileSize(last.size_bytes)}` : null,
        running: history.rows.some((row) => row.status === 'running')
    };
}

async function getById(backupId) {
    const result = await db.query('SELECT * FROM backups WHERE id = $1', [backupId]);
    return result.rows[0] || null;
}

function start() {
    markInterrupted(0).catch((err) => {
        console.error('Could not close interrupted backups:', err.message);
    });
    cron.schedule(
        SCHEDULE,
        () => {
            runBackup()
                .then(({ completion }) => completion)
                .catch((err) => {
                    if (err.code !== 'BACKUP_RUNNING') {
                        console.error('Scheduled backup failed to start:', err.message);
                    }
                });
        },
        { timezone: format.TIMEZONE }
    );
}

module.exports = {
    BACKUP_DIR,
    BackupRunningError,
    start,
    runBackup,
    overview,
    serialize,
    getById
};
