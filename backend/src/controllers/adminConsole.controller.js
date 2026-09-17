const fsp = require('fs/promises');
const path = require('path');
const adminConsole = require('../services/adminConsole.service');
const adminAudit = require('../services/adminAudit.service');
const sessionService = require('../services/session.service');
const systemSettings = require('../services/systemSettings.service');
const fileUploadService = require('../services/fileUpload.service');
const cooldownService = require('../services/cooldown.service');
const backupJob = require('../services/backup.job');
const userService = require('../services/user.service');
const userExportService = require('../services/userExport.service');
const notifier = require('../socket/notifier');
const format = require('../utils/persianFormat.util');

const SPACE_KINDS = ['channel', 'group'];
const SPACE_LABELS = { channel: 'کانال', group: 'گروه' };
const BYTES_PER_MB = 1024 * 1024;
const MAX_FILE_SIZE_MB = 102400;
const MAX_COOLDOWN_SECONDS = 3600;
const TITLE_LIMIT = 255;
const AUDIT_PAGE_LIMIT = 200;

function parseId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function parseSpace(req) {
    const id = parseId(req.params.id);
    return SPACE_KINDS.includes(req.params.kind) && id ? { kind: req.params.kind, id } : null;
}

function handleConsoleError(err, res) {
    if (err instanceof adminConsole.AdminConsoleError) {
        res.status(err.status).json({ error: err.code });
        return true;
    }
    return false;
}

async function overview(req, res) {
    return res.status(200).json(await adminConsole.overview());
}

async function badges(req, res) {
    return res.status(200).json(await adminConsole.badges(req.user));
}

async function listUsers(req, res) {
    const result = await adminConsole.listUsers({ search: req.query.search, role: req.query.role });
    return res.status(200).json(result);
}

async function archiveUser(req, res) {
    const userId = parseId(req.params.id);
    if (!userId) {
        return res.status(400).json({ error: 'INVALID_USER_ID' });
    }
    const target = await userService.getUserById(userId);
    if (!target || target.is_bot) {
        return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }
    const archive = await userExportService.exportUserArchive(userId, req.user.sub);
    await adminAudit.record(req.user.sub, 'user.archived', target.full_name, { userId, archiveId: archive.id });
    return res.status(201).json({
        archive: { id: archive.id, downloadUrl: `/api/admin/exports/${archive.id}/download` }
    });
}

async function readSettings() {
    const [maxBytes, messageCooldownSeconds, flags, language] = await Promise.all([
        fileUploadService.getMaxFileSizeBytes(),
        cooldownService.getCooldownSeconds(),
        systemSettings.getFlags(),
        systemSettings.getLanguage()
    ]);
    return {
        maxFileSizeMb: maxBytes === null ? null : Math.round((maxBytes / BYTES_PER_MB) * 100) / 100,
        messageCooldownSeconds,
        language,
        ...flags
    };
}

const LANGUAGE_LABELS = { fa: 'فارسی', en: 'English' };

function sizeLabel(megabytes) {
    return megabytes === null ? 'نامحدود' : `${format.toPersianDigits(megabytes)} مگابایت`;
}

function secondsLabel(seconds) {
    return `${format.toPersianDigits(seconds)} ثانیه`;
}

function switchLabel(enabled) {
    return enabled ? 'روشن' : 'خاموش';
}

function parseSettings(body) {
    const parsed = {};
    if (body.maxFileSizeMb !== undefined) {
        if (body.maxFileSizeMb === null || body.maxFileSizeMb === '') {
            parsed.maxFileSizeMb = null;
        } else {
            const value = Number(body.maxFileSizeMb);
            if (!Number.isFinite(value) || value <= 0 || value > MAX_FILE_SIZE_MB) {
                return { error: 'INVALID_FILE_SIZE' };
            }
            parsed.maxFileSizeMb = Math.round(value * 100) / 100;
        }
    }
    if (body.messageCooldownSeconds !== undefined) {
        const value = Number(body.messageCooldownSeconds);
        if (!Number.isInteger(value) || value < 0 || value > MAX_COOLDOWN_SECONDS) {
            return { error: 'INVALID_COOLDOWN_SECONDS' };
        }
        parsed.messageCooldownSeconds = value;
    }
    for (const name of systemSettings.FLAG_NAMES) {
        if (body[name] !== undefined) {
            if (typeof body[name] !== 'boolean') {
                return { error: 'INVALID_FLAG' };
            }
            parsed[name] = body[name];
        }
    }
    if (body.language !== undefined) {
        if (!systemSettings.LANGUAGES.includes(body.language)) {
            return { error: 'INVALID_LANGUAGE' };
        }
        parsed.language = body.language;
    }
    return { parsed };
}

