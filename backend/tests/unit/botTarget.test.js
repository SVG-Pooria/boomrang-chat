const test = require('node:test');
const assert = require('node:assert/strict');
const { mockModule, freshRequire, servicesDir } = require('../helpers/moduleMock');

function loadBotTargetService({ conversation, channel, group } = {}) {
    const dir = servicesDir();
    const restores = [];

    const calls = {
        dbQueries: [],
        addChannelMember: [],
        addGroupMember: [],
        createMessage: [],
        attachFile: [],
        createChannelMessage: [],
        createGroupMessage: [],
        notifyConversation: [],
        notifyChannel: [],
        notifyGroup: []
    };

    restores.push(mockModule('../config/database', dir, {
        query: async (text, params) => {
            calls.dbQueries.push({ text, params });
            return { rows: [] };
        }
    }));

    restores.push(mockModule('./conversation.service', dir, {
        getConversationById: async (id) => {
            if (!conversation || conversation.id !== id) return null;
            return conversation;
        }
    }));

    restores.push(mockModule('./channelCore.service', dir, {
        getChannelById: async (id) => {
            if (!channel || channel.id !== id) return null;
            return channel;
        },
        addChannelMember: async (channelId, userId, role, permissions) => {
            calls.addChannelMember.push({ channelId, userId, role, permissions });
            return { channel_id: channelId, user_id: userId, role, permissions };
        }
    }));

    restores.push(mockModule('./groupCore.service', dir, {
        getGroupById: async (id) => {
            if (!group || group.id !== id) return null;
            return group;
        },
        addGroupMember: async (groupId, userId, role, permissions) => {
            calls.addGroupMember.push({ groupId, userId, role, permissions });
            return { group_id: groupId, user_id: userId, role, permissions };
        }
    }));

    restores.push(mockModule('./message.service', dir, {
        createMessage: async (payload) => {
            calls.createMessage.push(payload);
            return { id: 9001, conversation_id: payload.conversationId, body: payload.body, type: payload.type || 'text', file_id: null };
        },
        attachFile: async (messageId, fileId) => {
            calls.attachFile.push({ messageId, fileId });
            return { id: messageId, file_id: fileId };
        }
    }));

    restores.push(mockModule('./channelMessage.service', dir, {
        createChannelMessage: async (payload) => {
            calls.createChannelMessage.push(payload);
            return { id: 9002, channel_id: payload.channelId, body: payload.body, type: payload.type || 'text', file_id: payload.fileId || null };
        }
    }));

    restores.push(mockModule('./groupMessage.service', dir, {
        createGroupMessage: async (payload) => {
            calls.createGroupMessage.push(payload);
            return { id: 9003, group_id: payload.groupId, body: payload.body, type: payload.type || 'text', file_id: payload.fileId || null };
        }
    }));

    restores.push(mockModule('../socket/notifier', dir, {
        notifyConversationMessageCreated: (id, message) => calls.notifyConversation.push({ id, message }),
        notifyChannelMessageCreated: (id, message) => calls.notifyChannel.push({ id, message }),
        notifyGroupMessageCreated: (id, message) => calls.notifyGroup.push({ id, message })
    }));

    const service = freshRequire('../services/botTarget.service', dir);

    return {
        service,
        calls,
        restore: () => restores.forEach((restore) => restore())
    };
}

test('sendToTarget delivers into a conversation and grants can_post membership', async () => {
    const { service, calls, restore } = loadBotTargetService({
        conversation: { id: 5, title: 'کانال سیستمی' }
    });
    try {
        const { target, message } = await service.sendToTarget({
            targetType: 'conversation',
            targetId: 5,
            senderId: 1,
            body: 'یادآوری متنی',
            type: 'text'
        });

        assert.equal(target.id, 5);
        assert.equal(message.conversation_id, 5);
        assert.equal(calls.createMessage.length, 1);
        assert.equal(calls.createMessage[0].conversationId, 5);
        assert.equal(calls.notifyConversation.length, 1);
        assert.equal(calls.notifyConversation[0].id, 5);

        const upsert = calls.dbQueries.find((q) => q.text.includes('conversation_members'));
        assert.ok(upsert, 'expected a conversation_members upsert query');
        assert.deepEqual(upsert.params, [5, 1]);
    } finally {
        restore();
    }
});

