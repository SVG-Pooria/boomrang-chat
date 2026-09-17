const conversationService = require('./conversation.service');
const permissionService = require('./permission.service');

async function resolveConversation(senderUser, payload, joinSocketsFn) {
    if (payload.conversationId) {
        const conversation = await conversationService.getConversationById(payload.conversationId);
        if (!conversation) {
            throw new permissionService.PermissionError('CONVERSATION_NOT_FOUND');
        }
        const membership = await conversationService.getMembership(conversation.id, senderUser.sub);
        const otherUser = await conversationService.otherDirectUser(conversation, senderUser.sub);
        permissionService.assertCanPostInExistingConversation(senderUser, conversation, membership, otherUser);
        return conversation;
    }

    if (payload.targetUserId) {
        const targetUser = await conversationService.findUserById(payload.targetUserId);
        if (!targetUser) {
            throw new permissionService.PermissionError('USER_NOT_FOUND');
        }
        permissionService.assertCanCreateDirect(senderUser, targetUser);
        const conversation = await conversationService.getOrCreateDirect(senderUser.sub, targetUser.sub, senderUser.sub);
        if (joinSocketsFn) {
            await joinSocketsFn(conversation, targetUser);
        }
        return conversation;
    }

    throw new permissionService.PermissionError('CONVERSATION_OR_TARGET_REQUIRED');
}

module.exports = { resolveConversation };
