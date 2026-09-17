const db = require('../config/database');
const permissionMatrix = require('./channelGroupPermission.service');
const channelGroupLinkService = require('./channelGroupLink.service');

async function createGroup({ title, description, avatar, ownerId, createdBy, visibility }) {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const inserted = await client.query(
            `INSERT INTO groups (title, description, avatar, owner_id, visibility, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [title, description || null, avatar || null, ownerId, visibility || 'public', createdBy || ownerId]
        );
        const group = inserted.rows[0];
        await client.query(
            `INSERT INTO group_members (group_id, user_id, role, permissions)
             VALUES ($1, $2, 'owner', $3::jsonb)`,
            [group.id, ownerId, JSON.stringify(permissionMatrix.OWNER_PERMISSIONS)]
        );
        await client.query('COMMIT');
        return group;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function getGroupById(groupId) {
    const result = await db.query('SELECT * FROM groups WHERE id = $1 AND is_active = true', [groupId]);
    return result.rows[0] || null;
}

async function listGroupsForUser(userId) {
    const result = await db.query(
        `SELECT g.*, gm.role, gm.permissions, gm.joined_at
         FROM groups g
         JOIN group_members gm ON gm.group_id = g.id
         WHERE gm.user_id = $1 AND g.is_active = true
         ORDER BY g.created_at DESC`,
        [userId]
    );
    return result.rows;
}

async function listAllGroups() {
    const result = await db.query(
        `SELECT g.*, owner.full_name AS owner_name, owner.role AS owner_role,
                (SELECT count(*)::int FROM group_members WHERE group_id = g.id) AS member_count
         FROM groups g
         LEFT JOIN users owner ON owner.id = g.owner_id
         WHERE g.is_active = true
         ORDER BY g.created_at DESC`
    );
    return result.rows;
}

async function updateGroup(groupId, { title, description, avatar, visibility }) {
    const result = await db.query(
        `UPDATE groups SET
            title = COALESCE($1, title),
            description = COALESCE($2, description),
            avatar = COALESCE($3, avatar),
            visibility = COALESCE($4, visibility),
            updated_at = now()
         WHERE id = $5 RETURNING *`,
        [title || null, description || null, avatar || null, visibility || null, groupId]
    );
    return result.rows[0] || null;
}

async function archiveGroup(groupId, actorId = null) {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const updated = await client.query(
            `UPDATE groups SET is_active = false, updated_at = now() WHERE id = $1 RETURNING *`,
            [groupId]
        );
        const removedLink = await channelGroupLinkService.unlinkGroupWithClient(client, groupId, actorId);
        await client.query('COMMIT');
        return { group: updated.rows[0] || null, removedLink };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function getGroupMembership(groupId, userId) {
    const result = await db.query(
        'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
    );
    return result.rows[0] || null;
}

async function listGroupMembers(groupId) {
    const result = await db.query(
        `SELECT gm.*, u.full_name, u.phone,
                COALESCE(msg.message_count, 0) AS message_count
         FROM group_members gm
         JOIN users u ON u.id = gm.user_id
         LEFT JOIN (
             SELECT sender_id, COUNT(*) AS message_count
             FROM group_messages
             WHERE group_id = $1 AND is_deleted = false
             GROUP BY sender_id
         ) msg ON msg.sender_id = gm.user_id
         WHERE gm.group_id = $1
         ORDER BY gm.joined_at ASC`,
        [groupId]
    );
    return result.rows;
}

async function addGroupMember(groupId, userId, role = 'member', permissions = null) {
    const resolvedPermissions = permissions || permissionMatrix.defaultPermissionsFor('group', role);
    const result = await db.query(
        `WITH upserted AS (
            INSERT INTO group_members (group_id, user_id, role, permissions)
            VALUES ($1, $2, $3, $4::jsonb)
            ON CONFLICT (group_id, user_id) DO UPDATE SET role = $3, permissions = $4::jsonb
            RETURNING *
         )
         SELECT upserted.*, u.full_name, u.phone
         FROM upserted
         JOIN users u ON u.id = upserted.user_id`,
        [groupId, userId, role, JSON.stringify(resolvedPermissions)]
    );
    return result.rows[0];
}

async function removeGroupMember(groupId, userId) {
    await db.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
}

async function setGroupMemberRole(groupId, userId, role, permissions) {
    const resolvedPermissions = permissions || permissionMatrix.defaultPermissionsFor('group', role);
    const result = await db.query(
        `UPDATE group_members gm SET role = $1, permissions = $2::jsonb
         FROM users u
         WHERE gm.group_id = $3 AND gm.user_id = $4 AND u.id = gm.user_id
         RETURNING gm.*, u.full_name, u.phone`,
        [role, JSON.stringify(resolvedPermissions), groupId, userId]
    );
    return result.rows[0] || null;
}

async function setGroupMemberMuted(groupId, userId, muted) {
    const result = await db.query(
        `UPDATE group_members SET muted = $1
         WHERE group_id = $2 AND user_id = $3 RETURNING muted`,
        [Boolean(muted), groupId, userId]
    );
    return result.rows[0] || null;
}

async function transferGroupOwnership(groupId, newOwnerId) {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const currentOwners = await client.query(
            `SELECT * FROM group_members WHERE group_id = $1 AND role = 'owner'`,
            [groupId]
        );
        for (const previousOwner of currentOwners.rows) {
            if (previousOwner.user_id === newOwnerId) {
                continue;
            }
            await client.query(
                `UPDATE group_members SET role = 'admin', permissions = $1::jsonb
                 WHERE group_id = $2 AND user_id = $3`,
                [JSON.stringify(permissionMatrix.OWNER_PERMISSIONS), groupId, previousOwner.user_id]
            );
        }
        await client.query(
            `INSERT INTO group_members (group_id, user_id, role, permissions)
             VALUES ($1, $2, 'owner', $3::jsonb)
             ON CONFLICT (group_id, user_id) DO UPDATE SET role = 'owner', permissions = $3::jsonb`,
            [groupId, newOwnerId, JSON.stringify(permissionMatrix.OWNER_PERMISSIONS)]
        );
        const updated = await client.query(
            `UPDATE groups SET owner_id = $1, updated_at = now() WHERE id = $2 RETURNING *`,
            [newOwnerId, groupId]
        );
        await client.query('COMMIT');
        return updated.rows[0] || null;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    createGroup,
    getGroupById,
    listGroupsForUser,
    listAllGroups,
    updateGroup,
    archiveGroup,
    getGroupMembership,
    listGroupMembers,
    addGroupMember,
    removeGroupMember,
    setGroupMemberRole,
    setGroupMemberMuted,
    transferGroupOwnership
};
