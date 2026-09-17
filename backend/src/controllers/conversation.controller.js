const conversationService = require('../services/conversation.service');
const messageService = require('../services/message.service');
const permissionService = require('../services/permission.service');
const activityLogService = require('../services/activityLog.service');
const adminAudit = require('../services/adminAudit.service');
const systemSettings = require('../services/systemSettings.service');
const chatHistory = require('../services/chatHistory.service');
const summaryService = require('../services/summary.service');
const notifier = require('../socket/notifier');
const asyncHandler = require('../utils/asyncHandler');
const attachmentClassifier = require('../utils/attachmentClassifier');

async function listConversations(req, res) {
    const conversations = await conversationService.listForUser(req.user.sub);
    const summaries = await messageService.getConversationSummaries(
        conversations.map((conversation) => conversation.id),
        req.user.sub
    );
    const enriched = await Promise.all(
        conversations.map(async (conversation) => {
            const otherUser = await conversationService.otherDirectUser(conversation, req.user.sub);
            const summary = summaries[conversation.id] || { lastMessage: null, unreadCount: 0 };
            return { ...conversation, otherUser, lastMessage: summary.lastMessage, unreadCount: summary.unreadCount };
        })
    );
    return res.status(200).json({ conversations: enriched });
}

async function createDirectConversation(req, res) {
    const targetUserId = Number((req.body || {}).targetUserId);
    if (!Number.isInteger(targetUserId)) {
        return res.status(400).json({ error: 'INVALID_TARGET_USER' });
    }
    const targetUser = await conversationService.findUserById(targetUserId);
    if (!targetUser) {
        return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }
    try {
        permissionService.assertCanCreateDirect(req.user, targetUser);
    } catch (err) {
        if (err instanceof permissionService.PermissionError) {
            return res.status(403).json({ error: err.code });
        }
        throw err;
    }
    const conversation = await conversationService.getOrCreateDirect(req.user.sub, targetUserId, req.user.sub);

    const otherUser = await conversationService.otherDirectUser(conversation, req.user.sub);
    const summaries = await messageService.getConversationSummaries([conversation.id], req.user.sub);
    const summary = summaries[conversation.id] || { lastMessage: null, unreadCount: 0 };

    return res.status(200).json({
        conversation: { ...conversation, otherUser, lastMessage: summary.lastMessage, unreadCount: summary.unreadCount }
    });
}

async function getMessages(req, res) {
    const conversationId = Number(req.params.id);
    const membership = await conversationService.getMembership(conversationId, req.user.sub);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    let query = req.query;
    const around = Number(req.query.around);
    if (Number.isInteger(around) && around > 0) {
        query = await chatHistory.windowAround('conversation', conversationId, around);
        if (!query) {
            return res.status(404).json({ error: 'MESSAGE_NOT_FOUND' });
        }
    }
    const messages = await systemSettings.applyReadReceiptPolicy(
        await messageService.listMessages(conversationId, query, req.user.sub)
    );
    return res.status(200).json({ messages });
}

async function getAttachments(req, res) {
    const conversationId = Number(req.params.id);
    const { category, cursor, limit } = req.query || {};
    if (!Number.isInteger(conversationId) || !attachmentClassifier.isValidCategory(category)) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const membership = await conversationService.getMembership(conversationId, req.user.sub);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    const rows = await messageService.getAttachments(conversationId, { category, cursor, limit }, req.user.sub);
    const items = rows.map(attachmentClassifier.serializeAttachmentRow);
    const nextCursor = items.length ? items[items.length - 1].id : null;
    return res.status(200).json({ items, nextCursor, hasMore: items.length > 0 && rows.length >= (Number(limit) || 30) });
}

async function searchMessages(req, res) {
    const conversationId = Number(req.params.id);
    const term = String((req.query || {}).q || '').trim();
    const membership = await conversationService.getMembership(conversationId, req.user.sub);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    if (!term) {
        return res.status(200).json({ results: [] });
    }
    const rows = await messageService.searchMessages(conversationId, term, req.user.sub);
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
    const conversationId = Number(req.params.id);
    const messageId = Number(req.params.messageId);
    const body = String((req.body || {}).body || '').trim();
    if (!Number.isInteger(messageId) || !body) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const membership = await conversationService.getMembership(conversationId, req.user.sub);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    const message = await messageService.editMessage(messageId, req.user.sub, body, conversationId);
    if (!message) {
        return res.status(404).json({ error: 'NOT_EDITABLE' });
    }
    await activityLogService.log(req.user.sub, 'message.edited', { conversationId, messageId });
    notifier.notifyMessageEdited(conversationId, message);
    summaryService.touch('conversation', conversationId, { force: true });
    return res.status(200).json({ message });
}