async function getSettings(req, res) {
    return res.status(200).json({ settings: await readSettings() });
}

async function updateSettings(req, res) {
    const { parsed, error } = parseSettings(req.body || {});
    if (error) {
        return res.status(400).json({ error });
    }
    const current = await readSettings();
    const actorId = req.user.sub;

    if (parsed.maxFileSizeMb !== undefined && parsed.maxFileSizeMb !== current.maxFileSizeMb) {
        await fileUploadService.setMaxFileSizeBytes(
            parsed.maxFileSizeMb === null ? null : Math.round(parsed.maxFileSizeMb * BYTES_PER_MB)
        );
        await adminAudit.record(
            actorId,
            'settings.max_file_size',
            `${sizeLabel(current.maxFileSizeMb)} ← ${sizeLabel(parsed.maxFileSizeMb)}`
        );
    }
    if (
        parsed.messageCooldownSeconds !== undefined &&
        parsed.messageCooldownSeconds !== current.messageCooldownSeconds
    ) {
        await cooldownService.setCooldownSeconds(parsed.messageCooldownSeconds);
        await adminAudit.record(
            actorId,
            'settings.message_cooldown',
            `${secondsLabel(current.messageCooldownSeconds)} ← ${secondsLabel(parsed.messageCooldownSeconds)}`
        );
    }
    for (const name of systemSettings.FLAG_NAMES) {
        if (parsed[name] !== undefined && parsed[name] !== current[name]) {
            await systemSettings.setFlag(name, parsed[name]);
            await adminAudit.record(
                actorId,
                'settings.policy',
                `${systemSettings.POLICY_FLAGS[name].label}: ${switchLabel(current[name])} ← ${switchLabel(parsed[name])}`
            );
        }
    }
    if (parsed.language !== undefined && parsed.language !== current.language) {
        await systemSettings.setLanguage(parsed.language);
        await adminAudit.record(
            actorId,
            'settings.language',
            `${LANGUAGE_LABELS[current.language]} ← ${LANGUAGE_LABELS[parsed.language]}`
        );
    }

    notifier.notifySettingsChanged();
    return res.status(200).json({ settings: await readSettings() });
}

async function deleteTag(req, res) {
    const tagId = parseId(req.params.id);
    if (!tagId) {
        return res.status(400).json({ error: 'INVALID_TAG' });
    }
    const removed = await adminConsole.deleteTag(tagId);
    if (!removed) {
        return res.status(404).json({ error: 'TAG_NOT_FOUND' });
    }
    await adminAudit.record(req.user.sub, 'tag.deleted', removed.name, { tagId, affectedUsers: removed.members });
    return res.status(200).json({ deleted: true });
}

async function listSpaces(req, res) {
    const kind = SPACE_KINDS.includes(req.query.kind) ? req.query.kind : null;
    return res.status(200).json({ spaces: await adminConsole.listSpaces(kind) });
}

async function createSpace(req, res) {
    const { kind, title, ownerId } = req.body || {};
    if (!SPACE_KINDS.includes(kind)) {
        return res.status(400).json({ error: 'INVALID_KIND' });
    }
    const trimmedTitle = String(title || '').trim();
    if (!trimmedTitle) {
        return res.status(400).json({ error: 'TITLE_REQUIRED' });
    }
    if (trimmedTitle.length > TITLE_LIMIT) {
        return res.status(400).json({ error: 'TITLE_TOO_LONG' });
    }
    const owner = parseId(ownerId);
    if (!owner) {
        return res.status(400).json({ error: 'OWNER_REQUIRED' });
    }
    try {
        const space = await adminConsole.createSpace(kind, { title: trimmedTitle, ownerId: owner, actorId: req.user.sub });
        await adminAudit.record(req.user.sub, `${kind}.created`, `${space.name} — مالک: ${space.owner}`, {
            kind,
            spaceId: space.id,
            ownerId: owner
        });
        return res.status(201).json({ space });
    } catch (err) {
        if (handleConsoleError(err, res)) return undefined;
        throw err;
    }
}

