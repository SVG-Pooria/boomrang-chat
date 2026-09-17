const fs = require('fs/promises');
const passwordService = require('../services/password.service');
const activityLogService = require('../services/activityLog.service');
const adminAudit = require('../services/adminAudit.service');
const adminConsole = require('../services/adminConsole.service');
const sessionService = require('../services/session.service');
const userService = require('../services/user.service');
const fileUploadService = require('../services/fileUpload.service');
const cooldownService = require('../services/cooldown.service');
const tagService = require('../services/tag.service');
const botService = require('../services/bot.service');
const botAttachmentService = require('../services/botAttachment.service');
const conversationService = require('../services/conversation.service');
const userExportService = require('../services/userExport.service');
const channelCoreService = require('../services/channelCore.service');
const groupCoreService = require('../services/groupCore.service');
const permissionMatrix = require('../services/channelGroupPermission.service');
const format = require('../utils/persianFormat.util');
const path = require('path');

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TARGET_TYPES = ['conversation', 'channel', 'group'];
const ALLOWED_ATTACHMENT_MODES = ['compressed', 'file'];
const BYTES_PER_MB = 1024 * 1024;
const TARGET_NOT_FOUND_ERRORS = {
    conversation: 'CONVERSATION_NOT_FOUND',
    channel: 'CHANNEL_NOT_FOUND',
    group: 'GROUP_NOT_FOUND'
};

async function discardUploadedFile(req) {
    if (req.file && req.file.path) {
        await fs.unlink(req.file.path).catch(() => {});
    }
}

async function resolveReminderTarget(targetType, targetId) {
    if (targetType === 'channel') {
        return channelCoreService.getChannelById(targetId);
    }
    if (targetType === 'group') {
        return groupCoreService.getGroupById(targetId);
    }
    return conversationService.getConversationById(targetId);
}

async function assertCanTargetReminder(user, targetType, targetId) {
    if (user.role === 'super_admin') {
        return;
    }
    if (targetType === 'channel') {
        const membership = await channelCoreService.getChannelMembership(targetId, user.sub);
        permissionMatrix.assertCan(membership, 'post');
        return;
    }
    if (targetType === 'group') {
        const membership = await groupCoreService.getGroupMembership(targetId, user.sub);
        permissionMatrix.assertCan(membership, 'send_messages');
        return;
    }
}

function toTargetOption(targetType) {
    return (row) => ({
        targetType,
        id: row.id,
        title: row.title || (row.is_system_channel ? 'اطلاعیه‌ها' : `${row.id}#`)
    });
}

function ownsReminder(user, reminder) {
    return user.role === 'super_admin' || reminder.created_by === user.sub;
}

function bytesLabel(bytes) {
    if (bytes === null) {
        return 'نامحدود';
    }
    return `${format.toPersianDigits(Math.round((bytes / BYTES_PER_MB) * 100) / 100)} مگابایت`;
}

function parseRepeatDays(raw) {
    if (raw === undefined || raw === null || raw === '') {
        return { days: null };
    }
    let values = raw;
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            values = Array.isArray(parsed) ? parsed : [parsed];
        } catch (err) {
            values = raw.split(',');
        }
    }
    if (!Array.isArray(values)) {
        return { error: 'INVALID_REPEAT_DAYS' };
    }
    const days = [...new Set(values.map(Number))];
    if (days.length === 0 || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
        return { error: 'INVALID_REPEAT_DAYS' };
    }
    return { days: days.length === 7 ? null : days.sort((a, b) => a - b) };
}

