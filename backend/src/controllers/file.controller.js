const fsPromises = require('fs/promises');
const db = require('../config/database');
const backupMirror = require('../config/backupMirror');
const fileUploadService = require('../services/fileUpload.service');
const conversationService = require('../services/conversation.service');
const groupCoreService = require('../services/groupCore.service');
const channelCoreService = require('../services/channelCore.service');
const taskService = require('../services/task.service');
const activityLogService = require('../services/activityLog.service');
const { applySafeFileHeaders } = require('../utils/fileResponse.util');

const VARIANT_COLUMNS = fileUploadService.VARIANT_COLUMNS;

async function findOwningConversationId(fileId) {
    const result = await db.query(
        `SELECT m.conversation_id FROM messages m
         JOIN message_files f ON f.id = m.file_id
         WHERE f.id = $1`,
        [fileId]
    );
    return result.rows[0] ? result.rows[0].conversation_id : null;
}

async function hasDirectAccess(fileRecord, userId) {
    const conversationId = await findOwningConversationId(fileRecord.id);
    if (!conversationId) {
        return false;
    }
    const membership = await conversationService.getMembership(conversationId, userId);
    return Boolean(membership);
}

async function hasGroupAccess(fileRecord, userId) {
    const result = await db.query('SELECT group_id FROM group_messages WHERE id = $1', [fileRecord.group_message_id]);
    const groupId = result.rows[0] ? result.rows[0].group_id : null;
    if (!groupId) {
        return false;
    }
    const group = await groupCoreService.getGroupById(groupId);
    if (!group) {
        return false;
    }
    const membership = await groupCoreService.getGroupMembership(groupId, userId);
    return Boolean(membership) || group.visibility === 'public';
}

async function hasChannelAccess(fileRecord, userId) {
    const result = await db.query('SELECT channel_id FROM channel_messages WHERE id = $1', [fileRecord.channel_message_id]);
    const channelId = result.rows[0] ? result.rows[0].channel_id : null;
    if (!channelId) {
        return false;
    }
    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        return false;
    }
    const membership = await channelCoreService.getChannelMembership(channelId, userId);
    return Boolean(membership) || channel.visibility === 'public';
}

async function hasTaskReportAccess(fileRecord, viewer) {
    const result = await db.query('SELECT task_id FROM task_reports WHERE id = $1', [
        fileRecord.task_report_id
    ]);
    const taskId = result.rows[0] ? result.rows[0].task_id : null;
    return Boolean(taskId) && taskService.canViewTask(taskId, viewer);
}

async function hasFileAccess(fileRecord, viewer) {
    if (fileRecord.task_report_id) {
        return hasTaskReportAccess(fileRecord, viewer);
    }
    if (fileRecord.group_message_id) {
        return hasGroupAccess(fileRecord, viewer.sub);
    }
    if (fileRecord.channel_message_id) {
        return hasChannelAccess(fileRecord, viewer.sub);
    }
    return hasDirectAccess(fileRecord, viewer.sub);
}

async function downloadFile(req, res) {
    const fileId = Number(req.params.fileId);
    const variant = req.params.variant;
    if (!Number.isInteger(fileId) || !VARIANT_COLUMNS[variant]) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }

    const fileRecord = await fileUploadService.getFileById(fileId);
    if (!fileRecord) {
        return res.status(404).json({ error: 'FILE_NOT_FOUND' });
    }
    if (fileRecord.av_scan_status === 'infected') {
        return res.status(410).json({ error: 'FILE_UNAVAILABLE' });
    }

    const allowed = await hasFileAccess(fileRecord, req.user);
    if (!allowed) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }

    const filePath = fileRecord[VARIANT_COLUMNS[variant]];
    if (!filePath) {
        return res.status(404).json({ error: 'VARIANT_NOT_AVAILABLE' });
    }

    try {
        await fsPromises.access(filePath);
    } catch (err) {
        const restored = await backupMirror.restoreFromMirror(filePath);
        if (!restored) {
            return res.status(404).json({ error: 'FILE_NOT_FOUND' });
        }
    }

    await activityLogService.log(req.user.sub, 'file.downloaded', { fileId, variant });
    applySafeFileHeaders(res, fileRecord.mime_type);
    return res.sendFile(filePath, (err) => {
        if (err && !res.headersSent) {
            res.status(404).json({ error: 'FILE_NOT_FOUND' });
        }
    });
}

module.exports = { downloadFile };