test('sendToTarget delivers into a channel with post-only bot membership', async () => {
    const { service, calls, restore } = loadBotTargetService({
        channel: { id: 12, name: 'اطلاعیه‌ها', is_active: true }
    });
    try {
        const { target, message } = await service.sendToTarget({
            targetType: 'channel',
            targetId: 12,
            senderId: 1,
            body: 'یادآوری کانال',
            type: 'text',
            fileId: 77
        });

        assert.equal(target.id, 12);
        assert.equal(message.channel_id, 12);
        assert.equal(message.file_id, 77);

        assert.equal(calls.addChannelMember.length, 1);
        assert.equal(calls.addChannelMember[0].channelId, 12);
        assert.equal(calls.addChannelMember[0].userId, 1);
        assert.equal(calls.addChannelMember[0].role, 'member');
        assert.deepEqual(calls.addChannelMember[0].permissions, { post: true });

        assert.equal(calls.createChannelMessage.length, 1);
        assert.equal(calls.createChannelMessage[0].fileId, 77);
        assert.equal(calls.notifyChannel.length, 1);
        assert.equal(calls.notifyChannel[0].id, 12);
    } finally {
        restore();
    }
});

test('sendToTarget delivers into a group with send_messages-only bot membership', async () => {
    const { service, calls, restore } = loadBotTargetService({
        group: { id: 30, name: 'گروه تیم', is_active: true }
    });
    try {
        const { target, message } = await service.sendToTarget({
            targetType: 'group',
            targetId: 30,
            senderId: 1,
            body: 'یادآوری گروه',
            type: 'image',
            fileId: 88
        });

        assert.equal(target.id, 30);
        assert.equal(message.group_id, 30);
        assert.equal(message.type, 'image');

        assert.equal(calls.addGroupMember.length, 1);
        assert.equal(calls.addGroupMember[0].groupId, 30);
        assert.equal(calls.addGroupMember[0].role, 'member');
        assert.deepEqual(calls.addGroupMember[0].permissions, { send_messages: true });

        assert.equal(calls.createGroupMessage.length, 1);
        assert.equal(calls.notifyGroup.length, 1);
        assert.equal(calls.notifyGroup[0].id, 30);
    } finally {
        restore();
    }
});

test('resolveTarget throws TargetUnavailableError for a missing or archived channel', async () => {
    const { service, restore } = loadBotTargetService({});
    try {
        await assert.rejects(
            () => service.resolveTarget('channel', 999),
            (err) => {
                assert.ok(err instanceof service.TargetUnavailableError);
                assert.equal(err.code, 'TARGET_UNAVAILABLE');
                assert.equal(err.targetType, 'channel');
                assert.equal(err.targetId, 999);
                return true;
            }
        );
    } finally {
        restore();
    }
});

test('sendToTarget propagates TargetUnavailableError instead of creating a message', async () => {
    const { service, calls, restore } = loadBotTargetService({
        group: { id: 30, name: 'گروه تیم', is_active: true }
    });
    try {
        await assert.rejects(
            () => service.sendToTarget({ targetType: 'group', targetId: 31, senderId: 1, body: 'x', type: 'text' }),
            (err) => err instanceof service.TargetUnavailableError
        );
        assert.equal(calls.createGroupMessage.length, 0);
        assert.equal(calls.notifyGroup.length, 0);
    } finally {
        restore();
    }
});

test('resolveTarget/sendToTarget reject an unknown target type', async () => {
    const { service, restore } = loadBotTargetService({});
    try {
        await assert.rejects(
            () => service.resolveTarget('channel_group', 1),
            (err) => err instanceof service.InvalidTargetTypeError
        );
    } finally {
        restore();
    }
});
