const test = require('node:test');
const assert = require('node:assert/strict');
const { mockModule, freshRequire, servicesDir } = require('../helpers/moduleMock');

function loadGroupService() {
    const dir = servicesDir();
    const members = new Map();
    members.set('1:10', { group_id: 1, user_id: 10, last_read_message_id: null });

    const messages = [
        { id: 101, group_id: 1, sender_id: 20, body: 'سلام', type: 'text', created_at: '2026-01-01T10:00:00Z', is_deleted: false },
        { id: 102, group_id: 1, sender_id: 20, body: 'چطوری؟', type: 'text', created_at: '2026-01-01T10:05:00Z', is_deleted: false }
    ];

    const restoreDb = mockModule('../config/database', dir, {
        query: async (text, params) => {
            if (text.includes('DISTINCT ON (gm.group_id)')) {
                const [groupIds] = params;
                const rows = groupIds
                    .map((id) => messages.filter((m) => m.group_id === id && !m.is_deleted).sort((a, b) => b.id - a.id)[0])
                    .filter(Boolean);
                return { rows };
            }
            if (text.includes('COUNT(*)::int AS count') && text.includes('group_members mem')) {
                const [groupIds, userId] = params;
                const rows = groupIds
                    .map((id) => {
                        const membership = members.get(`${id}:${userId}`);
                        const lastRead = membership ? membership.last_read_message_id || 0 : 0;
                        const count = messages.filter(
                            (m) => m.group_id === id && !m.is_deleted && m.sender_id !== userId && m.id > lastRead
                        ).length;
                        return count > 0 ? { group_id: id, count } : null;
                    })
                    .filter(Boolean);
                return { rows };
            }
            if (text.includes('UPDATE group_members') && text.includes('last_read_message_id')) {
                const [groupId, userId, messageId] = params;
                const key = `${groupId}:${userId}`;
                const current = members.get(key) || { group_id: groupId, user_id: userId, last_read_message_id: null };
                current.last_read_message_id = Math.max(current.last_read_message_id || 0, messageId);
                members.set(key, current);
                return { rows: [] };
            }
            throw new Error(`Unexpected query in test double: ${text}`);
        }
    });

    const service = freshRequire('../services/groupMessage.service', dir);
    return { service, members, restore: restoreDb };
}

test('getGroupSummaries reports last message and unread count for another sender', async () => {
    const { service, restore } = loadGroupService();
    try {
        const summaries = await service.getGroupSummaries([1], 10);
        assert.equal(summaries[1].lastMessage.id, 102);
        assert.equal(summaries[1].unreadCount, 2);
    } finally {
        restore();
    }
});

test('markGroupRead clears unread count for messages up to the read message', async () => {
    const { service, restore } = loadGroupService();
    try {
        await service.markGroupRead(1, 10, 101);
        const summaries = await service.getGroupSummaries([1], 10);
        assert.equal(summaries[1].unreadCount, 1);
    } finally {
        restore();
    }
});

test('getGroupSummaries never counts the viewer own messages as unread', async () => {
    const { service, restore } = loadGroupService();
    try {
        const summaries = await service.getGroupSummaries([1], 20);
        assert.equal(summaries[1].unreadCount, 0);
    } finally {
        restore();
    }
});
