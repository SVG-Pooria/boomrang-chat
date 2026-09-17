const fs = require('fs/promises');
const messageFlowService = require('../services/messageFlow.service');
const permissionService = require('../services/permission.service');
const cooldownService = require('../services/cooldown.service');
const messageService = require('../services/message.service');
const groupMessageService = require('../services/groupMessage.service');
const channelMessageService = require('../services/channelMessage.service');
const groupCoreService = require('../services/groupCore.service');
const channelCoreService = require('../services/channelCore.service');
const permissionMatrix = require('../services/channelGroupPermission.service');
const fileUploadService = require('../services/fileUpload.service');
const activityLogService = require('../services/activityLog.service');
const summaryService = require('../services/summary.service');
const complianceService = require('../services/compliance.service');
const notifier = require('../socket/notifier');
const db = require('../config/database');
const forwardOriginService = require('../services/forwardOrigin.service');
const { resolveMessageType } = require('../utils/attachmentClassifier');

const ALLOWED_MODES = ['compressed', 'file'];
const ALLOWED_TARGET_TYPES = ['direct', 'group', 'channel'];

const CAPTION_MAX_LENGTH = 2000;

function sanitizeCaption(rawCaption) {
    if (typeof rawCaption !== 'string') {
        return null;
    }
    const trimmed = rawCaption.trim();
    if (!trimmed) {
        return null;
    }
    return trimmed.slice(0, CAPTION_MAX_LENGTH);
}

function conversationRoom(conversationId) {
    return `conversation:${conversationId}`;
}

function userRoom(userId) {
    return `user:${userId}`;
}

async function joinSocketsToConversation(conversation, targetUser) {
    const io = notifier.getIo();
    if (!io) {
        return;
    }
    await io.in(userRoom(targetUser.sub)).socketsJoin(conversationRoom(conversation.id));
}

async function resolveUploadForwardOrigin(req) {
    const body = req.body || {};
    if (!body.forwardOrigin) {
        return undefined;
    }
    let rawOrigin;
    try {
        rawOrigin = typeof body.forwardOrigin === 'string' ? JSON.parse(body.forwardOrigin) : body.forwardOrigin;
    } catch (err) {
        return { error: 'INVALID_FORWARD_ORIGIN' };
    }
    if (!rawOrigin || !rawOrigin.originType || !rawOrigin.originId || !rawOrigin.originMessageId) {
        return undefined;
    }
    const resolved = await forwardOriginService.resolveForwardOrigin({
        originType: rawOrigin.originType,
        originId: rawOrigin.originId,
        originMessageId: rawOrigin.originMessageId,
        viewerUserId: req.user.sub
    });
    if (!resolved.allowed) {
        return { error: 'FORWARD_ORIGIN_NOT_ACCESSIBLE' };
    }
    return {
        forwardOrigin: {
            originType: resolved.originType,
            originRefId: resolved.originId,
            originMessageId: resolved.originMessageId,
            originSenderId: resolved.originSenderId
        }
    };
}

async function uploadFile(req, res) {
    const body = req.body || {};
    const requestedMode = ALLOWED_MODES.includes(body.mode) ? body.mode : 'file';
    const targetType = ALLOWED_TARGET_TYPES.includes(body.targetType) ? body.targetType : 'direct';

    const originResult = await resolveUploadForwardOrigin(req);
    if (originResult && originResult.error) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(403).json({ error: originResult.error });
    }
    const forwardOrigin = originResult && originResult.forwardOrigin;

    if (targetType === 'group') {
        return uploadToGroup(req, res, requestedMode, forwardOrigin);
    }
    if (targetType === 'channel') {
        return uploadToChannel(req, res, requestedMode, forwardOrigin);
    }
    return uploadToDirect(req, res, requestedMode, forwardOrigin);
}

