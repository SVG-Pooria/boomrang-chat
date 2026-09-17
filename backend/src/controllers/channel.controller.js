const asyncHandler = require('../utils/asyncHandler');
const channelCoreService = require('../services/channelCore.service');
const channelMessageService = require('../services/channelMessage.service');
const conversationService = require('../services/conversation.service');
const permissionMatrix = require('../services/channelGroupPermission.service');
const summaryService = require('../services/summary.service');
const cooldownService = require('../services/cooldown.service');
const systemSettings = require('../services/systemSettings.service');
const chatHistory = require('../services/chatHistory.service');
const capabilityService = require('../services/capability.service');
const adminAudit = require('../services/adminAudit.service');
const notifier = require('../socket/notifier');
const activityLogService = require('../services/activityLog.service');
const forwardOriginService = require('../services/forwardOrigin.service');
const attachmentClassifier = require('../utils/attachmentClassifier');

const VISIBILITIES = ['public', 'private'];

const SUPER_ADMIN_MEMBERSHIP = Object.freeze({ role: 'owner', permissions: permissionMatrix.OWNER_PERMISSIONS });

function parseId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function serializeMember(row) {
    if (!row) {
        return null;
    }
    return {
        userId: row.user_id,
        fullName: row.full_name,
        phone: row.phone,
        role: row.role,
        permissions: row.permissions,
        joinedAt: row.joined_at,
        messageCount: Number(row.message_count) || 0
    };
}

function handlePermissionError(err, res) {
    if (err instanceof permissionMatrix.PermissionError) {
        res.status(err.code === 'NOT_A_MEMBER' ? 403 : 403).json({ error: err.code });
        return true;
    }
    return false;
}

async function requireMembership(channelId, userId) {
    return channelCoreService.getChannelMembership(channelId, userId);
}

async function requireActorMembership(channelId, req) {
    if (req.user.role === 'super_admin') {
        return SUPER_ADMIN_MEMBERSHIP;
    }
    return requireMembership(channelId, req.user.sub);
}

function withAvatarUrl(channel) {
    if (!channel) {
        return channel;
    }
    const { avatar, ...rest } = channel;
    const version = channel.updated_at ? new Date(channel.updated_at).getTime() : 0;
    return { ...rest, avatarUrl: avatar ? `/api/avatars/channel/${channel.id}?v=${version}` : null };
}

function sanitizeChannel(channel, viewerRole) {
    if (!channel) {
        return channel;
    }
    const withUrl = withAvatarUrl(channel);
    if (viewerRole === 'super_admin') {
        return withUrl;
    }
    const { created_by, ...rest } = withUrl;
    return rest;
}

async function createChannel(req, res) {
    if (!capabilityService.isLeader(req.user.role)) {
        return res.status(403).json({ error: 'ONLY_LEADERS_CAN_CREATE_CHANNELS' });
    }
    const { title, description, avatar, visibility } = req.body || {};
    const managerId = req.user.role === 'super_admin' ? (req.body || {}).managerId : null;
    const trimmedTitle = String(title || '').trim();
    if (!trimmedTitle) {
        return res.status(400).json({ error: 'TITLE_REQUIRED' });
    }
    if (visibility && !VISIBILITIES.includes(visibility)) {
        return res.status(400).json({ error: 'INVALID_VISIBILITY' });
    }
    let ownerId = req.user.sub;
    if (managerId !== undefined && managerId !== null && managerId !== '') {
        const parsedManagerId = parseId(managerId);
        if (!parsedManagerId) {
            return res.status(400).json({ error: 'INVALID_MANAGER_ID' });
        }
        const manager = await conversationService.findUserById(parsedManagerId);
        if (!manager || !manager.is_active) {
            return res.status(404).json({ error: 'MANAGER_NOT_FOUND' });
        }
        ownerId = parsedManagerId;
    }
    const channel = await channelCoreService.createChannel({
        title: trimmedTitle,
        description,
        avatar,
        visibility,
        ownerId,
        createdBy: req.user.sub
    });
    await notifier.joinUserToChannelRoom(channel.id, ownerId);
    await activityLogService.log(req.user.sub, 'channel.created', {
        channelId: channel.id,
        title: channel.title,
        managerId: ownerId
    });
    return res.status(201).json({ channel: sanitizeChannel(channel, req.user.role) });
}

