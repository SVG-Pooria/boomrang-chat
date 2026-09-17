const fileUploadService = require('./fileUpload.service');
const { resolveMessageType } = require('../utils/attachmentClassifier');

const TARGET_TABLE_BY_TYPE = {
    conversation: 'messages',
    channel: 'channel_messages',
    group: 'group_messages'
};

async function storeAttachment({ reminderId, tempPath, originalName, mimeType, sizeBytes, requestedMode, actorId }) {
    const stored = await fileUploadService.storeUpload({
        tempPath,
        originalName,
        mimeType,
        sizeBytes,
        requestedMode,
        actorId
    });

    if (stored.status !== 'clean') {
        return stored;
    }

    const fileRecord = await fileUploadService.createFileRecord({
        messageId: reminderId,
        storedResult: stored,
        targetTable: 'bot_reminders'
    });

    return {
        status: 'clean',
        fileRecord,
        messageType: resolveMessageType(stored.mimeType),
        mode: stored.mode
    };
}

async function cloneForDelivery({ attachmentFileId, targetType, messageId }) {
    if (!attachmentFileId) {
        return null;
    }
    const targetTable = TARGET_TABLE_BY_TYPE[targetType];
    if (!targetTable) {
        throw new Error(`INVALID_TARGET_TYPE_FOR_ATTACHMENT: ${targetType}`);
    }
    return fileUploadService.cloneFileForOwner({
        sourceFileId: attachmentFileId,
        ownerId: messageId,
        targetTable
    });
}

async function removeAttachment(attachmentFileId) {
    if (!attachmentFileId) {
        return false;
    }
    return fileUploadService.deleteReminderAttachment(attachmentFileId);
}

module.exports = {
    resolveMessageType,
    storeAttachment,
    cloneForDelivery,
    removeAttachment
};
