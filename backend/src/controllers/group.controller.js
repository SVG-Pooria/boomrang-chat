const asyncHandler = require('../utils/asyncHandler');
const groupCoreService = require('../services/groupCore.service');
const groupMessageService = require('../services/groupMessage.service');
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
        res.status(403).json({ error: err.code });
        return true;
    }
    return false;
}

async function requireMembership(groupId, userId) {
    return groupCoreService.getGroupMembership(groupId, userId);
}

async function requireActorMembership(groupId, req) {
    if (req.user.role === 'super_admin') {
        return SUPER_ADMIN_MEMBERSHIP;
    }
    return requireMembership(groupId, req.user.sub);
}

function withAvatarUrl(group) {
    if (!group) {
        return group;
    }
    const { avatar, ...rest } = group;
    const version = group.updated_at ? new Date(group.updated_at).getTime() : 0;
    return { ...rest, avatarUrl: avatar ? `/api/avatars/group/${group.id}?v=${version}` : null };
}

function sanitizeGroup(group, viewerRole) {
    if (!group) {
        return group;
    }
    const withUrl = withAvatarUrl(group);
    if (viewerRole === 'super_admin') {
        return withUrl;
    }
    const { created_by, ...rest } = withUrl;
    return rest;
}

async function createGroup(req, res) {
    if (!capabilityService.isLeader(req.user.role)) {
        return res.status(403).json({ error: 'ONLY_LEADERS_CAN_CREATE_GROUPS' });
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
    const group = await groupCoreService.createGroup({
        title: trimmedTitle,
        description,
        avatar,
        visibility,
        ownerId,
        createdBy: req.user.sub
    });
    await notifier.joinUserToGroupRoom(group.id, ownerId);
    await activityLogService.log(req.user.sub, 'group.created', {
        groupId: group.id,
        title: group.title,
        managerId: ownerId
    });
    return res.status(201).json({ group: sanitizeGroup(group, req.user.role) });
}

async function transferManager(req, res) {
    const groupId = parseId(req.params.id);
    if (!groupId) {
        return res.status(400).json({ error: 'INVALID_GROUP_ID' });
    }
    const group = await groupCoreService.getGroupById(groupId);
    if (!group) {
        return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
    }
    const newManagerId = parseId((req.body || {}).userId);
    if (!newManagerId) {
        return res.status(400).json({ error: 'USER_ID_REQUIRED' });
    }
    const manager = await conversationService.findUserById(newManagerId);
    if (!manager || !manager.is_active) {
        return res.status(404).json({ error: 'MANAGER_NOT_FOUND' });
    }
    const updated = await groupCoreService.transferGroupOwnership(groupId, newManagerId);
    await notifier.joinUserToGroupRoom(groupId, newManagerId);
    await activityLogService.log(req.user.sub, 'group.manager_transferred', {
        groupId,
        newManagerId
    });
    return res.status(200).json({ group: sanitizeGroup(updated, req.user.role) });
}

async function listGroups(req, res) {
    const groups = await groupCoreService.listGroupsForUser(req.user.sub);
    const summaries = await groupMessageService.getGroupSummaries(groups.map((group) => group.id), req.user.sub);
    return res.status(200).json({
        groups: groups.map((group) => ({
            ...sanitizeGroup(group, req.user.role),
            lastMessage: summaries[group.id].lastMessage,
            unreadCount: summaries[group.id].unreadCount
        }))
    });
}

async function markRead(req, res) {
    const groupId = parseId(req.params.id);
    if (!groupId) {
        return res.status(400).json({ error: 'INVALID_GROUP_ID' });
    }
    const membership = await requireActorMembership(groupId, req);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    const messageId = parseId((req.body || {}).messageId);
    if (!messageId) {
        return res.status(400).json({ error: 'INVALID_MESSAGE_ID' });
    }
    await groupMessageService.markGroupRead(groupId, req.user.sub, messageId);
    if (await systemSettings.getFlag('readReceiptsEnabled')) {
        notifier.notifyGroupRead(groupId, req.user.sub, messageId);
    }
    return res.status(200).json({ success: true });
}

async function getGroup(req, res) {
    const groupId = parseId(req.params.id);
    if (!groupId) {
        return res.status(400).json({ error: 'INVALID_GROUP_ID' });
    }
    const group = await groupCoreService.getGroupById(groupId);
    if (!group) {
        return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
    }
    const membership = await requireActorMembership(groupId, req);
    if (!membership && group.visibility !== 'public') {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    return res.status(200).json({ group: sanitizeGroup(group, req.user.role), membership: membership || null });
}

async function updateGroup(req, res) {
    const groupId = parseId(req.params.id);
    if (!groupId) {
        return res.status(400).json({ error: 'INVALID_GROUP_ID' });
    }
    const group = await groupCoreService.getGroupById(groupId);
    if (!group) {
        return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
    }
    const membership = await requireActorMembership(groupId, req);
    try {
        permissionMatrix.assertCan(membership, 'edit_info');
    } catch (err) {
        if (handlePermissionError(err, res)) return undefined;
        throw err;
    }
    if (req.body && req.body.visibility && !VISIBILITIES.includes(req.body.visibility)) {
        return res.status(400).json({ error: 'INVALID_VISIBILITY' });
    }
    const updated = await groupCoreService.updateGroup(groupId, req.body || {});
    return res.status(200).json({ group: sanitizeGroup(updated, req.user.role) });
}

async function deleteGroup(req, res) {
    const groupId = parseId(req.params.id);
    if (!groupId) {
        return res.status(400).json({ error: 'INVALID_GROUP_ID' });
    }
    const group = await groupCoreService.getGroupById(groupId);
    if (!group) {
        return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
    }
    const membership = await requireActorMembership(groupId, req);
    if (!membership || membership.role !== 'owner') {
        return res.status(403).json({ error: 'ONLY_OWNER_CAN_DELETE' });
    }
    const { removedLink } = await groupCoreService.archiveGroup(groupId, req.user.sub);
    await activityLogService.log(req.user.sub, 'group.archived', { groupId, title: group.title });
    if (removedLink) {
        notifier.notifyChannelGroupUnlinked(removedLink.channel_id, groupId);
        await activityLogService.log(req.user.sub, 'channel_group.auto_unlinked', {
            groupId,
            channelId: removedLink.channel_id,
            reason: 'group_deleted'
        });
    }
    return res.status(200).json({ archived: true });
}

async function listMembers(req, res) {
    const groupId = parseId(req.params.id);
    if (!groupId) {
        return res.status(400).json({ error: 'INVALID_GROUP_ID' });
    }
    const group = await groupCoreService.getGroupById(groupId);
    if (!group) {
        return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
    }
    const membership = await requireActorMembership(groupId, req);
    if (!membership && group.visibility !== 'public') {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    const members = await groupCoreService.listGroupMembers(groupId);
    return res.status(200).json({ members: members.map(serializeMember) });
}

async function addMember(req, res) {
    const groupId = parseId(req.params.id);
    if (!groupId) {
        return res.status(400).json({ error: 'INVALID_GROUP_ID' });
    }
    const group = await groupCoreService.getGroupById(groupId);
    if (!group) {
        return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
    }

    const targetUserId = parseId((req.body || {}).userId) || req.user.sub;
    const isSelfJoin = targetUserId === req.user.sub;
    const actorMembership = await requireActorMembership(groupId, req);

    if (isSelfJoin) {
        if (actorMembership) {
            return res.status(409).json({ error: 'ALREADY_A_MEMBER' });
        }
        if (group.visibility !== 'public') {
            return res.status(403).json({ error: 'GROUP_IS_PRIVATE' });
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

    const member = await groupCoreService.addGroupMember(groupId, targetUserId, 'member');
    await notifier.joinUserToGroupRoom(groupId, targetUserId);
    return res.status(201).json({ member: serializeMember(member) });
}

async function removeMember(req, res) {
    const groupId = parseId(req.params.id);
    const targetUserId = parseId(req.params.userId);
    if (!groupId || !targetUserId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const group = await groupCoreService.getGroupById(groupId);
    if (!group) {
        return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
    }
    const actorMembership = await requireActorMembership(groupId, req);
    const targetMembership = await requireMembership(groupId, targetUserId);

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

    await groupCoreService.removeGroupMember(groupId, targetUserId);
    return res.status(200).json({ removed: true });
}

async function setMemberRole(req, res) {
    const groupId = parseId(req.params.id);
    const targetUserId = parseId(req.params.userId);
    if (!groupId || !targetUserId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const group = await groupCoreService.getGroupById(groupId);
    if (!group) {
        return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
    }

    const { role, permissions } = req.body || {};
    if (role && !permissionMatrix.ROLES.includes(role)) {
        return res.status(400).json({ error: 'INVALID_ROLE' });
    }

    const actorMembership = await requireActorMembership(groupId, req);
    const targetMembership = await requireMembership(groupId, targetUserId);
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

    const updated = await groupCoreService.setGroupMemberRole(
        groupId,
        targetUserId,
        role || targetMembership.role,
        permissions
    );
    if (role && role !== targetMembership.role) {
        await activityLogService.log(req.user.sub, 'group.member.role_changed', {
            groupId,
            userId: targetUserId,
            oldRole: targetMembership.role,
            newRole: role
        });
    }
    return res.status(200).json({ member: serializeMember(updated) });
}

async function createMessage(req, res) {
    const groupId = parseId(req.params.id);
    if (!groupId) {
        return res.status(400).json({ error: 'INVALID_GROUP_ID' });
    }
    const group = await groupCoreService.getGroupById(groupId);
    if (!group) {
        return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
    }
    const membership = await requireActorMembership(groupId, req);
    try {
        permissionMatrix.assertCan(membership, 'send_messages');
    } catch (err) {
        if (handlePermissionError(err, res)) return undefined;
        throw err;
    }
    const body = String((req.body || {}).body || '').trim();
    const { type, fileId, replyToId, forwardOrigin: rawOrigin, isConfidential } = req.body || {};
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

    const message = await groupMessageService.createGroupMessage({
        groupId,
        senderId: req.user.sub,
        body,
        type,
        fileId,
        replyToId,
        isConfidential: Boolean(isConfidential),
        forwardOrigin
    });
    notifier.notifyGroupMessageCreated(groupId, message);
    summaryService.touch('group', groupId);
    return res.status(201).json({ message });
}

async function listMessages(req, res) {
    const groupId = parseId(req.params.id);
    if (!groupId) {
        return res.status(400).json({ error: 'INVALID_GROUP_ID' });
    }
    const group = await groupCoreService.getGroupById(groupId);
    if (!group) {
        return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
    }
    const membership = await requireActorMembership(groupId, req);
    if (!membership && group.visibility !== 'public') {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    const { before, limit } = req.query || {};
    let query = { before, limit };
    const around = Number((req.query || {}).around);
    if (Number.isInteger(around) && around > 0) {
        query = await chatHistory.windowAround('group', groupId, around);
        if (!query) {
            return res.status(404).json({ error: 'MESSAGE_NOT_FOUND' });
        }
    }
    const messages = await systemSettings.applyReadReceiptPolicy(
        await groupMessageService.listGroupMessages(groupId, query)
    );
    return res.status(200).json({ messages });
}

async function getAttachments(req, res) {
    const groupId = parseId(req.params.id);
    const { category, cursor, limit } = req.query || {};
    if (!groupId || !attachmentClassifier.isValidCategory(category)) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const group = await groupCoreService.getGroupById(groupId);
    if (!group) {
        return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
    }
    const membership = await requireActorMembership(groupId, req);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    const rows = await groupMessageService.getGroupAttachments(groupId, { category, cursor, limit });
    const items = rows.map(attachmentClassifier.serializeAttachmentRow);
    const nextCursor = items.length ? items[items.length - 1].id : null;
    return res.status(200).json({ items, nextCursor, hasMore: items.length > 0 && rows.length >= (Number(limit) || 30) });
}

async function setMute(req, res) {
    const groupId = parseId(req.params.id);
    const { muted } = req.body || {};
    if (!groupId || typeof muted !== 'boolean') {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const group = await groupCoreService.getGroupById(groupId);
    if (!group) {
        return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
    }
    const membership = await requireMembership(groupId, req.user.sub);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    const updated = await groupCoreService.setGroupMemberMuted(groupId, req.user.sub, muted);
    if (!updated) {
        return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
    }
    return res.status(200).json({ muted: updated.muted });
}

async function searchMessages(req, res) {
    const groupId = parseId(req.params.id);
    const term = String((req.query || {}).q || '').trim();
    if (!groupId) {
        return res.status(400).json({ error: 'INVALID_GROUP_ID' });
    }
    const group = await groupCoreService.getGroupById(groupId);
    if (!group) {
        return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
    }
    const membership = await requireActorMembership(groupId, req);
    if (!membership && group.visibility !== 'public') {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    if (!term) {
        return res.status(200).json({ results: [] });
    }
    const rows = await groupMessageService.searchGroupMessages(groupId, term);
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
    const groupId = parseId(req.params.id);
    const messageId = parseId(req.params.messageId);
    if (!groupId || !messageId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const message = await groupMessageService.getGroupMessageById(messageId);
    if (!message || message.group_id !== groupId || message.is_deleted) {
        return res.status(404).json({ error: 'MESSAGE_NOT_FOUND' });
    }
    if (message.sender_id !== req.user.sub) {
        return res.status(403).json({ error: 'CAN_ONLY_EDIT_OWN_MESSAGE' });
    }
    const body = String((req.body || {}).body || '').trim();
    if (!body) {
        return res.status(400).json({ error: 'EMPTY_MESSAGE' });
    }
    const updated = await groupMessageService.editGroupMessage(messageId, body);
    notifier.notifyGroupMessageEdited(groupId, updated);
    summaryService.touch('group', groupId, { force: true });
    return res.status(200).json({ message: updated });
}

async function deleteMessage(req, res) {
    const groupId = parseId(req.params.id);
    const messageId = parseId(req.params.messageId);
    if (!groupId || !messageId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const message = await groupMessageService.getGroupMessageById(messageId);
    if (!message || message.group_id !== groupId) {
        return res.status(404).json({ error: 'MESSAGE_NOT_FOUND' });
    }
    if (message.sender_id !== req.user.sub) {
        const membership = await requireActorMembership(groupId, req);
        try {
            permissionMatrix.assertCan(membership, 'delete_messages');
        } catch (err) {
            if (handlePermissionError(err, res)) return undefined;
            throw err;
        }
    }
    await groupMessageService.deleteGroupMessage(messageId);
    await adminAudit.recordMessageDeletion(req.user.sub, 'group', groupId, messageId);
    notifier.notifyGroupMessageDeleted(groupId, messageId);
    summaryService.touch('group', groupId, { force: true });
    return res.status(200).json({ deleted: true });
}

async function setPinned(req, res) {
    const groupId = parseId(req.params.id);
    const messageId = parseId(req.params.messageId);
    if (!groupId || !messageId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const message = await groupMessageService.getGroupMessageById(messageId);
    if (!message || message.group_id !== groupId) {
        return res.status(404).json({ error: 'MESSAGE_NOT_FOUND' });
    }
    const membership = await requireActorMembership(groupId, req);
    try {
        permissionMatrix.assertCan(membership, 'pin_messages');
    } catch (err) {
        if (handlePermissionError(err, res)) return undefined;
        throw err;
    }
    const pinned = Boolean((req.body || {}).pinned);
    const updated = await groupMessageService.setGroupMessagePinned(messageId, pinned);
    notifier.notifyGroupMessagePinned(groupId, updated);
    summaryService.touch('group', groupId, { force: true });
    return res.status(200).json({ message: updated });
}

module.exports = {
    createGroup: asyncHandler(createGroup),
    listGroups: asyncHandler(listGroups),
    markRead: asyncHandler(markRead),
    getGroup: asyncHandler(getGroup),
    updateGroup: asyncHandler(updateGroup),
    deleteGroup: asyncHandler(deleteGroup),
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