async function deleteMessage(req, res) {
    const conversationId = Number(req.params.id);
    const messageId = Number(req.params.messageId);
    const forEveryone = Boolean((req.body || {}).forEveryone);
    if (!Number.isInteger(messageId)) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const membership = await conversationService.getMembership(conversationId, req.user.sub);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }

    if (!forEveryone) {
        await messageService.hideMessageForUser(messageId, req.user.sub);
        await activityLogService.log(req.user.sub, 'message.deleted_for_me', { conversationId, messageId });
        summaryService.touch('conversation', conversationId, { force: true });
        return res.status(200).json({ success: true, forEveryone: false });
    }

    const result = await messageService.deleteMessageForEveryone(messageId, req.user.sub, conversationId);
    if (result.error === 'NOT_FOUND') {
        return res.status(404).json({ error: 'NOT_FOUND' });
    }
    if (result.error === 'FORBIDDEN') {
        return res.status(403).json({ error: 'NOT_MESSAGE_OWNER' });
    }
    await activityLogService.log(req.user.sub, 'message.deleted_for_everyone', {
        conversationId,
        messageId,
        hadFile: result.hadFile,
        backupCopyRemoved: result.backupCopyRemoved
    });
    await adminAudit.recordMessageDeletion(req.user.sub, 'conversation', conversationId, messageId);
    notifier.notifyMessageDeleted(conversationId, messageId);
    summaryService.touch('conversation', conversationId, { force: true });
    return res.status(200).json({ success: true, forEveryone: true });
}

async function setPinned(req, res) {
    const conversationId = Number(req.params.id);
    const messageId = Number(req.params.messageId);
    const { pinned } = req.body || {};
    if (!Number.isInteger(messageId) || typeof pinned !== 'boolean') {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const membership = await conversationService.getMembership(conversationId, req.user.sub);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    const message = await messageService.setPinned(conversationId, messageId, pinned);
    if (!message) {
        return res.status(404).json({ error: 'NOT_FOUND' });
    }
    await activityLogService.log(req.user.sub, pinned ? 'message.pinned' : 'message.unpinned', {
        conversationId,
        messageId
    });
    notifier.notifyMessagePinned(conversationId, message);
    summaryService.touch('conversation', conversationId, { force: true });
    return res.status(200).json({ message });
}

async function markRead(req, res) {
    const conversationId = Number(req.params.id);
    const messageId = Number((req.body || {}).messageId);
    if (!Number.isInteger(conversationId) || !Number.isInteger(messageId)) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const membership = await conversationService.getMembership(conversationId, req.user.sub);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    await messageService.markRead(conversationId, req.user.sub, messageId);
    await activityLogService.log(req.user.sub, 'conversation.read', { conversationId, messageId });
    if (await systemSettings.getFlag('readReceiptsEnabled')) {
        notifier.notifyConversationRead(conversationId, req.user.sub, messageId);
    }
    return res.status(200).json({ success: true });
}

async function closeConversation(req, res) {
    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId)) {
        return res.status(400).json({ error: 'INVALID_CONVERSATION_ID' });
    }
    const conversation = await conversationService.getConversationById(conversationId);
    if (!conversation) {
        return res.status(404).json({ error: 'CONVERSATION_NOT_FOUND' });
    }
    const membership = await conversationService.getMembership(conversationId, req.user.sub);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    if (conversation.type !== 'direct' || conversation.origin !== 'management_approved') {
        return res.status(400).json({ error: 'CONVERSATION_NOT_CLOSABLE' });
    }
    if (conversation.closed_at) {
        return res.status(409).json({ error: 'ALREADY_CLOSED' });
    }
    const closed = await conversationService.closeConversation(conversationId, req.user.sub);
    await activityLogService.log(req.user.sub, 'conversation.closed', { conversationId });
    await notifier.notifyConversationClosed(closed, req.user.sub);
    return res.status(200).json({ conversation: closed });
}

async function leaveConversation(req, res) {
    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId)) {
        return res.status(400).json({ error: 'INVALID_CONVERSATION_ID' });
    }
    const conversation = await conversationService.getConversationById(conversationId);
    if (!conversation) {
        return res.status(404).json({ error: 'CONVERSATION_NOT_FOUND' });
    }
    const membership = await conversationService.getMembership(conversationId, req.user.sub);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    try {
        permissionService.assertCanLeaveConversation(req.user, conversation);
    } catch (err) {
        if (err instanceof permissionService.PermissionError) {
            return res.status(403).json({ error: err.code });
        }
        throw err;
    }
    await conversationService.removeMember(conversationId, req.user.sub);
    await activityLogService.log(req.user.sub, 'conversation.left', { conversationId });
    return res.status(200).json({ success: true });
}

async function setMute(req, res) {
    const conversationId = Number(req.params.id);
    const { muted } = req.body || {};
    if (!Number.isInteger(conversationId) || typeof muted !== 'boolean') {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const membership = await conversationService.getMembership(conversationId, req.user.sub);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    const updated = await conversationService.setMuted(conversationId, req.user.sub, muted);
    if (!updated) {
        return res.status(404).json({ error: 'CONVERSATION_NOT_FOUND' });
    }
    return res.status(200).json({ muted: updated.muted });
}

module.exports = {
    listConversations: asyncHandler(listConversations),
    createDirectConversation: asyncHandler(createDirectConversation),
    getMessages: asyncHandler(getMessages),
    getAttachments: asyncHandler(getAttachments),
    searchMessages: asyncHandler(searchMessages),
    editMessage: asyncHandler(editMessage),
    deleteMessage: asyncHandler(deleteMessage),
    setPinned: asyncHandler(setPinned),
    markRead: asyncHandler(markRead),
    closeConversation: asyncHandler(closeConversation),
    leaveConversation: asyncHandler(leaveConversation),
    setMute: asyncHandler(setMute)
};