async function viewPassword(req, res) {
    const targetUserId = Number(req.params.id);
    if (!Number.isInteger(targetUserId)) {
        return res.status(400).json({ error: 'INVALID_USER_ID' });
    }
    if (!(await sessionService.isRecentlyReauthenticated(req.user.sessionId))) {
        return res.status(403).json({ error: 'REAUTH_REQUIRED' });
    }
    const target = await userService.getUserById(targetUserId);
    if (!target) {
        return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }
    let plainPassword;
    try {
        plainPassword = await passwordService.adminViewPassword(req.user.sub, targetUserId);
    } catch (err) {
        if (err.message === 'PASSWORD_UNDECRYPTABLE') {

            return res.status(409).json({ error: 'PASSWORD_UNDECRYPTABLE' });
        }
        throw err;
    }
    if (plainPassword === null) {
        return res.status(404).json({ error: 'PASSWORD_NOT_SET' });
    }
    await adminAudit.record(req.user.sub, 'password.viewed', target.full_name, { targetUserId });
    return res.status(200).json({ password: plainPassword });
}

async function resetPassword(req, res) {
    const targetUserId = Number(req.params.id);
    const { newPassword } = req.body || {};
    if (!Number.isInteger(targetUserId)) {
        return res.status(400).json({ error: 'INVALID_USER_ID' });
    }
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'WEAK_PASSWORD' });
    }
    if (!(await sessionService.isRecentlyReauthenticated(req.user.sessionId))) {
        return res.status(403).json({ error: 'REAUTH_REQUIRED' });
    }
    const target = await userService.getUserById(targetUserId);
    if (!target || target.is_bot) {
        return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }
    await passwordService.adminResetPassword(req.user.sub, targetUserId, newPassword);
    if (targetUserId !== req.user.sub) {
        await sessionService.revokeForUser(targetUserId, req.user.sub);
    }
    await adminAudit.record(req.user.sub, 'password.reset', target.full_name, { targetUserId });
    return res.status(200).json({ success: true });
}

async function getMaxFileSize(req, res) {
    const maxBytes = await fileUploadService.getMaxFileSizeBytes();
    return res.status(200).json({ maxFileSizeBytes: maxBytes, unlimited: maxBytes === null });
}

async function setMaxFileSize(req, res) {
    const { maxFileSizeBytes, unlimited } = req.body || {};
    let valueToStore = null;
    if (!unlimited) {
        const parsed = Number(maxFileSizeBytes);
        if (!Number.isInteger(parsed) || parsed <= 0) {
            return res.status(400).json({ error: 'INVALID_FILE_SIZE' });
        }
        valueToStore = parsed;
    }
    const previous = await fileUploadService.getMaxFileSizeBytes();
    await fileUploadService.setMaxFileSizeBytes(valueToStore);
    if (previous !== valueToStore) {
        await adminAudit.record(req.user.sub, 'settings.max_file_size', `${bytesLabel(previous)} ← ${bytesLabel(valueToStore)}`);
    }
    return res.status(200).json({ maxFileSizeBytes: valueToStore, unlimited: valueToStore === null });
}

async function getMessageCooldown(req, res) {
    const seconds = await cooldownService.getCooldownSeconds();
    return res.status(200).json({ cooldownSeconds: seconds, exemptRoles: cooldownService.EXEMPT_ROLES });
}

async function setMessageCooldown(req, res) {
    const { cooldownSeconds } = req.body || {};
    const parsed = Number(cooldownSeconds);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return res.status(400).json({ error: 'INVALID_COOLDOWN_SECONDS' });
    }
    const previous = await cooldownService.getCooldownSeconds();
    const stored = await cooldownService.setCooldownSeconds(parsed);
    if (previous !== stored) {
        await adminAudit.record(
            req.user.sub,
            'settings.message_cooldown',
            `${format.toPersianDigits(previous)} ثانیه ← ${format.toPersianDigits(stored)} ثانیه`
        );
    }
    return res.status(200).json({ cooldownSeconds: stored, exemptRoles: cooldownService.EXEMPT_ROLES });
}

async function listTags(req, res) {
    const tags = await adminConsole.listTags();
    return res.status(200).json({ tags });
}

async function createTag(req, res) {
    const { name } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'INVALID_TAG_NAME' });
    }
    try {
        const tag = await tagService.createTag(name.trim());
        await adminAudit.record(req.user.sub, 'tag.created', tag.name, { tagId: tag.id });
        return res.status(201).json({ tag: { id: tag.id, name: tag.name, members: 0 } });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'TAG_NAME_EXISTS' });
        }
        throw err;
    }
}