async function transferManager(req, res) {
    const channelId = parseId(req.params.id);
    if (!channelId) {
        return res.status(400).json({ error: 'INVALID_CHANNEL_ID' });
    }
    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }
    const newManagerId = parseId((req.body || {}).userId);
    if (!newManagerId) {
        return res.status(400).json({ error: 'USER_ID_REQUIRED' });
    }
    const manager = await conversationService.findUserById(newManagerId);
    if (!manager || !manager.is_active) {
        return res.status(404).json({ error: 'MANAGER_NOT_FOUND' });
    }
    const updated = await channelCoreService.transferChannelOwnership(channelId, newManagerId);
    await notifier.joinUserToChannelRoom(channelId, newManagerId);
    await activityLogService.log(req.user.sub, 'channel.manager_transferred', {
        channelId,
        newManagerId
    });
    return res.status(200).json({ channel: sanitizeChannel(updated, req.user.role) });
}

async function listChannels(req, res) {
    const channels = await channelCoreService.listChannelsForUser(req.user.sub);
    const summaries = await channelMessageService.getChannelSummaries(
        channels.map((channel) => channel.id),
        req.user.sub
    );
    return res.status(200).json({
        channels: channels.map((channel) => ({
            ...sanitizeChannel(channel, req.user.role),
            lastMessage: summaries[channel.id].lastMessage,
            unreadCount: summaries[channel.id].unreadCount
        }))
    });
}

async function markRead(req, res) {
    const channelId = parseId(req.params.id);
    if (!channelId) {
        return res.status(400).json({ error: 'INVALID_CHANNEL_ID' });
    }
    const membership = await requireActorMembership(channelId, req);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    const messageId = parseId((req.body || {}).messageId);
    if (!messageId) {
        return res.status(400).json({ error: 'INVALID_MESSAGE_ID' });
    }
    await channelMessageService.markChannelRead(channelId, req.user.sub, messageId);
    if (await systemSettings.getFlag('readReceiptsEnabled')) {
        notifier.notifyChannelRead(channelId, req.user.sub, messageId);
    }
    return res.status(200).json({ success: true });
}

async function getChannel(req, res) {
    const channelId = parseId(req.params.id);
    if (!channelId) {
        return res.status(400).json({ error: 'INVALID_CHANNEL_ID' });
    }
    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }
    const membership = await requireActorMembership(channelId, req);
    if (!membership && channel.visibility !== 'public') {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    return res.status(200).json({ channel: sanitizeChannel(channel, req.user.role), membership: membership || null });
}

async function updateChannel(req, res) {
    const channelId = parseId(req.params.id);
    if (!channelId) {
        return res.status(400).json({ error: 'INVALID_CHANNEL_ID' });
    }
    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }
    const membership = await requireActorMembership(channelId, req);
    try {
        permissionMatrix.assertCan(membership, 'edit_info');
    } catch (err) {
        if (handlePermissionError(err, res)) return undefined;
        throw err;
    }
    if (req.body && req.body.visibility && !VISIBILITIES.includes(req.body.visibility)) {
        return res.status(400).json({ error: 'INVALID_VISIBILITY' });
    }
    const updated = await channelCoreService.updateChannel(channelId, req.body || {});
    return res.status(200).json({ channel: sanitizeChannel(updated, req.user.role) });
}

async function deleteChannel(req, res) {
    const channelId = parseId(req.params.id);
    if (!channelId) {
        return res.status(400).json({ error: 'INVALID_CHANNEL_ID' });
    }
    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }
    const membership = await requireActorMembership(channelId, req);
    if (!membership || membership.role !== 'owner') {
        return res.status(403).json({ error: 'ONLY_OWNER_CAN_DELETE' });
    }
    const { removedLink } = await channelCoreService.archiveChannel(channelId, req.user.sub);
    await activityLogService.log(req.user.sub, 'channel.archived', { channelId, title: channel.title });
    if (removedLink) {
        notifier.notifyChannelGroupUnlinked(channelId, removedLink.group_id);
        await activityLogService.log(req.user.sub, 'channel_group.auto_unlinked', {
            channelId,
            groupId: removedLink.group_id,
            reason: 'channel_deleted'
        });
    }
    return res.status(200).json({ archived: true });
}

