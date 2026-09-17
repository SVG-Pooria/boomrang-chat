const db = require('../config/database');
const conversationService = require('../services/conversation.service');
const groupCoreService = require('../services/groupCore.service');
const channelCoreService = require('../services/channelCore.service');
const messageService = require('../services/message.service');
const groupMessageService = require('../services/groupMessage.service');
const channelMessageService = require('../services/channelMessage.service');
const forwardOriginService = require('../services/forwardOrigin.service');
const permissionService = require('../services/permission.service');
const permissionMatrix = require('../services/channelGroupPermission.service');
const fileUploadService = require('../services/fileUpload.service');
const summaryService = require('../services/summary.service');
const cooldownService = require('../services/cooldown.service');
const activityLogService = require('../services/activityLog.service');
const notifier = require('../socket/notifier');

const MAX_DESTINATIONS = 10;
const ORIGIN_TYPES = ['direct', 'group', 'channel'];

function conversationRoom(conversationId) {
    return `conversation:${conversationId}`;
}

function normalizeDestinations(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const seen = new Set();
    const list = [];
    for (const item of raw) {
        const type = item && item.type;
        const id = Number(item && item.id);
        if (!ORIGIN_TYPES.includes(type) || !Number.isInteger(id)) {
            continue;
        }
        const key = `${type}:${id}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        list.push({ type, id });
    }
    return list.slice(0, MAX_DESTINATIONS);
}

function forwardedType(originMessage) {
    return originMessage.file_id ? originMessage.type : 'text';
}

async function forwardToDirect(viewer, conversationId, origin, caption) {
    const conversation = await conversationService.getConversationById(conversationId);
    if (!conversation) {
        return { error: 'CONVERSATION_NOT_FOUND' };
    }
    const membership = await conversationService.getMembership(conversationId, viewer.sub);
    const otherUser = await conversationService.otherDirectUser(conversation, viewer.sub);
    permissionService.assertCanPostInExistingConversation(viewer, conversation, membership, otherUser);

    const message = await messageService.createMessage({
        conversationId,
        senderId: viewer.sub,
        body: caption,
        type: forwardedType(origin.originMessage),
        forwardOrigin: origin.meta
    });

    let file = null;
    if (origin.originMessage.file_id) {
        file = await fileUploadService.cloneFileForOwner({
            sourceFileId: origin.originMessage.file_id,
            ownerId: message.id,
            targetTable: 'messages'
        });
        if (file) {
            await messageService.attachFile(message.id, file.id);
        }
    }

    const finalMessage = { ...message, ...(file ? { file_id: file.id, file } : {}) };
    const io = notifier.getIo();
    if (io) {
        io.to(conversationRoom(conversationId)).emit('message:new', {
            conversationId,
            message: finalMessage
        });
    }
    summaryService.touch('conversation', conversationId, { force: true });
    return { message: finalMessage };
}

async function forwardToGroup(viewer, groupId, origin, caption) {
    const group = await groupCoreService.getGroupById(groupId);
    if (!group) {
        return { error: 'GROUP_NOT_FOUND' };
    }
    const membership = await groupCoreService.getGroupMembership(groupId, viewer.sub);
    permissionMatrix.assertCan(membership, 'send_messages');

    const message = await groupMessageService.createGroupMessage({
        groupId,
        senderId: viewer.sub,
        body: caption,
        type: forwardedType(origin.originMessage),
        forwardOrigin: origin.meta
    });

    let file = null;
    if (origin.originMessage.file_id) {
        file = await fileUploadService.cloneFileForOwner({
            sourceFileId: origin.originMessage.file_id,
            ownerId: message.id,
            targetTable: 'group_messages'
        });
        if (file) {
            await db.query('UPDATE group_messages SET file_id = $1 WHERE id = $2', [file.id, message.id]);
        }
    }

    const finalMessage = { ...message, ...(file ? { file_id: file.id, file } : {}) };
    notifier.notifyGroupMessageCreated(groupId, finalMessage);
    summaryService.touch('group', groupId, { force: true });
    return { message: finalMessage };
}

async function forwardToChannel(viewer, channelId, origin, caption) {
    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        return { error: 'CHANNEL_NOT_FOUND' };
    }
    const membership = await channelCoreService.getChannelMembership(channelId, viewer.sub);
    permissionMatrix.assertCan(membership, 'post');

    const message = await channelMessageService.createChannelMessage({
        channelId,
        senderId: viewer.sub,
        body: caption,
        type: forwardedType(origin.originMessage),
        forwardOrigin: origin.meta
    });

    let file = null;
    if (origin.originMessage.file_id) {
        file = await fileUploadService.cloneFileForOwner({
            sourceFileId: origin.originMessage.file_id,
            ownerId: message.id,
            targetTable: 'channel_messages'
        });
        if (file) {
            await db.query('UPDATE channel_messages SET file_id = $1 WHERE id = $2', [file.id, message.id]);
        }
    }

    const finalMessage = { ...message, ...(file ? { file_id: file.id, file } : {}) };
    notifier.notifyChannelMessageCreated(channelId, finalMessage);
    summaryService.touch('channel', channelId, { force: true });
    return { message: finalMessage };
}

async function forwardMessage(req, res) {
    const body = req.body || {};
    const destinations = normalizeDestinations(body.destinations);
    if (!destinations.length) {
        return res.status(400).json({ error: 'DESTINATION_REQUIRED' });
    }

    const resolved = await forwardOriginService.resolveForwardOrigin({
        originType: body.originType,
        originId: Number(body.originId),
        originMessageId: Number(body.originMessageId),
        viewerUserId: req.user.sub
    });
    if (!resolved.allowed) {
        return res.status(403).json({ error: 'FORWARD_ORIGIN_NOT_ACCESSIBLE' });
    }

    const cooldown = await cooldownService.checkAndApply(req.user);
    if (!cooldown.allowed) {
        return res.status(429).json({ error: 'COOLDOWN_ACTIVE', retryAfterMs: cooldown.retryAfterMs });
    }

    const origin = {
        originMessage: resolved.originMessage,
        meta: {
            originType: resolved.originType,
            originRefId: resolved.originId,
            originMessageId: resolved.originMessageId,
            originSenderId: resolved.originSenderId
        }
    };
    const caption = resolved.originMessage.body || '';

    const delivered = [];
    const failed = [];
    for (const destination of destinations) {
        try {
            let result;
            if (destination.type === 'direct') {
                result = await forwardToDirect(req.user, destination.id, origin, caption);
            } else if (destination.type === 'group') {
                result = await forwardToGroup(req.user, destination.id, origin, caption);
            } else {
                result = await forwardToChannel(req.user, destination.id, origin, caption);
            }
            if (result.error) {
                failed.push({ ...destination, error: result.error });
            } else {
                delivered.push(destination);
            }
        } catch (err) {
            if (err instanceof permissionService.PermissionError || err.code) {
                failed.push({ ...destination, error: err.code || 'FORBIDDEN' });
            } else {
                throw err;
            }
        }
    }

    if (!delivered.length) {
        return res.status(403).json({ error: failed[0] ? failed[0].error : 'FORWARD_FAILED', failed });
    }

    await activityLogService.log(req.user.sub, 'message.forwarded', {
        originType: resolved.originType,
        originId: resolved.originId,
        originMessageId: resolved.originMessageId,
        delivered: delivered.length
    });

    return res.status(201).json({ delivered, failed });
}

module.exports = { forwardMessage };
