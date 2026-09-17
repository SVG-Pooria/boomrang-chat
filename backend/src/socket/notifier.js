const conversationService = require('../services/conversation.service');
const { conversationRoom, userRoom, roleRoom } = require('./messageHandlers');

function channelRoom(channelId) {
    return `channel:${channelId}`;
}

function groupRoom(groupId) {
    return `group:${groupId}`;
}

let ioInstance = null;

function setIo(io) {
    ioInstance = io;
}

function getIo() {
    return ioInstance;
}

function notifyManagementNewTicket(ticket, requester) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(roleRoom('management')).emit('ticket:new', {
        ticket,
        requester: { id: requester.sub, fullName: requester.fullName }
    });
}

async function notifyTicketApproved(ticket, conversation) {
    if (!ioInstance) {
        return;
    }
    const employee = await conversationService.findUserById(ticket.requester_id);
    const reviewer = await conversationService.findUserById(ticket.reviewed_by);
    await ioInstance.in(userRoom(ticket.requester_id)).socketsJoin(conversationRoom(conversation.id));
    await ioInstance.in(userRoom(ticket.reviewed_by)).socketsJoin(conversationRoom(conversation.id));
    ioInstance.to(userRoom(ticket.requester_id)).emit('ticket:status', {
        ticketId: ticket.id,
        status: 'approved',
        conversationId: conversation.id
    });
    ioInstance.to(userRoom(ticket.requester_id)).emit('conversation:new', {
        conversation: { ...conversation, otherUser: reviewer }
    });
    ioInstance.to(userRoom(ticket.reviewed_by)).emit('conversation:new', {
        conversation: { ...conversation, otherUser: employee }
    });
}

function notifyTicketRejected(ticket) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(userRoom(ticket.requester_id)).emit('ticket:status', {
        ticketId: ticket.id,
        status: 'rejected',
        reason: ticket.review_note || null
    });
}

async function notifyConversationClosed(conversation, closedBy) {
    if (!ioInstance) {
        return;
    }
    const otherUserId = conversation.direct_user_a === closedBy
        ? conversation.direct_user_b
        : conversation.direct_user_a;
    ioInstance.to(userRoom(otherUserId)).emit('conversation:closed', {
        conversationId: conversation.id
    });
    ioInstance.to(conversationRoom(conversation.id)).emit('conversation:closed', {
        conversationId: conversation.id
    });
}

function notifyMessageEdited(conversationId, message) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(conversationRoom(conversationId)).emit('message:edited', {
        conversationId,
        message
    });
}

function notifyMessageDeleted(conversationId, messageId) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(conversationRoom(conversationId)).emit('message:deleted', {
        conversationId,
        messageId
    });
}

async function joinUserToGroupRoom(groupId, userId) {
    if (!ioInstance) {
        return;
    }
    await ioInstance.in(userRoom(userId)).socketsJoin(groupRoom(groupId));
}

async function joinUserToChannelRoom(channelId, userId) {
    if (!ioInstance) {
        return;
    }
    await ioInstance.in(userRoom(userId)).socketsJoin(channelRoom(channelId));
}

function notifyChannelGroupLinked(channelId, groupId, link) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(channelRoom(channelId)).emit('channel:linked', { channelId, groupId, link });
    ioInstance.to(groupRoom(groupId)).emit('group:linked', { channelId, groupId, link });
}

function notifyChannelGroupUnlinked(channelId, groupId) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(channelRoom(channelId)).emit('channel:unlinked', { channelId, groupId });
    ioInstance.to(groupRoom(groupId)).emit('group:unlinked', { channelId, groupId });
}

function notifyGroupMessageForwarded(groupId, forwardedMessage, sourceChannelId) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(groupRoom(groupId)).emit('group:message', {
        groupId,
        message: forwardedMessage,
        forwardedFromChannelId: sourceChannelId
    });
}

function notifyConversationMessageCreated(conversationId, message) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(conversationRoom(conversationId)).emit('message:new', { conversationId, message });
}

function notifyChannelMessageCreated(channelId, message) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(channelRoom(channelId)).emit('channel:message', { channelId, message });
}

function notifyChannelMessageEdited(channelId, message) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(channelRoom(channelId)).emit('channel:message:edited', { channelId, message });
}

function notifyChannelMessageDeleted(channelId, messageId) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(channelRoom(channelId)).emit('channel:message:deleted', { channelId, messageId });
}

function notifyChannelMessagePinned(channelId, message) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(channelRoom(channelId)).emit('channel:message:pinned', { channelId, message });
}

function notifyGroupMessageCreated(groupId, message) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(groupRoom(groupId)).emit('group:message', { groupId, message });
}

function notifyGroupMessageEdited(groupId, message) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(groupRoom(groupId)).emit('group:message:edited', { groupId, message });
}