async function listMembers(req, res) {
    const channelId = parseId(req.params.id);
    if (!channelId) {
        return res.status(400).json({ error: 'INVALID_CHANNEL_ID' });
    }
    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }
    const membership = await requireActorMembership(channelId, req);
    if (!membership && channel.visibility !== 'public') {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    const members = await channelCoreService.listChannelMembers(channelId);
    return res.status(200).json({ members: members.map(serializeMember) });
}

async function addMember(req, res) {
    const channelId = parseId(req.params.id);
    if (!channelId) {
        return res.status(400).json({ error: 'INVALID_CHANNEL_ID' });
    }
    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }

    const targetUserId = parseId((req.body || {}).userId) || req.user.sub;
    const isSelfJoin = targetUserId === req.user.sub;
    const actorMembership = await requireActorMembership(channelId, req);

    if (isSelfJoin) {
        if (actorMembership) {
            return res.status(409).json({ error: 'ALREADY_A_MEMBER' });
        }
        if (channel.visibility !== 'public') {
            return res.status(403).json({ error: 'CHANNEL_IS_PRIVATE' });
        }
    } else {
        try {
            permissionMatrix.assertCan(actorMembership, 'manage_members');
        } catch (err) {
            if (handlePermissionError(err, res)) return undefined;
            throw err;
        }
        const targetUser = await conversationService.findUserById(targetUserId);
        if (!targetUser) {
            return res.status(404).json({ error: 'USER_NOT_FOUND' });
        }
    }

    const member = await channelCoreService.addChannelMember(channelId, targetUserId, 'member');
    await notifier.joinUserToChannelRoom(channelId, targetUserId);
    return res.status(201).json({ member: serializeMember(member) });
}

async function removeMember(req, res) {
    const channelId = parseId(req.params.id);
    const targetUserId = parseId(req.params.userId);
    if (!channelId || !targetUserId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }
    const actorMembership = await requireActorMembership(channelId, req);
    const targetMembership = await requireMembership(channelId, targetUserId);

    const isLeavingSelf = targetUserId === req.user.sub;
    if (!isLeavingSelf) {
        try {
            permissionMatrix.assertCanRemoveMember(actorMembership, targetMembership, {
                isSuperAdmin: req.user.role === 'super_admin'
            });
        } catch (err) {
            if (handlePermissionError(err, res)) return undefined;
            throw err;
        }
    } else if (targetMembership && targetMembership.role === 'owner') {
        return res.status(409).json({ error: 'OWNER_CANNOT_LEAVE' });
    }

    await channelCoreService.removeChannelMember(channelId, targetUserId);
    return res.status(200).json({ removed: true });
}

async function setMemberRole(req, res) {
    const channelId = parseId(req.params.id);
    const targetUserId = parseId(req.params.userId);
    if (!channelId || !targetUserId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }

    const { role, permissions } = req.body || {};
    if (role && !permissionMatrix.ROLES.includes(role)) {
        return res.status(400).json({ error: 'INVALID_ROLE' });
    }

    const actorMembership = await requireActorMembership(channelId, req);
    const targetMembership = await requireMembership(channelId, targetUserId);
    if (!targetMembership) {
        return res.status(404).json({ error: 'MEMBER_NOT_FOUND' });
    }

    try {
        permissionMatrix.assertCanManageMember(actorMembership, targetMembership, {
            newRole: role,
            newPermissions: permissions
        });
    } catch (err) {
        if (handlePermissionError(err, res)) return undefined;
        throw err;
    }

    const updated = await channelCoreService.setChannelMemberRole(
        channelId,
        targetUserId,
        role || targetMembership.role,
        permissions
    );
    if (role && role !== targetMembership.role) {
        await activityLogService.log(req.user.sub, 'channel.member.role_changed', {
            channelId,
            userId: targetUserId,
            oldRole: targetMembership.role,
            newRole: role
        });
    }
    return res.status(200).json({ member: serializeMember(updated) });
}

