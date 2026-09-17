const db = require('../config/database');

async function findUserById(userId) {
    const result = await db.query(
        `SELECT u.id, u.full_name, u.phone, u.role, u.tag_id, t.name AS tag_name, u.is_active, u.dnd_enabled, u.dnd_label, u.dnd_until,
                u.avatar_path, u.avatar_updated_at
         FROM users u
         LEFT JOIN tags t ON t.id = u.tag_id
         WHERE u.id = $1`,
        [userId]
    );
    const row = result.rows[0];
    if (!row) {
        return null;
    }
    const dndActive = row.dnd_enabled && (!row.dnd_until || new Date(row.dnd_until).getTime() > Date.now());
    return {
        sub: row.id,
        fullName: row.full_name,
        phone: row.phone,
        role: row.role,
        tagId: row.tag_id,
        tagName: row.tag_name || null,
        is_active: row.is_active,
        dndEnabled: Boolean(dndActive),
        dndLabel: row.dnd_label || null,
        dndUntil: row.dnd_until,
        avatarUrl: row.avatar_path
            ? `/api/avatars/user/${row.id}?v=${row.avatar_updated_at ? new Date(row.avatar_updated_at).getTime() : 0}`
            : null
    };
}

async function findDirectConversation(userAId, userBId) {
    const result = await db.query(
        `SELECT * FROM conversations WHERE type = 'direct'
         AND LEAST(direct_user_a, direct_user_b) = LEAST($1::integer, $2::integer)
         AND GREATEST(direct_user_a, direct_user_b) = GREATEST($1::integer, $2::integer)`,
        [userAId, userBId]
    );
    return result.rows[0] || null;
}

const UNIQUE_VIOLATION = '23505';

async function createDirectConversation(userAId, userBId, createdBy, origin) {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const inserted = await client.query(
            `INSERT INTO conversations (type, direct_user_a, direct_user_b, created_by, origin)
             VALUES ('direct', $1, $2, $3, $4) RETURNING *`,
            [userAId, userBId, createdBy, origin || 'normal']
        );
        const conversation = inserted.rows[0];
        await client.query(
            `INSERT INTO conversation_members (conversation_id, user_id, role_in_conv)
             VALUES ($1, $2, 'member'), ($1, $3, 'member')`,
            [conversation.id, userAId, userBId]
        );
        await client.query('COMMIT');
        return conversation;
    } catch (err) {
        await client.query('ROLLBACK');
        if (err && err.code === UNIQUE_VIOLATION) {

            const winner = await findDirectConversation(userAId, userBId);
            if (winner) {
                return winner;
            }
        }
        throw err;
    } finally {
        client.release();
    }
}

async function getOrCreateDirect(userAId, userBId, createdBy) {
    const existing = await findDirectConversation(userAId, userBId);
    if (existing) {
        return existing;
    }
    return createDirectConversation(userAId, userBId, createdBy, 'normal');
}

async function reopenConversation(conversationId) {
    const result = await db.query(
        `UPDATE conversations SET origin = 'management_approved', closed_at = NULL, closed_by = NULL
         WHERE id = $1 RETURNING *`,
        [conversationId]
    );
    return result.rows[0];
}

async function getOrCreateApprovedDirect(employeeId, managementId, createdBy) {
    const existing = await findDirectConversation(employeeId, managementId);
    if (!existing) {
        return createDirectConversation(employeeId, managementId, createdBy, 'management_approved');
    }
    if (existing.closed_at) {
        return reopenConversation(existing.id);
    }
    return existing;
}

async function closeConversation(conversationId, closedBy) {
    const result = await db.query(
        `UPDATE conversations SET closed_at = now(), closed_by = $1
         WHERE id = $2 RETURNING *`,
        [closedBy, conversationId]
    );
    return result.rows[0];
}

async function getConversationById(conversationId) {
    const result = await db.query('SELECT * FROM conversations WHERE id = $1', [conversationId]);
    return result.rows[0] || null;
}

async function getMembership(conversationId, userId) {
    const result = await db.query(
        'SELECT * FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
        [conversationId, userId]
    );
    return result.rows[0] || null;
}

async function removeMember(conversationId, userId) {
    await db.query(
        'DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
        [conversationId, userId]
    );
}

async function setMuted(conversationId, userId, muted) {
    const result = await db.query(
        `UPDATE conversation_members SET muted = $1
         WHERE conversation_id = $2 AND user_id = $3 RETURNING muted`,
        [Boolean(muted), conversationId, userId]
    );
    return result.rows[0] || null;
}

async function listMemberIds(conversationId) {
    const result = await db.query(
        'SELECT user_id FROM conversation_members WHERE conversation_id = $1',
        [conversationId]
    );
    return result.rows.map((row) => row.user_id);
}

async function listLegacyChannels() {
    const result = await db.query(
        `SELECT * FROM conversations WHERE type = 'channel' ORDER BY created_at DESC`
    );
    return result.rows;
}

async function listForUser(userId) {
    const result = await db.query(
        `SELECT c.*, cm.role_in_conv, cm.muted, cm.joined_at
         FROM conversations c
         JOIN conversation_members cm ON cm.conversation_id = c.id
         WHERE cm.user_id = $1
         ORDER BY c.created_at DESC`,
        [userId]
    );
    return result.rows;
}

async function otherDirectUser(conversation, selfId) {
    if (conversation.type !== 'direct') {
        return null;
    }
    const otherId = conversation.direct_user_a === selfId ? conversation.direct_user_b : conversation.direct_user_a;
    return findUserById(otherId);
}

module.exports = {
    findUserById,
    findDirectConversation,
    createDirectConversation,
    getOrCreateDirect,
    getOrCreateApprovedDirect,
    closeConversation,
    getConversationById,
    getMembership,
    removeMember,
    setMuted,
    listMemberIds,
    listForUser,
    listLegacyChannels,
    otherDirectUser
};
