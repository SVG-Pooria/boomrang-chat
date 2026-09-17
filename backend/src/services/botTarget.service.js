const db = require('../config/database');
const conversationService = require('./conversation.service');
const channelCoreService = require('./channelCore.service');
const groupCoreService = require('./groupCore.service');
const messageService = require('./message.service');
const channelMessageService = require('./channelMessage.service');
const groupMessageService = require('./groupMessage.service');
const notifier = require('../socket/notifier');
const permissionMatrix = require('./channelGroupPermission.service');

const TARGET_TYPES = ['conversation', 'channel', 'group'];

class TargetUnavailableError extends Error {
    constructor(targetType, targetId) {
        super(`BOT_TARGET_UNAVAILABLE: ${targetType}#${targetId}`);
        this.code = 'TARGET_UNAVAILABLE';
        this.targetType = targetType;
        this.targetId = targetId;
    }
}

class InvalidTargetTypeError extends Error {
    constructor(targetType) {
        super(`BOT_TARGET_INVALID_TYPE: ${targetType}`);
        this.code = 'INVALID_TARGET_TYPE';
        this.targetType = targetType;
    }
}

function assertKnownTargetType(targetType) {
    if (!TARGET_TYPES.includes(targetType)) {
        throw new InvalidTargetTypeError(targetType);
    }
}

async function resolveTarget(targetType, targetId) {
    assertKnownTargetType(targetType);
    const id = Number(targetId);
    if (!Number.isInteger(id)) {
        throw new TargetUnavailableError(targetType, targetId);
    }

    let record = null;
    if (targetType === 'conversation') {
        record = await conversationService.getConversationById(id);
    } else if (targetType === 'channel') {
        record = await channelCoreService.getChannelById(id);
    } else if (targetType === 'group') {
        record = await groupCoreService.getGroupById(id);
    }

    if (!record) {
        throw new TargetUnavailableError(targetType, id);
    }
    return record;
}

async function ensureBotMembership(targetType, targetId, botUserId) {
    assertKnownTargetType(targetType);
    const id = Number(targetId);

    if (targetType === 'conversation') {
        await db.query(
            `INSERT INTO conversation_members (conversation_id, user_id, role_in_conv)
             VALUES ($1, $2, 'can_post')
             ON CONFLICT (conversation_id, user_id) DO UPDATE SET role_in_conv = 'can_post'`,
            [id, botUserId]
        );
        return;
    }

    if (targetType === 'channel') {
        await channelCoreService.addChannelMember(id, botUserId, 'member', permissionMatrix.BOT_CHANNEL_PERMISSIONS);
        return;
    }

    await groupCoreService.addGroupMember(id, botUserId, 'member', permissionMatrix.BOT_GROUP_PERMISSIONS);
}

async function createMessageForTarget(targetType, targetId, { senderId, body, type, fileId }) {
    assertKnownTargetType(targetType);
    const id = Number(targetId);

    if (targetType === 'conversation') {
        let message = await messageService.createMessage({
            conversationId: id,
            senderId,
            body,
            type: type || 'text'
        });
        if (fileId) {
            message = await messageService.attachFile(message.id, fileId);
        }
        return message;
    }

    if (targetType === 'channel') {
        return channelMessageService.createChannelMessage({
            channelId: id,
            senderId,
            body,
            type: type || 'text',
            fileId: fileId || null
        });
    }

    return groupMessageService.createGroupMessage({
        groupId: id,
        senderId,
        body,
        type: type || 'text',
        fileId: fileId || null
    });
}

function deliverMessage(targetType, targetId, message) {
    assertKnownTargetType(targetType);
    const id = Number(targetId);

    if (targetType === 'conversation') {
        notifier.notifyConversationMessageCreated(id, message);
        return;
    }
    if (targetType === 'channel') {
        notifier.notifyChannelMessageCreated(id, message);
        return;
    }
    notifier.notifyGroupMessageCreated(id, message);
}

async function sendToTarget({ targetType, targetId, senderId, body, type, fileId }) {
    const target = await resolveTarget(targetType, targetId);
    await ensureBotMembership(targetType, targetId, senderId);
    const message = await createMessageForTarget(targetType, targetId, { senderId, body, type, fileId });
    deliverMessage(targetType, targetId, message);
    return { target, message };
}

module.exports = {
    TARGET_TYPES,
    TargetUnavailableError,
    InvalidTargetTypeError,
    resolveTarget,
    ensureBotMembership,
    createMessageForTarget,
    deliverMessage,
    sendToTarget
};