async function createMessage(req, res) {
    const channelId = parseId(req.params.id);
    if (!channelId) {
        return res.status(400).json({ error: 'INVALID_CHANNEL_ID' });
    }
    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }
    const membership = await requireActorMembership(channelId, req);
    try {
        permissionMatrix.assertCan(membership, 'post');
    } catch (err) {
        if (handlePermissionError(err, res)) return undefined;
        throw err;
    }
    const body = String((req.body || {}).body || '').trim();
    const { type, fileId, forwardOrigin: rawOrigin, isConfidential } = req.body || {};
    if (!body && !fileId) {
        return res.status(400).json({ error: 'EMPTY_MESSAGE' });
    }

    let forwardOrigin;
    if (rawOrigin && rawOrigin.originType && rawOrigin.originId && rawOrigin.originMessageId) {
        const resolved = await forwardOriginService.resolveForwardOrigin({
            originType: rawOrigin.originType,
            originId: rawOrigin.originId,
            originMessageId: rawOrigin.originMessageId,
            viewerUserId: req.user.sub
        });
        if (!resolved.allowed) {
            return res.status(403).json({ error: 'FORWARD_ORIGIN_NOT_ACCESSIBLE' });
        }
        forwardOrigin = {
            originType: resolved.originType,
            originRefId: resolved.originId,
            originMessageId: resolved.originMessageId,
            originSenderId: resolved.originSenderId
        };
    }

    const cooldown = await cooldownService.checkAndApply(req.user);
    if (!cooldown.allowed) {
        return res.status(429).json({ error: 'COOLDOWN_ACTIVE', retryAfterMs: cooldown.retryAfterMs });
    }

    const message = await channelMessageService.createChannelMessage({
        channelId,
        senderId: req.user.sub,
        body,
        type,
        fileId,
        isConfidential: Boolean(isConfidential),
        forwardOrigin
    });
    notifier.notifyChannelMessageCreated(channelId, message);
    summaryService.touch('channel', channelId);
    return res.status(201).json({ message });
}

async function listMessages(req, res) {
    const channelId = parseId(req.params.id);
    if (!channelId) {
        return res.status(400).json({ error: 'INVALID_CHANNEL_ID' });
    }
    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }
    const membership = await requireActorMembership(channelId, req);
    if (!membership && channel.visibility !== 'public') {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    const { before, limit } = req.query || {};
    let query = { before, limit };
    const around = Number((req.query || {}).around);
    if (Number.isInteger(around) && around > 0) {
        query = await chatHistory.windowAround('channel', channelId, around);
        if (!query) {
            return res.status(404).json({ error: 'MESSAGE_NOT_FOUND' });
        }
    }
    const messages = await systemSettings.applyReadReceiptPolicy(
        await channelMessageService.listChannelMessages(channelId, query)
    );
    return res.status(200).json({ messages });
}

async function getAttachments(req, res) {
    const channelId = parseId(req.params.id);
    const { category, cursor, limit } = req.query || {};
    if (!channelId || !attachmentClassifier.isValidCategory(category)) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }
    const membership = await requireActorMembership(channelId, req);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    const rows = await channelMessageService.getChannelAttachments(channelId, { category, cursor, limit });
    const items = rows.map(attachmentClassifier.serializeAttachmentRow);
    const nextCursor = items.length ? items[items.length - 1].id : null;
    return res.status(200).json({ items, nextCursor, hasMore: items.length > 0 && rows.length >= (Number(limit) || 30) });
}

async function setMute(req, res) {
    const channelId = parseId(req.params.id);
    const { muted } = req.body || {};
    if (!channelId || typeof muted !== 'boolean') {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }
    const membership = await requireMembership(channelId, req.user.sub);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    const updated = await channelCoreService.setChannelMemberMuted(channelId, req.user.sub, muted);
    if (!updated) {
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }
    return res.status(200).json({ muted: updated.muted });
}