async function getActivityLog(req, res) {
    const limit = Number(req.query.limit) || 100;
    const logs = await activityLogService.list(limit);
    return res.status(200).json({ logs });
}

function toPublicArchive(row) {
    return {
        id: row.id,
        targetUserId: row.target_user_id_snapshot,
        targetFullName: row.target_full_name_snapshot,
        targetPhone: row.target_phone_snapshot,
        targetRole: row.target_role_snapshot,
        targetTag: row.target_tag_snapshot,
        sizeBytes: row.size_bytes,
        fileCount: row.file_count,
        deletedAt: row.deleted_at,
        purgeAfter: row.purge_after,
        createdBy: row.created_by,
        createdAt: row.created_at
    };
}

async function listExports(req, res) {
    const { search } = req.query;
    const archives = await userExportService.listArchives({ search: search || null });
    return res.status(200).json({ archives: archives.map(toPublicArchive) });
}

async function downloadExport(req, res) {
    const archiveId = Number(req.params.id);
    if (!Number.isInteger(archiveId)) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const archive = await userExportService.getArchiveById(archiveId);
    if (!archive) {
        return res.status(404).json({ error: 'ARCHIVE_NOT_FOUND' });
    }
    if (archive.purged_at) {
        return res.status(410).json({ error: 'ARCHIVE_PURGED' });
    }
    await adminAudit.record(req.user.sub, 'archive.downloaded', archive.target_full_name_snapshot, { archiveId });
    return res.download(archive.file_path, path.basename(archive.file_path), (err) => {
        if (err && !res.headersSent) {
            res.status(404).json({ error: 'FILE_NOT_FOUND' });
        }
    });
}

async function getBotSettings(req, res) {
    const settings = await botService.getSettings();
    return res.status(200).json(settings);
}

async function updateBotSettings(req, res) {
    const { dailySummaryEnabled, dailySummaryTime, targetConversationId } = req.body || {};
    if (dailySummaryEnabled !== undefined && typeof dailySummaryEnabled !== 'boolean') {
        return res.status(400).json({ error: 'INVALID_ENABLED_FLAG' });
    }
    if (dailySummaryTime !== undefined && !TIME_PATTERN.test(dailySummaryTime)) {
        return res.status(400).json({ error: 'INVALID_TIME_FORMAT' });
    }
    if (targetConversationId) {
        const conversation = await conversationService.getConversationById(Number(targetConversationId));
        if (!conversation) {
            return res.status(404).json({ error: 'CONVERSATION_NOT_FOUND' });
        }
    }
    const settings = await botService.updateSettings({
        dailySummaryEnabled,
        dailySummaryTime,
        targetConversationId: targetConversationId !== undefined ? Number(targetConversationId) || null : undefined
    });
    await activityLogService.log(req.user.sub, 'admin.bot.settings.updated', settings);
    return res.status(200).json(settings);
}

async function listBotReminders(req, res) {
    const reminders = (await botService.listReminders()).filter((reminder) => ownsReminder(req.user, reminder));
    return res.status(200).json({ reminders });
}