async function uploadToDirect(req, res, requestedMode, forwardOrigin) {
    const body = req.body || {};
    const payload = {
        conversationId: body.conversationId ? Number(body.conversationId) : undefined,
        targetUserId: body.targetUserId ? Number(body.targetUserId) : undefined
    };

    let conversation;
    try {
        conversation = await messageFlowService.resolveConversation(req.user, payload, joinSocketsToConversation);
    } catch (err) {
        await fs.unlink(req.file.path).catch(() => {});
        if (err instanceof permissionService.PermissionError) {
            return res.status(403).json({ error: err.code });
        }
        throw err;
    }

    const cooldown = await cooldownService.checkAndApply(req.user);
    if (!cooldown.allowed) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(429).json({ error: 'COOLDOWN_ACTIVE', retryAfterMs: cooldown.retryAfterMs });
    }

    const stored = await fileUploadService.storeUpload({
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

    const messageType = resolveMessageType(stored.mimeType);
    const message = await messageService.createMessage({
        conversationId: conversation.id,
        senderId: req.user.sub,
        body: sanitizeCaption(body.caption),
        type: messageType,
        replyToId: body.replyToId ? Number(body.replyToId) : null,
        forwardOrigin
    });

    const fileRecord = await fileUploadService.createFileRecord({ messageId: message.id, storedResult: stored });
    const finalMessage = await messageService.attachFile(message.id, fileRecord.id);

    await activityLogService.log(req.user.sub, 'message.file_sent', {
        conversationId: conversation.id,
        fileId: fileRecord.id,
        mode: stored.mode,
        sizeBytes: stored.sizeBytes
    });

    const io = notifier.getIo();
    if (io) {
        io.to(conversationRoom(conversation.id)).emit('message:new', {
            conversationId: conversation.id,
            message: { ...finalMessage, file: fileRecord }
        });
    }
    summaryService.touch('conversation', conversation.id, { force: true });

    return res.status(201).json({ message: finalMessage, file: fileRecord, conversationId: conversation.id });
}

async function uploadToGroup(req, res, requestedMode, forwardOrigin) {
    const body = req.body || {};
    const groupId = Number(body.targetId);
    if (!groupId) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: 'INVALID_TARGET_ID' });
    }
    const group = await groupCoreService.getGroupById(groupId);
    if (!group) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
    }
    const membership = await groupCoreService.getGroupMembership(groupId, req.user.sub);
    try {
        permissionMatrix.assertCan(membership, 'send_messages');
    } catch (err) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(403).json({ error: err.code || 'FORBIDDEN' });
    }

    const cooldown = await cooldownService.checkAndApply(req.user);
    if (!cooldown.allowed) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(429).json({ error: 'COOLDOWN_ACTIVE', retryAfterMs: cooldown.retryAfterMs });
    }

    const stored = await fileUploadService.storeUpload({
        tempPath: req.file.path,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        requestedMode,
        actorId: req.user.sub
    });
    if (stored.status === 'infected') return res.status(422).json({ error: 'INFECTED_FILE' });
    if (stored.status === 'scan_error') return res.status(503).json({ error: 'SCAN_UNAVAILABLE' });

    const messageType = resolveMessageType(stored.mimeType);
    const message = await groupMessageService.createGroupMessage({
        groupId,
        senderId: req.user.sub,
        body: sanitizeCaption(body.caption),
        type: messageType,
        replyToId: body.replyToId ? Number(body.replyToId) : null,
        forwardOrigin
    });

    const fileRecord = await fileUploadService.createFileRecord({
        messageId: message.id,
        storedResult: stored,
        targetTable: 'group_messages'
    });
    await db.query('UPDATE group_messages SET file_id = $1 WHERE id = $2', [fileRecord.id, message.id]);
    const finalMessage = { ...message, file_id: fileRecord.id };

    await activityLogService.log(req.user.sub, 'group.message.file_sent', {
        groupId,
        fileId: fileRecord.id,
        mode: stored.mode,
        sizeBytes: stored.sizeBytes
    });

    notifier.notifyGroupMessageCreated(groupId, { ...finalMessage, file: fileRecord });
    await complianceService.recordTeamActivity(
        req.user.sub,
        'file.shared',
        `فایل «${fileRecord.original_name || 'پیوست'}» را در گاوصندوق ${group.title} گذاشت`,
        { groupId, fileId: fileRecord.id }
    );
    summaryService.touch('group', groupId, { force: true });

    return res.status(201).json({ message: finalMessage, file: fileRecord, groupId });
}

async function uploadToChannel(req, res, requestedMode, forwardOrigin) {
    const body = req.body || {};
    const channelId = Number(body.targetId);
    if (!channelId) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: 'INVALID_TARGET_ID' });
    }
    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }
    const membership = await channelCoreService.getChannelMembership(channelId, req.user.sub);
    try {
        permissionMatrix.assertCan(membership, 'post');
    } catch (err) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(403).json({ error: err.code || 'FORBIDDEN' });
    }

    const cooldown = await cooldownService.checkAndApply(req.user);
    if (!cooldown.allowed) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(429).json({ error: 'COOLDOWN_ACTIVE', retryAfterMs: cooldown.retryAfterMs });
    }

    const stored = await fileUploadService.storeUpload({
        tempPath: req.file.path,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        requestedMode,
        actorId: req.user.sub
    });
    if (stored.status === 'infected') return res.status(422).json({ error: 'INFECTED_FILE' });
    if (stored.status === 'scan_error') return res.status(503).json({ error: 'SCAN_UNAVAILABLE' });

    const messageType = resolveMessageType(stored.mimeType);
    const message = await channelMessageService.createChannelMessage({
        channelId,
        senderId: req.user.sub,
        body: sanitizeCaption(body.caption),
        type: messageType,
        forwardOrigin
    });

    const fileRecord = await fileUploadService.createFileRecord({
        messageId: message.id,
        storedResult: stored,
        targetTable: 'channel_messages'
    });
    await db.query('UPDATE channel_messages SET file_id = $1 WHERE id = $2', [fileRecord.id, message.id]);
    const finalMessage = { ...message, file_id: fileRecord.id };

    await activityLogService.log(req.user.sub, 'channel.message.file_sent', {
        channelId,
        fileId: fileRecord.id,
        mode: stored.mode,
        sizeBytes: stored.sizeBytes
    });

    notifier.notifyChannelMessageCreated(channelId, { ...finalMessage, file: fileRecord });
    await complianceService.recordTeamActivity(
        req.user.sub,
        'file.shared',
        `فایل «${fileRecord.original_name || 'پیوست'}» را در گاوصندوق #${channel.title} گذاشت`,
        { channelId, fileId: fileRecord.id }
    );
    summaryService.touch('channel', channelId, { force: true });

    return res.status(201).json({ message: finalMessage, file: fileRecord, channelId });
}

module.exports = { uploadFile };