async function searchMessages(req, res) {
    const channelId = parseId(req.params.id);
    const term = String((req.query || {}).q || '').trim();
    if (!channelId) {
        return res.status(400).json({ error: 'INVALID_CHANNEL_ID' });
    }
    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }
    const membership = await requireActorMembership(channelId, req);
    if (!membership && channel.visibility !== 'public') {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    if (!term) {
        return res.status(200).json({ results: [] });
    }
    const rows = await channelMessageService.searchChannelMessages(channelId, term);
    const results = rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        senderName: row.sender_name,
        snippet: row.body,
        type: row.type,
        fileName: row.file_original_name || null,
        fileMimeType: row.file_mime_type || null,
        isFile: row.type === 'file' || row.type === 'image' || row.type === 'video'
    }));
    return res.status(200).json({ results });
}

async function editMessage(req, res) {
    const channelId = parseId(req.params.id);
    const messageId = parseId(req.params.messageId);
    if (!channelId || !messageId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const message = await channelMessageService.getChannelMessageById(messageId);
    if (!message || message.channel_id !== channelId || message.is_deleted) {
        return res.status(404).json({ error: 'MESSAGE_NOT_FOUND' });
    }
    if (message.sender_id !== req.user.sub) {
        return res.status(403).json({ error: 'CAN_ONLY_EDIT_OWN_MESSAGE' });
    }
    const body = String((req.body || {}).body || '').trim();
    if (!body) {
        return res.status(400).json({ error: 'EMPTY_MESSAGE' });
    }
    const updated = await channelMessageService.editChannelMessage(messageId, body);
    notifier.notifyChannelMessageEdited(channelId, updated);
    summaryService.touch('channel', channelId, { force: true });
    return res.status(200).json({ message: updated });
}

async function deleteMessage(req, res) {
    const channelId = parseId(req.params.id);
    const messageId = parseId(req.params.messageId);
    if (!channelId || !messageId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const message = await channelMessageService.getChannelMessageById(messageId);
    if (!message || message.channel_id !== channelId) {
        return res.status(404).json({ error: 'MESSAGE_NOT_FOUND' });
    }
    if (message.sender_id !== req.user.sub) {
        const membership = await requireActorMembership(channelId, req);
        try {
            permissionMatrix.assertCan(membership, 'delete_messages');
        } catch (err) {
            if (handlePermissionError(err, res)) return undefined;
            throw err;
        }
    }
    await channelMessageService.deleteChannelMessage(messageId);
    await adminAudit.recordMessageDeletion(req.user.sub, 'channel', channelId, messageId);
    notifier.notifyChannelMessageDeleted(channelId, messageId);
    summaryService.touch('channel', channelId, { force: true });
    return res.status(200).json({ deleted: true });
}

async function setPinned(req, res) {
    const channelId = parseId(req.params.id);
    const messageId = parseId(req.params.messageId);
    if (!channelId || !messageId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const message = await channelMessageService.getChannelMessageById(messageId);
    if (!message || message.channel_id !== channelId) {
        return res.status(404).json({ error: 'MESSAGE_NOT_FOUND' });
    }
    const membership = await requireActorMembership(channelId, req);
    try {
        permissionMatrix.assertCan(membership, 'pin_messages');
    } catch (err) {
        if (handlePermissionError(err, res)) return undefined;
        throw err;
    }
    const pinned = Boolean((req.body || {}).pinned);
    const updated = await channelMessageService.setChannelMessagePinned(messageId, pinned);
    notifier.notifyChannelMessagePinned(channelId, updated);
    summaryService.touch('channel', channelId, { force: true });
    return res.status(200).json({ message: updated });
}

module.exports = {
    createChannel: asyncHandler(createChannel),
    listChannels: asyncHandler(listChannels),
    markRead: asyncHandler(markRead),
    getChannel: asyncHandler(getChannel),
    updateChannel: asyncHandler(updateChannel),
    deleteChannel: asyncHandler(deleteChannel),
    transferManager: asyncHandler(transferManager),
    listMembers: asyncHandler(listMembers),
    addMember: asyncHandler(addMember),
    removeMember: asyncHandler(removeMember),
    setMemberRole: asyncHandler(setMemberRole),
    createMessage: asyncHandler(createMessage),
    listMessages: asyncHandler(listMessages),
    getAttachments: asyncHandler(getAttachments),
    setMute: asyncHandler(setMute),
    searchMessages: asyncHandler(searchMessages),
    editMessage: asyncHandler(editMessage),
    deleteMessage: asyncHandler(deleteMessage),
    setPinned: asyncHandler(setPinned)
};