async function setSpaceArchived(req, res) {
    const target = parseSpace(req);
    const { archived } = req.body || {};
    if (!target || typeof archived !== 'boolean') {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const result = await adminConsole.setSpaceArchived(target.kind, target.id, archived, req.user.sub);
    if (!result) {
        return res.status(404).json({ error: 'SPACE_NOT_FOUND' });
    }
    if (result.changed) {
        await adminAudit.record(
            req.user.sub,
            `${target.kind}.${archived ? 'archived' : 'restored'}`,
            result.space.title,
            { kind: target.kind, spaceId: target.id }
        );
    }
    return res.status(200).json({ archived });
}

async function spaceMembers(req, res) {
    const target = parseSpace(req);
    if (!target) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const space = await adminConsole.findSpace(target.kind, target.id);
    if (!space) {
        return res.status(404).json({ error: 'SPACE_NOT_FOUND' });
    }
    const data = await adminConsole.spaceMembers(target.kind, target.id);
    return res.status(200).json({ space: { name: space.title, archived: !space.is_active }, ...data });
}

async function addSpaceMember(req, res) {
    const target = parseSpace(req);
    const userId = parseId((req.body || {}).userId);
    if (!target || !userId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    try {
        const { space, user } = await adminConsole.addSpaceMember(target.kind, target.id, userId);
        await adminAudit.record(
            req.user.sub,
            `${target.kind}.member_added`,
            `${user.full_name} — ${SPACE_LABELS[target.kind]} ${space.title}`,
            { kind: target.kind, spaceId: target.id, userId }
        );
        return res.status(201).json({ added: true });
    } catch (err) {
        if (handleConsoleError(err, res)) return undefined;
        throw err;
    }
}

async function removeSpaceMember(req, res) {
    const target = parseSpace(req);
    const userId = parseId(req.params.userId);
    if (!target || !userId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    try {
        const { space, name } = await adminConsole.removeSpaceMember(target.kind, target.id, userId);
        await adminAudit.record(
            req.user.sub,
            `${target.kind}.member_removed`,
            `${name} — ${SPACE_LABELS[target.kind]} ${space.title}`,
            { kind: target.kind, spaceId: target.id, userId }
        );
        return res.status(200).json({ removed: true });
    } catch (err) {
        if (handleConsoleError(err, res)) return undefined;
        throw err;
    }
}

async function spaceTranscript(req, res) {
    const target = parseSpace(req);
    if (!target) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const before = req.query.before ? parseId(req.query.before) : null;
    const space = await adminConsole.findSpace(target.kind, target.id);
    if (!space) {
        return res.status(404).json({ error: 'SPACE_NOT_FOUND' });
    }
    const messages = await adminConsole.transcript(target.kind, target.id, { before });
    if (!before) {
        await adminAudit.record(
            req.user.sub,
            'oversight.viewed',
            `${SPACE_LABELS[target.kind]} ${space.title}`,
            { kind: target.kind, spaceId: target.id }
        );
    }
    return res.status(200).json({
        space: { kind: target.kind, name: space.title, archived: !space.is_active },
        messages
    });
}

async function listSessions(req, res) {
    const rows = await sessionService.listActive();
    const now = new Date();
    return res.status(200).json({
        sessions: rows.map((row) => sessionService.serialize(row, req.user.sessionId, now))
    });
}

async function revokeSession(req, res) {
    const sessionId = req.params.id;
    if (!sessionService.isValidSessionId(sessionId)) {
        return res.status(400).json({ error: 'INVALID_SESSION_ID' });
    }
    if (sessionId === req.user.sessionId) {
        return res.status(409).json({ error: 'CURRENT_SESSION' });
    }
    const revoked = await sessionService.revoke(sessionId, req.user.sub);
    if (!revoked) {
        return res.status(404).json({ error: 'SESSION_NOT_FOUND' });
    }
    await adminAudit.record(
        req.user.sub,
        'session.revoked',
        `${revoked.full_name} — ${sessionService.deviceLabel(revoked.user_agent)}`,
        { sessionId, userId: revoked.user_id }
    );
    return res.status(200).json({ revoked: true });
}

function parseLevel(value) {
    if (value === undefined || value === '' || value === 'all') {
        return { level: null };
    }
    return adminAudit.LEVELS.includes(value) ? { level: value } : { error: 'INVALID_LEVEL' };
}

async function listAudit(req, res) {
    const { level, error } = parseLevel(req.query.level);
    if (error) {
        return res.status(400).json({ error });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), AUDIT_PAGE_LIMIT);
    return res.status(200).json({ entries: await adminAudit.list({ level, limit }) });
}

async function exportAudit(req, res) {
    const { level, error } = parseLevel(req.query.level);
    if (error) {
        return res.status(400).json({ error });
    }
    await adminAudit.record(
        req.user.sub,
        'activity.exported',
        level ? `فقط رویدادهای ${adminAudit.LEVEL_LABELS[level]}` : 'همه رویدادها',
        { level }
    );
    const csv = await adminAudit.exportCsv(level);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="boomrang-activity-${format.dayKey(new Date())}.csv"`);
    return res.status(200).send(csv);
}

async function listBackups(req, res) {
    return res.status(200).json(await backupJob.overview());
}

async function runBackup(req, res) {
    try {
        const { backup } = await backupJob.runBackup({ trigger: 'manual', actorId: req.user.sub });
        return res.status(202).json({ backup: backupJob.serialize(backup) });
    } catch (err) {
        if (err.code === 'BACKUP_RUNNING') {
            return res.status(409).json({ error: 'BACKUP_RUNNING' });
        }
        throw err;
    }
}

async function downloadBackup(req, res) {
    const backupId = parseId(req.params.id);
    if (!backupId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const backup = await backupJob.getById(backupId);
    if (!backup || backup.status !== 'success' || !backup.file_path) {
        return res.status(404).json({ error: 'BACKUP_NOT_FOUND' });
    }
    try {
        await fsp.access(backup.file_path);
    } catch (err) {
        return res.status(404).json({ error: 'FILE_NOT_FOUND' });
    }
    const summary = backupJob.serialize(backup);
    await adminAudit.record(req.user.sub, 'backup.downloaded', `${summary.at} — ${summary.size}`, { backupId });
    return res.download(backup.file_path, path.basename(backup.file_path), (err) => {
        if (err && !res.headersSent) {
            res.status(404).json({ error: 'FILE_NOT_FOUND' });
        }
    });
}

async function listArchives(req, res) {
    return res.status(200).json({ archives: await adminConsole.listArchives() });
}

async function listReminders(req, res) {
    return res.status(200).json({ reminders: await adminConsole.listReminders() });
}

async function listApprovals(req, res) {
    return res.status(200).json({ approvals: await adminConsole.listApprovals(req.user) });
}

async function transferSpaceOwner(req, res) {
    const target = parseSpace(req);
    const userId = parseId((req.body || {}).userId);
    if (!target || !userId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    try {
        const { space, user } = await adminConsole.transferSpaceOwner(target.kind, target.id, userId);
        await adminAudit.record(
            req.user.sub,
            `${target.kind}.owner_transferred`,
            `${SPACE_LABELS[target.kind]} ${space.title} — مالک جدید: ${user.full_name}`,
            { kind: target.kind, spaceId: target.id, userId, previousOwnerId: space.owner_id }
        );
        return res.status(200).json({ transferred: true });
    } catch (err) {
        if (handleConsoleError(err, res)) return undefined;
        throw err;
    }
}

async function setSpaceMemberRole(req, res) {
    const target = parseSpace(req);
    const userId = parseId(req.params.userId);
    const { role } = req.body || {};
    if (!target || !userId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    try {
        const result = await adminConsole.setSpaceMemberRole(target.kind, target.id, userId, role);
        if (result.changed) {
            await adminAudit.record(
                req.user.sub,
                `${target.kind}.member_role_changed`,
                `${result.name} ← ${adminConsole.MEMBER_ROLE_LABELS[role]} — ${SPACE_LABELS[target.kind]} ${result.space.title}`,
                { kind: target.kind, spaceId: target.id, userId, role }
            );
        }
        return res.status(200).json({ role });
    } catch (err) {
        if (handleConsoleError(err, res)) return undefined;
        throw err;
    }
}

async function listConversations(req, res) {
    return res.status(200).json({ conversations: await adminConsole.listConversations() });
}

async function conversationTranscript(req, res) {
    const conversationId = parseId(req.params.id);
    if (!conversationId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const before = req.query.before ? parseId(req.query.before) : null;
    const conversation = await adminConsole.findConversation(conversationId);
    if (!conversation) {
        return res.status(404).json({ error: 'CONVERSATION_NOT_FOUND' });
    }
    const messages = await adminConsole.conversationTranscript(conversationId, { before });
    if (!before) {
        await adminAudit.record(
            req.user.sub,
            'oversight.viewed',
            `${conversation.direct ? 'گفتگوی خصوصی' : 'گفتگو'} ${conversation.name}`,
            { kind: 'conversation', conversationId }
        );
    }
    return res.status(200).json({
        space: { kind: 'conversation', name: conversation.name, archived: false },
        messages
    });
}

module.exports = {
    overview,
    badges,
    listApprovals,
    transferSpaceOwner,
    setSpaceMemberRole,
    listConversations,
    conversationTranscript,
    listUsers,
    archiveUser,
    getSettings,
    updateSettings,
    deleteTag,
    listSpaces,
    createSpace,
    setSpaceArchived,
    spaceMembers,
    addSpaceMember,
    removeSpaceMember,
    spaceTranscript,
    listSessions,
    revokeSession,
    listAudit,
    exportAudit,
    listBackups,
    runBackup,
    downloadBackup,
    listArchives,
    listReminders
};
