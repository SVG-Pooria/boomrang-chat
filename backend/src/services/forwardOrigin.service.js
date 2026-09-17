const db = require('../config/database');
const conversationService = require('./conversation.service');
const groupCoreService = require('./groupCore.service');
const channelCoreService = require('./channelCore.service');
const messageService = require('./message.service');
const groupMessageService = require('./groupMessage.service');
const channelMessageService = require('./channelMessage.service');

const VALID_ORIGIN_TYPES = ['direct', 'group', 'channel'];

async function getUserFullName(userId) {
    if (!userId) return null;
    const result = await db.query('SELECT full_name FROM users WHERE id = $1', [userId]);
    return result.rows[0] ? result.rows[0].full_name : null;
}

async function resolveForwardOrigin({ originType, originId, originMessageId, viewerUserId }) {
    if (!VALID_ORIGIN_TYPES.includes(originType) || !originId || !originMessageId) {
        return { allowed: false, reason: 'INVALID_ORIGIN' };
    }

    if (originType === 'direct') {
        const membership = await conversationService.getMembership(originId, viewerUserId);
        if (!membership) return { allowed: false, reason: 'NOT_A_MEMBER' };
        const originMessage = await messageService.getMessageById(originMessageId);
        if (!originMessage || originMessage.conversation_id !== Number(originId)) {
            return { allowed: false, reason: 'MESSAGE_NOT_FOUND' };
        }
        return {
            allowed: true,
            originType,
            originId: Number(originId),
            originMessageId: Number(originMessageId),
            originSenderId: originMessage.sender_id,
            originSenderName: (await getUserFullName(originMessage.sender_id)) || 'کاربر حذف‌شده',
            originLabel: null,
            originMessage
        };
    }

    if (originType === 'group') {
        const membership = await groupCoreService.getGroupMembership(originId, viewerUserId);
        if (!membership) return { allowed: false, reason: 'NOT_A_MEMBER' };
        const originMessage = await groupMessageService.getGroupMessageById(originMessageId);
        if (!originMessage || originMessage.group_id !== Number(originId)) {
            return { allowed: false, reason: 'MESSAGE_NOT_FOUND' };
        }
        const group = await groupCoreService.getGroupById(originId);
        return {
            allowed: true,
            originType,
            originId: Number(originId),
            originMessageId: Number(originMessageId),
            originSenderId: originMessage.sender_id,
            originSenderName: (await getUserFullName(originMessage.sender_id)) || 'کاربر حذف‌شده',
            originLabel: group ? group.title : null,
            originMessage
        };
    }

    const membership = await channelCoreService.getChannelMembership(originId, viewerUserId);
    if (!membership) return { allowed: false, reason: 'NOT_A_MEMBER' };
    const originMessage = await channelMessageService.getChannelMessageById(originMessageId);
    if (!originMessage || originMessage.channel_id !== Number(originId)) {
        return { allowed: false, reason: 'MESSAGE_NOT_FOUND' };
    }
    const channel = await channelCoreService.getChannelById(originId);
    return {
        allowed: true,
        originType,
        originId: Number(originId),
        originMessageId: Number(originMessageId),
        originSenderId: originMessage.sender_id,
        originSenderName: (await getUserFullName(originMessage.sender_id)) || 'کاربر حذف‌شده',
        originLabel: channel ? channel.title : null,
        originMessage
    };
}

async function enrichForwardMeta(row) {
    if (!row || !row.forward_origin_type) return row;
    const enriched = { ...row };
    if (row.forward_origin_sender_id) {
        enriched.forward_origin_sender_name = (await getUserFullName(row.forward_origin_sender_id)) || 'کاربر حذف‌شده';
    }
    if (row.forward_origin_type === 'group' && row.forward_origin_ref_id) {
        const group = await groupCoreService.getGroupById(row.forward_origin_ref_id);
        enriched.forward_origin_group_title = group ? group.title : null;
    } else if (row.forward_origin_type === 'channel' && row.forward_origin_ref_id) {
        const channel = await channelCoreService.getChannelById(row.forward_origin_ref_id);
        enriched.forward_origin_channel_title = channel ? channel.title : null;
    }
    return enriched;
}

module.exports = { resolveForwardOrigin, enrichForwardMeta };