function notifyGroupMessageDeleted(groupId, messageId) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(groupRoom(groupId)).emit('group:message:deleted', { groupId, messageId });
}

function notifyMessagePinned(conversationId, message) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(conversationRoom(conversationId)).emit('message:pinned', { conversationId, message });
}

function notifyGroupMessagePinned(groupId, message) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(groupRoom(groupId)).emit('group:message:pinned', { groupId, message });
}

function workspaceRoom() {
    return 'workspace';
}

function targetRoom(targetType, targetId) {
    if (targetType === 'channel') {
        return channelRoom(targetId);
    }
    if (targetType === 'group') {
        return groupRoom(targetId);
    }
    return conversationRoom(targetId);
}

function notifyWorkspaceChanged(section) {
    if (!ioInstance) {
        return;
    }
    ioInstance.emit('workspace:changed', { section });
}

function notifyChannelFileChanged(targetType, targetId) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(targetRoom(targetType, targetId)).emit('channelfile:changed', { targetType, targetId });
}

function notifyPollChanged(targetType, targetId, poll) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(targetRoom(targetType, targetId)).emit('poll:changed', { targetType, targetId, poll });
}

function notifyManagerSpacesChanged(managerId) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(userRoom(managerId)).emit('manager:spaces', { managerId });
}

function notifySummaryUpdated(targetType, targetId, summary) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(targetRoom(targetType, targetId)).emit('summary:updated', { targetType, targetId, summary });
}

function sessionRoom(sessionId) {
    return `session:${sessionId}`;
}

function spaceRoom(kind, id) {
    return kind === 'channel' ? channelRoom(id) : groupRoom(id);
}

function notifyAdmins(event, payload) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(roleRoom('super_admin')).emit(event, payload || {});
}

function endSessionSockets(sessionId) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(sessionRoom(sessionId)).emit('session:ended');
    ioInstance.in(sessionRoom(sessionId)).disconnectSockets();
}

function endUserSockets(userId) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(userRoom(userId)).emit('session:ended');
    ioInstance.in(userRoom(userId)).disconnectSockets();
}

function notifySidebarChanged(userIds) {
    if (!ioInstance) {
        return;
    }
    userIds.forEach((userId) => {
        ioInstance.to(userRoom(userId)).emit('sidebar:changed');
    });
}

async function joinUserToSpaceRoom(kind, id, userId) {
    if (!ioInstance) {
        return;
    }
    await ioInstance.in(userRoom(userId)).socketsJoin(spaceRoom(kind, id));
}

async function removeUserFromSpaceRoom(kind, id, userId) {
    if (!ioInstance) {
        return;
    }
    await ioInstance.in(userRoom(userId)).socketsLeave(spaceRoom(kind, id));
}

function notifySettingsChanged() {
    if (!ioInstance) {
        return;
    }
    ioInstance.emit('settings:changed');
}

function notifyConversationRead(conversationId, userId, messageId) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(conversationRoom(conversationId)).emit('message:read', { conversationId, userId, messageId });
}

function notifyChannelRead(channelId, userId, messageId) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(channelRoom(channelId)).emit('channel:read', { channelId, userId, messageId });
}

function notifyGroupRead(groupId, userId, messageId) {
    if (!ioInstance) {
        return;
    }
    ioInstance.to(groupRoom(groupId)).emit('group:read', { groupId, userId, messageId });
}

module.exports = {
    setIo,
    notifyConversationRead,
    notifyChannelRead,
    notifyGroupRead,
    getIo,
    channelRoom,
    groupRoom,
    sessionRoom,
    notifyAdmins,
    endSessionSockets,
    endUserSockets,
    notifySidebarChanged,
    joinUserToSpaceRoom,
    removeUserFromSpaceRoom,
    notifySettingsChanged,
    notifyManagementNewTicket,
    notifyTicketApproved,
    notifyTicketRejected,
    notifyConversationClosed,
    notifyMessageEdited,
    notifyMessagePinned,
    notifyWorkspaceChanged,
    notifyChannelFileChanged,
    notifyPollChanged,
    notifySummaryUpdated,
    notifyManagerSpacesChanged,
    notifyMessageDeleted,
    notifyConversationMessageCreated,
    joinUserToGroupRoom,
    joinUserToChannelRoom,
    notifyChannelGroupLinked,
    notifyChannelGroupUnlinked,
    notifyGroupMessageForwarded,
    notifyChannelMessageCreated,
    notifyChannelMessageEdited,
    notifyChannelMessageDeleted,
    notifyChannelMessagePinned,
    notifyGroupMessageCreated,
    notifyGroupMessageEdited,
    notifyGroupMessageDeleted,
    notifyGroupMessagePinned
};