async function createBotReminder(req, res) {
    const body = req.body || {};
    const { title, message, scheduledAt, repeatDailyAt } = body;
    const targetType = TARGET_TYPES.includes(body.targetType) ? body.targetType : 'conversation';
    const rawTargetId = body.targetId !== undefined && body.targetId !== '' ? body.targetId : body.conversationId;
    const text = typeof message === 'string' ? message.trim() : '';

    if (!title || typeof title !== 'string' || !title.trim()) {
        await discardUploadedFile(req);
        return res.status(400).json({ error: 'INVALID_TITLE' });
    }
    if (!scheduledAt && !repeatDailyAt) {
        await discardUploadedFile(req);
        return res.status(400).json({ error: 'SCHEDULE_REQUIRED' });
    }
    if (repeatDailyAt && !TIME_PATTERN.test(repeatDailyAt)) {
        await discardUploadedFile(req);
        return res.status(400).json({ error: 'INVALID_TIME_FORMAT' });
    }
    const repeat = parseRepeatDays(body.repeatDays);
    if (repeat.error) {
        await discardUploadedFile(req);
        return res.status(400).json({ error: repeat.error });
    }
    let scheduledDate = null;
    if (scheduledAt) {
        scheduledDate = new Date(scheduledAt);
        if (Number.isNaN(scheduledDate.getTime())) {
            await discardUploadedFile(req);
            return res.status(400).json({ error: 'INVALID_SCHEDULED_AT' });
        }
    }

    let targetId = null;
    if (rawTargetId !== undefined && rawTargetId !== null && rawTargetId !== '') {
        targetId = Number(rawTargetId);
        if (!Number.isInteger(targetId)) {
            await discardUploadedFile(req);
            return res.status(400).json({ error: 'INVALID_TARGET_ID' });
        }
    } else if (targetType !== 'conversation') {
        await discardUploadedFile(req);
        return res.status(400).json({ error: 'TARGET_REQUIRED' });
    }

    if (targetId) {
        const targetRecord = await resolveReminderTarget(targetType, targetId);
        if (!targetRecord) {
            await discardUploadedFile(req);
            return res.status(404).json({ error: TARGET_NOT_FOUND_ERRORS[targetType] });
        }
        try {
            await assertCanTargetReminder(req.user, targetType, targetId);
        } catch (err) {
            await discardUploadedFile(req);
            if (err instanceof permissionMatrix.PermissionError) {
                return res.status(403).json({ error: err.code });
            }
            throw err;
        }
    }

    const reminder = await botService.createReminder({
        title: title.trim(),
        message: text,
        targetType,
        targetId,
        scheduledAt: scheduledDate,
        repeatDailyAt: repeatDailyAt || null,
        repeatDays: repeatDailyAt ? repeat.days : null,
        createdBy: req.user.sub
    });

    let finalReminder = reminder;
    if (req.file) {
        const requestedMode = ALLOWED_ATTACHMENT_MODES.includes(body.mode) ? body.mode : 'file';
        const stored = await botAttachmentService.storeAttachment({
            reminderId: reminder.id,
            tempPath: req.file.path,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            sizeBytes: req.file.size,
            requestedMode,
            actorId: req.user.sub
        });

        if (stored.status === 'infected') {
            await botService.deleteReminder(reminder.id);
            return res.status(422).json({ error: 'INFECTED_FILE' });
        }
        if (stored.status === 'scan_error') {
            await botService.deleteReminder(reminder.id);
            return res.status(503).json({ error: 'SCAN_UNAVAILABLE' });
        }

        finalReminder = await botService.updateReminderAttachment(reminder.id, {
            attachmentFileId: stored.fileRecord.id,
            messageType: stored.messageType
        });
    }

    await adminAudit.record(
        req.user.sub,
        'reminder.created',
        `${finalReminder.title} — ${botService.scheduleLabel(finalReminder)}`,
        { reminderId: finalReminder.id, targetType, targetId, hasAttachment: Boolean(req.file) }
    );
    return res.status(201).json({ reminder: finalReminder });
}

