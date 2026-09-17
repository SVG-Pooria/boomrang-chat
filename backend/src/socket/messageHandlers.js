const conversationService = require('../services/conversation.service');
const messageService = require('../services/message.service');
const permissionService = require('../services/permission.service');
const cooldownService = require('../services/cooldown.service');
const activityLogService = require('../services/activityLog.service');
const adminAudit = require('../services/adminAudit.service');
const systemSettings = require('../services/systemSettings.service');
const messageFlowService = require('../services/messageFlow.service');
const forwardOriginService = require('../services/forwardOrigin.service');
const groupCoreService = require('../services/groupCore.service');
const channelCoreService = require('../services/channelCore.service');
const summaryService = require('../services/summary.service');

function conversationRoom(conversationId) {
    return `conversation:${conversationId}`;
}

function channelRoom(channelId) {
    return `channel:${channelId}`;
}

function groupRoom(groupId) {
    return `group:${groupId}`;
}

function userRoom(userId) {
    return `user:${userId}`;
}

function roleRoom(role) {
    return `role:${role}`;
}

async function resolveConversation(io, senderUser, payload) {
    return messageFlowService.resolveConversation(senderUser, payload, async (conversation, targetUser) => {
        await io.in(userRoom(targetUser.sub)).socketsJoin(conversationRoom(conversation.id));
    });
}

