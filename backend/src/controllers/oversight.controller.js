const fsPromises = require('fs/promises');
const oversightService = require('../services/oversight.service');
const conversationService = require('../services/conversation.service');
const fileUploadService = require('../services/fileUpload.service');
const backupMirror = require('../config/backupMirror');
const activityLogService = require('../services/activityLog.service');
const adminAudit = require('../services/adminAudit.service');
const forwardQueue = require('../queue/forwardQueue');

async function getPresence(req, res) {
    const presence = await oversightService.listPresence();
    return res.status(200).json({ presence });
}

async function listConversations(req, res) {
    const { search, type } = req.query;
    const conversations = await oversightService.listAllConversations({ search, type });
    return res.status(200).json({ conversations });
}

async function getConversationMessages(req, res) {
    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId)) {
        return res.status(400).json({ error: 'INVALID_CONVERSATION_ID' });
    }
    const conversation = await conversationService.getConversationById(conversationId);
    if (!conversation) {
        return res.status(404).json({ error: 'CONVERSATION_NOT_FOUND' });
    }
    const messages = await oversightService.getConversationMessages(conversationId, req.query);
    await activityLogService.log(req.user.sub, 'admin.oversight.conversation_viewed', { conversationId });
    return res.status(200).json({ conversation, messages });
}

async function listFiles(req, res) {
    const { senderId, receiverId, dateFrom, dateTo, mimeType, mode } = req.query;
    const files = await oversightService.listFiles({
        senderId: senderId ? Number(senderId) : null,
        receiverId: receiverId ? Number(receiverId) : null,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        mimeType: mimeType || null,
        mode: mode || null
    });
    return res.status(200).json({ files });
}

async function downloadFile(req, res) {
    const fileId = Number(req.params.fileId);
    const variant = req.params.variant;
    const column = fileUploadService.VARIANT_COLUMNS[variant];
    if (!Number.isInteger(fileId) || !column) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const fileRecord = await fileUploadService.getFileById(fileId);
    if (!fileRecord) {
        return res.status(404).json({ error: 'FILE_NOT_FOUND' });
    }
    const filePath = fileRecord[column];
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
    await adminAudit.record(req.user.sub, 'oversight.file_downloaded', fileRecord.original_name || `فایل ${fileId}`, {
        fileId,
        variant
    });
    require('../utils/fileResponse.util').applySafeFileHeaders(res, fileRecord.mime_type);
    return res.sendFile(filePath, (err) => {
        if (err && !res.headersSent) {
            res.status(404).json({ error: 'FILE_NOT_FOUND' });
        }
    });
}

async function deleteFile(req, res) {
    const fileId = Number(req.params.fileId);
    if (!Number.isInteger(fileId)) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const result = await fileUploadService.deleteFileCompletely(fileId);
    if (!result) {
        return res.status(404).json({ error: 'FILE_NOT_FOUND' });
    }
    await activityLogService.log(req.user.sub, 'admin.oversight.file_deleted', {
        fileId,
        fileName: result.fileName,
        conversationId: result.conversationId,
        messageId: result.messageId,
        originalSenderId: result.senderId,
        backupCopyRemoved: result.backupCopyRemoved,
        backupMirrorConfigured: result.backupMirrorConfigured
    });
    return res.status(200).json({
        deleted: true,
        backupCopyRemoved: result.backupCopyRemoved,
        backupMirrorConfigured: result.backupMirrorConfigured
    });
}

async function getForwardQueueStatus(req, res) {
    const depths = await forwardQueue.getQueueDepths();
    return res.status(200).json({ queue: depths });
}

module.exports = {
    getPresence,
    listConversations,
    getConversationMessages,
    listFiles,
    downloadFile,
    deleteFile,
    getForwardQueueStatus
};