async function updateBotReminder(req, res) {
    const reminderId = Number(req.params.id);
    if (!Number.isInteger(reminderId)) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const existing = await botService.getReminderById(reminderId);
    if (!existing) {
        return res.status(404).json({ error: 'REMINDER_NOT_FOUND' });
    }
    if (!ownsReminder(req.user, existing)) {
        return res.status(403).json({ error: 'REMINDER_NOT_OWNED' });
    }

    const body = req.body || {};
    const { title, message, scheduledAt, repeatDailyAt } = body;
    const targetType = TARGET_TYPES.includes(body.targetType) ? body.targetType : 'conversation';
    const rawTargetId = body.targetId !== undefined && body.targetId !== '' ? body.targetId : body.conversationId;
    const text = typeof message === 'string' ? message.trim() : '';

    if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'INVALID_TITLE' });
    }
    if (!scheduledAt && !repeatDailyAt) {
        return res.status(400).json({ error: 'SCHEDULE_REQUIRED' });
    }
    if (repeatDailyAt && !TIME_PATTERN.test(repeatDailyAt)) {
        return res.status(400).json({ error: 'INVALID_TIME_FORMAT' });
    }
    const repeat = parseRepeatDays(body.repeatDays);
    if (repeat.error) {
        return res.status(400).json({ error: repeat.error });
    }
    let scheduledDate = null;
    if (scheduledAt) {
        scheduledDate = new Date(scheduledAt);
        if (Number.isNaN(scheduledDate.getTime())) {
            return res.status(400).json({ error: 'INVALID_SCHEDULED_AT' });
        }
    }

    let targetId = null;
    if (rawTargetId !== undefined && rawTargetId !== null && rawTargetId !== '') {
        targetId = Number(rawTargetId);
        if (!Number.isInteger(targetId)) {
            return res.status(400).json({ error: 'INVALID_TARGET_ID' });
        }
    } else if (targetType !== 'conversation') {
        return res.status(400).json({ error: 'TARGET_REQUIRED' });
    }

    if (targetId) {
        const targetRecord = await resolveReminderTarget(targetType, targetId);
        if (!targetRecord) {
            return res.status(404).json({ error: TARGET_NOT_FOUND_ERRORS[targetType] });
        }
        try {
            await assertCanTargetReminder(req.user, targetType, targetId);
        } catch (err) {
            if (err instanceof permissionMatrix.PermissionError) {
                return res.status(403).json({ error: err.code });
            }
            throw err;
        }
    }

    const updated = await botService.updateReminder(reminderId, {
        title: title.trim(),
        message: text,
        targetType,
        targetId,
        scheduledAt: scheduledDate,
        repeatDailyAt: repeatDailyAt || null,
        repeatDays: repeatDailyAt ? repeat.days : null
    });

    await adminAudit.record(
        req.user.sub,
        'reminder.updated',
        `${updated.title} — ${botService.scheduleLabel(updated)}`,
        { reminderId, targetType, targetId }
    );
    return res.status(200).json({ reminder: updated });
}

