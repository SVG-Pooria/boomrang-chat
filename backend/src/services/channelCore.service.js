const db = require('../config/database');
const permissionMatrix = require('./channelGroupPermission.service');
const channelGroupLinkService = require('./channelGroupLink.service');

async function createChannel({ title, description, avatar, ownerId, createdBy, visibility }) {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const inserted = await client.query(
            `INSERT INTO channels (title, description, avatar, owner_id, visibility, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [title, description || null, avatar || null, ownerId, visibility || 'public', createdBy || ownerId]
        );
        const channel = inserted.rows[0];
        await client.query(
            `INSERT INTO channel_members (channel_id, user_id, role, permissions)
             VALUES ($1, $2, 'owner', $3::jsonb)`,
            [channel.id, ownerId, JSON.stringify(permissionMatrix.OWNER_PERMISSIONS)]
        );
        await client.query('COMMIT');
        return channel;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function getChannelById(channelId) {
    const result = await db.query('SELECT * FROM channels WHERE id = $1 AND is_active = true', [channelId]);
    return result.rows[0] || null;
}

async function listChannelsForUser(userId) {
    const result = await db.query(
        `SELECT c.*, cm.role, cm.permissions, cm.joined_at
         FROM channels c
         JOIN channel_members cm ON cm.channel_id = c.id
         WHERE cm.user_id = $1 AND c.is_active = true
         ORDER BY c.created_at DESC`,
        [userId]
    );
    return result.rows;
}

async function listAllChannels() {
    const result = await db.query(
        `SELECT c.*, owner.full_name AS owner_name, owner.role AS owner_role,
                (SELECT count(*)::int FROM channel_members WHERE channel_id = c.id) AS member_count
         FROM channels c
         LEFT JOIN users owner ON owner.id = c.owner_id
         WHERE c.is_active = true
         ORDER BY c.created_at DESC`
    );
    return result.rows;
}

async function updateChannel(channelId, { title, description, avatar, visibility }) {
    const result = await db.query(
        `UPDATE channels SET
            title = COALESCE($1, title),
            description = COALESCE($2, description),
            avatar = COALESCE($3, avatar),
            visibility = COALESCE($4, visibility),
            updated_at = now()
         WHERE id = $5 RETURNING *`,
        [title || null, description || null, avatar || null, visibility || null, channelId]
    );
    return result.rows[0] || null;
}

async function archiveChannel(channelId, actorId = null) {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const updated = await client.query(
            `UPDATE channels SET is_active = false, updated_at = now() WHERE id = $1 RETURNING *`,
            [channelId]
        );
        const removedLink = await channelGroupLinkService.unlinkChannelWithClient(client, channelId, actorId);
        await client.query('COMMIT');
        return { channel: updated.rows[0] || null, removedLink };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function getChannelMembership(channelId, userId) {
    const result = await db.query(
        'SELECT * FROM channel_members WHERE channel_id = $1 AND user_id = $2',
        [channelId, userId]
    );
    return result.rows[0] || null;
}

async function listChannelMembers(channelId) {
    const result = await db.query(
        `SELECT cm.*, u.full_name, u.phone,
                COALESCE(msg.message_count, 0) AS message_count
         FROM channel_members cm
         JOIN users u ON u.id = cm.user_id
         LEFT JOIN (
             SELECT sender_id, COUNT(*) AS message_count
             FROM channel_messages
             WHERE channel_id = $1 AND is_deleted = false
             GROUP BY sender_id
         ) msg ON msg.sender_id = cm.user_id
         WHERE cm.channel_id = $1
         ORDER BY cm.joined_at ASC`,
        [channelId]
    );
    return result.rows;
}

async function addChannelMember(channelId, userId, role = 'member', permissions = null) {
    const resolvedPermissions = permissions || permissionMatrix.defaultPermissionsFor('channel', role);
    const result = await db.query(
        `WITH upserted AS (
            INSERT INTO channel_members (channel_id, user_id, role, permissions)
            VALUES ($1, $2, $3, $4::jsonb)
            ON CONFLICT (channel_id, user_id) DO UPDATE SET role = $3, permissions = $4::jsonb
            RETURNING *
         )
         SELECT upserted.*, u.full_name, u.phone
         FROM upserted
         JOIN users u ON u.id = upserted.user_id`,
        [channelId, userId, role, JSON.stringify(resolvedPermissions)]
    );
    return result.rows[0];
}

async function removeChannelMember(channelId, userId) {
    await db.query('DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2', [channelId, userId]);
}

async function setChannelMemberRole(channelId, userId, role, permissions) {
    const resolvedPermissions = permissions || permissionMatrix.defaultPermissionsFor('channel', role);
    const result = await db.query(
        `UPDATE channel_members cm SET role = $1, permissions = $2::jsonb
         FROM users u
         WHERE cm.channel_id = $3 AND cm.user_id = $4 AND u.id = cm.user_id
         RETURNING cm.*, u.full_name, u.phone`,
        [role, JSON.stringify(resolvedPermissions), channelId, userId]
    );
    return result.rows[0] || null;
}

async function setChannelMemberMuted(channelId, userId, muted) {
    const result = await db.query(
        `UPDATE channel_members SET muted = $1
         WHERE channel_id = $2 AND user_id = $3 RETURNING muted`,
        [Boolean(muted), channelId, userId]
    );
    return result.rows[0] || null;
}

async function transferChannelOwnership(channelId, newOwnerId) {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const currentOwners = await client.query(
            `SELECT * FROM channel_members WHERE channel_id = $1 AND role = 'owner'`,
            [channelId]
        );
        for (const previousOwner of currentOwners.rows) {
            if (previousOwner.user_id === newOwnerId) {
                continue;
            }
            await client.query(
                `UPDATE channel_members SET role = 'admin', permissions = $1::jsonb
                 WHERE channel_id = $2 AND user_id = $3`,
                [JSON.stringify(permissionMatrix.OWNER_PERMISSIONS), channelId, previousOwner.user_id]
            );
        }
        await client.query(
            `INSERT INTO channel_members (channel_id, user_id, role, permissions)
             VALUES ($1, $2, 'owner', $3::jsonb)
             ON CONFLICT (channel_id, user_id) DO UPDATE SET role = 'owner', permissions = $3::jsonb`,
            [channelId, newOwnerId, JSON.stringify(permissionMatrix.OWNER_PERMISSIONS)]
        );
        const updated = await client.query(
            `UPDATE channels SET owner_id = $1, updated_at = now() WHERE id = $2 RETURNING *`,
            [newOwnerId, channelId]
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
    createChannel,
    getChannelById,
    listChannelsForUser,
    listAllChannels,
    updateChannel,
    archiveChannel,
    getChannelMembership,
    listChannelMembers,
    addChannelMember,
    removeChannelMember,
    setChannelMemberRole,
    setChannelMemberMuted,
    transferChannelOwnership
};
