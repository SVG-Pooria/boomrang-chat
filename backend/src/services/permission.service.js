class PermissionError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

function assertActive(user) {
    if (!user || !user.is_active) {
        throw new PermissionError('SENDER_INACTIVE');
    }
}

function assertNoSuperAdminInvolved(userA, userB) {
    if (userA.role === 'super_admin' || userB.role === 'super_admin') {
        throw new PermissionError('SUPER_ADMIN_NOT_REACHABLE');
    }
}

function assertManagementTicketRule(senderUser, targetUser, conversation) {
    if (targetUser.role !== 'management' || senderUser.role === 'management') {
        return;
    }
    if (senderUser.role !== 'employee') {
        return;
    }
    if (conversation && conversation.created_by === targetUser.sub) {
        return;
    }
    const isApprovedConversation = conversation
        && conversation.origin === 'management_approved'
        && !conversation.closed_at;
    if (!isApprovedConversation) {
        throw new PermissionError('MANAGEMENT_TICKET_REQUIRED');
    }
}

function assertCanCreateDirect(senderUser, targetUser) {
    assertActive(senderUser);
    assertActive(targetUser);
    assertNoSuperAdminInvolved(senderUser, targetUser);
    if (senderUser.sub === targetUser.sub) {
        throw new PermissionError('CANNOT_MESSAGE_SELF');
    }
    assertManagementTicketRule(senderUser, targetUser, null);
}

function assertCanPostInExistingConversation(senderUser, conversation, membership, otherUser) {
    assertActive(senderUser);
    if (!membership) {
        throw new PermissionError('NOT_A_MEMBER');
    }
    if (membership.role_in_conv === 'read_only') {
        throw new PermissionError('READ_ONLY_CHANNEL');
    }
    if (senderUser.role === 'super_admin' && !conversation.is_system_channel) {
        throw new PermissionError('SUPER_ADMIN_NOT_REACHABLE');
    }
    if (conversation.type === 'direct' && otherUser) {
        assertManagementTicketRule(senderUser, otherUser, conversation);
    }
}

function assertCanLeaveConversation(senderUser, conversation) {
    if (conversation.is_system_channel && senderUser.role === 'employee') {
        throw new PermissionError('SYSTEM_CHANNEL_LEAVE_DISABLED');
    }
}

module.exports = {
    PermissionError,
    assertActive,
    assertNoSuperAdminInvolved,
    assertManagementTicketRule,
    assertCanCreateDirect,
    assertCanPostInExistingConversation,
    assertCanLeaveConversation
};