async function updateBotReminderAttachment(req, res) {
    const reminderId = Number(req.params.id);
    if (!Number.isInteger(reminderId)) {
        await discardUploadedFile(req);
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const reminder = await botService.getReminderById(reminderId);
    if (!reminder) {
        await discardUploadedFile(req);
        return res.status(404).json({ error: 'REMINDER_NOT_FOUND' });
    }
    if (!ownsReminder(req.user, reminder)) {
        await discardUploadedFile(req);
        return res.status(403).json({ error: 'REMINDER_NOT_OWNED' });
    }

    const body = req.body || {};
    const shouldRemove = !req.file && (body.remove === true || body.remove === 'true');

    if (!req.file && !shouldRemove) {
        return res.status(400).json({ error: 'NOTHING_TO_UPDATE' });
    }

    if (shouldRemove) {
        if (reminder.attachment_file_id) {
            await botAttachmentService.removeAttachment(reminder.attachment_file_id);
        }
        const updated = await botService.updateReminderAttachment(reminderId, {
            attachmentFileId: null,
            messageType: 'text'
        });
        await activityLogService.log(req.user.sub, 'admin.bot.reminder.attachment_removed', { reminderId });
        return res.status(200).json({ reminder: updated });
    }

    const requestedMode = ALLOWED_ATTACHMENT_MODES.includes(body.mode) ? body.mode : 'file';
    const stored = await botAttachmentService.storeAttachment({
        reminderId,
        tempPath: req.file.path,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        requestedMode,
        actorId: req.user.sub
    });

    if (stored.status === 'infected') {
        return res.status(422).json({ error: 'INFECTED_FILE' });
    }
    if (stored.status === 'scan_error') {
        return res.status(503).json({ error: 'SCAN_UNAVAILABLE' });
    }

    if (reminder.attachment_file_id) {
        await botAttachmentService.removeAttachment(reminder.attachment_file_id);
    }

    const updated = await botService.updateReminderAttachment(reminderId, {
        attachmentFileId: stored.fileRecord.id,
        messageType: stored.messageType
    });

    await activityLogService.log(req.user.sub, 'admin.bot.reminder.attachment_updated', {
        reminderId,
        fileId: stored.fileRecord.id,
        mode: stored.mode
    });

    return res.status(200).json({ reminder: updated });
}

async function listBotTargets(req, res) {
    const { type } = req.query;
    if (type && !TARGET_TYPES.includes(type)) {
        return res.status(400).json({ error: 'INVALID_TARGET_TYPE' });
    }

    const [legacyChannels, channels, groups] = await Promise.all([
        !type || type === 'conversation' ? conversationService.listLegacyChannels() : Promise.resolve([]),
        !type || type === 'channel' ? channelCoreService.listAllChannels() : Promise.resolve([]),
        !type || type === 'group' ? groupCoreService.listAllGroups() : Promise.resolve([])
    ]);

    return res.status(200).json({
        conversations: legacyChannels.map(toTargetOption('conversation')),
        channels: channels.map(toTargetOption('channel')),
        groups: groups.map(toTargetOption('group'))
    });
}

async function setBotReminderActive(req, res) {
    const reminderId = Number(req.params.id);
    const { isActive } = req.body || {};
    if (!Number.isInteger(reminderId) || typeof isActive !== 'boolean') {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const existing = await botService.getReminderById(reminderId);
    if (!existing) {
        return res.status(404).json({ error: 'REMINDER_NOT_FOUND' });
    }
    if (!ownsReminder(req.user, existing)) {
        return res.status(403).json({ error: 'REMINDER_NOT_OWNED' });
    }
    const reminder = await botService.setReminderActive(reminderId, isActive);
    await adminAudit.record(req.user.sub, isActive ? 'reminder.resumed' : 'reminder.paused', reminder.title, {
        reminderId
    });
    return res.status(200).json({ reminder });
}

async function deleteBotReminder(req, res) {
    const reminderId = Number(req.params.id);
    if (!Number.isInteger(reminderId)) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const reminder = await botService.getReminderById(reminderId);
    if (!reminder) {
        return res.status(404).json({ error: 'REMINDER_NOT_FOUND' });
    }
    if (!ownsReminder(req.user, reminder)) {
        return res.status(403).json({ error: 'REMINDER_NOT_OWNED' });
    }
    if (reminder.attachment_file_id) {
        await botAttachmentService.removeAttachment(reminder.attachment_file_id);
    }
    await botService.deleteReminder(reminderId);
    await adminAudit.record(req.user.sub, 'reminder.deleted', reminder.title, { reminderId });
    return res.status(200).json({ success: true });
}

async function listBotReminderDeliveries(req, res) {
    const reminderId = Number(req.params.id);
    if (!Number.isInteger(reminderId)) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const reminder = await botService.getReminderById(reminderId);
    if (!reminder) {
        return res.status(404).json({ error: 'REMINDER_NOT_FOUND' });
    }
    if (!ownsReminder(req.user, reminder)) {
        return res.status(403).json({ error: 'REMINDER_NOT_OWNED' });
    }
    const limit = Number(req.query.limit) || 100;
    const deliveries = await botService.listReminderDeliveries(reminderId, limit);
    return res.status(200).json({ deliveries });
}

async function listChannelsAndGroups(req, res) {
    const [channels, groups] = await Promise.all([
        channelCoreService.listAllChannels(),
        groupCoreService.listAllGroups()
    ]);
    return res.status(200).json({ channels, groups });
}

module.exports = {
    viewPassword,
    resetPassword,
    getMaxFileSize,
    setMaxFileSize,
    getMessageCooldown,
    setMessageCooldown,
    listTags,
    createTag,
    getActivityLog,
    listExports,
    downloadExport,
    getBotSettings,
    updateBotSettings,
    listBotReminders,
    createBotReminder,
    updateBotReminder,
    updateBotReminderAttachment,
    setBotReminderActive,
    deleteBotReminder,
    listBotTargets,
    listBotReminderDeliveries,
    listChannelsAndGroups
};