function registerMessageHandlers(io, socket) {
    socket.on('message:send', async (payload, ack) => {
        const respond = typeof ack === 'function' ? ack : () => {};
        try {
            if (socket.user.is_locked) {
                return respond({ error: 'SCREEN_LOCKED' });
            }
            const body = String((payload && payload.body) || '').trim();
            if (!body) {
                return respond({ error: 'EMPTY_MESSAGE' });
            }
            const conversation = await resolveConversation(io, socket.user, payload || {});
            const cooldown = await cooldownService.checkAndApply(socket.user);
            if (!cooldown.allowed) {
                return respond({ error: 'COOLDOWN_ACTIVE', retryAfterMs: cooldown.retryAfterMs });
            }

            let forwardOrigin;
            const rawOrigin = payload && payload.forwardOrigin;
            if (rawOrigin && rawOrigin.originType && rawOrigin.originId && rawOrigin.originMessageId) {
                const resolved = await forwardOriginService.resolveForwardOrigin({
                    originType: rawOrigin.originType,
                    originId: rawOrigin.originId,
                    originMessageId: rawOrigin.originMessageId,
                    viewerUserId: socket.user.sub
                });
                if (!resolved.allowed) {
                    return respond({ error: 'FORWARD_ORIGIN_NOT_ACCESSIBLE' });
                }
                forwardOrigin = {
                    originType: resolved.originType,
                    originRefId: resolved.originId,
                    originMessageId: resolved.originMessageId,
                    originSenderId: resolved.originSenderId
                };
            }

            const message = await messageService.createMessage({
                conversationId: conversation.id,
                senderId: socket.user.sub,
                body,
                type: (payload && payload.type) || 'text',
                replyToId: payload && payload.replyToId,
                isConfidential: Boolean(payload && payload.isConfidential),
                forwardOrigin
            });
            socket.join(conversationRoom(conversation.id));
            io.to(conversationRoom(conversation.id)).emit('message:new', {
                conversationId: conversation.id,
                message
            });
            summaryService.touch('conversation', conversation.id);
            return respond({ message, conversationId: conversation.id });
        } catch (err) {
            if (err instanceof permissionService.PermissionError) {
                return respond({ error: err.code });
            }
            return respond({ error: 'INTERNAL_ERROR' });
        }
    });

    async function resolveTypingRoom(payload) {
        const targetType = (payload && payload.targetType) || 'direct';
        const targetId = Number(payload && (payload.targetId || payload.conversationId));
        if (!Number.isInteger(targetId) || targetId <= 0) {
            return null;
        }
        if (targetType === 'group') {
            const membership = await groupCoreService.getGroupMembership(targetId, socket.user.sub);
            return membership ? groupRoom(targetId) : null;
        }
        if (targetType === 'channel') {
            const membership = await channelCoreService.getChannelMembership(targetId, socket.user.sub);
            return membership ? channelRoom(targetId) : null;
        }
        const membership = await conversationService.getMembership(targetId, socket.user.sub);
        return membership ? conversationRoom(targetId) : null;
    }

    async function emitTyping(payload, typing) {
        const room = await resolveTypingRoom(payload);
        if (!room) {
            return;
        }
        const targetType = (payload && payload.targetType) || 'direct';
        const targetId = Number(payload.targetId || payload.conversationId);
        socket.to(room).emit('typing', {
            targetType,
            targetId,
            conversationId: targetType === 'direct' ? targetId : undefined,
            userId: socket.user.sub,
            userName: socket.user.fullName,
            typing
        });
    }

    socket.on('typing:start', (payload) => emitTyping(payload || {}, true));

    socket.on('typing:stop', (payload) => emitTyping(payload || {}, false));

    socket.on('message:edit', async (payload, ack) => {
        const respond = typeof ack === 'function' ? ack : () => {};
        try {
            const conversationId = payload && payload.conversationId;
            const messageId = payload && payload.messageId;
            const body = String((payload && payload.body) || '').trim();
            if (!conversationId || !messageId || !body) {
                return respond({ error: 'INVALID_PAYLOAD' });
            }
            const membership = await conversationService.getMembership(conversationId, socket.user.sub);
            if (!membership) {
                return respond({ error: 'NOT_A_MEMBER' });
            }
            const message = await messageService.editMessage(messageId, socket.user.sub, body, Number(conversationId));
            if (!message) {
                return respond({ error: 'NOT_EDITABLE' });
            }
            await activityLogService.log(socket.user.sub, 'message.edited', { conversationId, messageId });
            io.to(conversationRoom(conversationId)).emit('message:edited', { conversationId, message });
            summaryService.touch('conversation', conversationId, { force: true });
            return respond({ success: true, message });
        } catch (err) {
            return respond({ error: 'INTERNAL_ERROR' });
        }
    });

    socket.on('message:delete', async (payload, ack) => {
        const respond = typeof ack === 'function' ? ack : () => {};
        try {
            const conversationId = payload && payload.conversationId;
            const messageId = payload && payload.messageId;
            const forEveryone = Boolean(payload && payload.forEveryone);
            if (!conversationId || !messageId) {
                return respond({ error: 'INVALID_PAYLOAD' });
            }
            const membership = await conversationService.getMembership(conversationId, socket.user.sub);
            if (!membership) {
                return respond({ error: 'NOT_A_MEMBER' });
            }

            if (!forEveryone) {
                await messageService.hideMessageForUser(messageId, socket.user.sub);
                await activityLogService.log(socket.user.sub, 'message.deleted_for_me', { conversationId, messageId });

                io.to(userRoom(socket.user.sub)).emit('message:hidden', { conversationId, messageId });
                summaryService.touch('conversation', conversationId, { force: true });
                return respond({ success: true, forEveryone: false });
            }

            const result = await messageService.deleteMessageForEveryone(messageId, socket.user.sub, conversationId);
            if (result.error === 'NOT_FOUND') {
                return respond({ error: 'NOT_FOUND' });
            }
            if (result.error === 'FORBIDDEN') {
                return respond({ error: 'NOT_MESSAGE_OWNER' });
            }
            await activityLogService.log(socket.user.sub, 'message.deleted_for_everyone', {
                conversationId,
                messageId,
                hadFile: result.hadFile,
                backupCopyRemoved: result.backupCopyRemoved
            });
            await adminAudit.recordMessageDeletion(socket.user.sub, 'conversation', conversationId, messageId);
            io.to(conversationRoom(conversationId)).emit('message:deleted', { conversationId, messageId });
            summaryService.touch('conversation', conversationId, { force: true });
            return respond({ success: true, forEveryone: true });
        } catch (err) {
            return respond({ error: 'INTERNAL_ERROR' });
        }
    });

    socket.on('message:read', async (payload, ack) => {
        const respond = typeof ack === 'function' ? ack : () => {};
        const conversationId = payload && payload.conversationId;
        const messageId = payload && payload.messageId;
        if (!conversationId || !messageId) {
            return respond({ error: 'INVALID_PAYLOAD' });
        }
        const membership = await conversationService.getMembership(conversationId, socket.user.sub);
        if (!membership) {
            return respond({ error: 'NOT_A_MEMBER' });
        }
        await messageService.markRead(conversationId, socket.user.sub, messageId);
        await activityLogService.log(socket.user.sub, 'conversation.read', { conversationId, messageId });
        if (await systemSettings.getFlag('readReceiptsEnabled')) {
            socket.to(conversationRoom(conversationId)).emit('message:read', {
                conversationId,
                userId: socket.user.sub,
                messageId
            });
        }
        return respond({ success: true });
    });
}

module.exports = { registerMessageHandlers, conversationRoom, channelRoom, groupRoom, userRoom, roleRoom };
