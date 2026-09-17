const db = require('../config/database');

const UNIQUE_VIOLATION = '23505';

function channelCoreService() {
    return require('./channelCore.service');
}

function groupCoreService() {
    return require('./groupCore.service');
}

class LinkError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

async function getActiveLinkByChannel(channelId) {
    const result = await db.query(
        `SELECT * FROM channel_group_links WHERE channel_id = $1 AND is_active = true`,
        [channelId]
    );
    return result.rows[0] || null;
}

async function getActiveLinkByGroup(groupId) {
    const result = await db.query(
        `SELECT * FROM channel_group_links WHERE group_id = $1 AND is_active = true`,
        [groupId]
    );
    return result.rows[0] || null;
}

async function getLinkStatusForChannel(channelId) {
    const link = await getActiveLinkByChannel(channelId);
    if (!link) {
        return { linked: false, link: null, group: null };
    }
    const group = await groupCoreService().getGroupById(link.group_id);
    return { linked: true, link, group };
}

async function getLinkStatusForGroup(groupId) {
    const link = await getActiveLinkByGroup(groupId);
    if (!link) {
        return { linked: false, link: null, channel: null };
    }
    const channel = await channelCoreService().getChannelById(link.channel_id);
    return { linked: true, link, channel };
}

async function linkChannelToGroup(channelId, groupId, linkedBy) {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const channelResult = await client.query(
            'SELECT * FROM channels WHERE id = $1 FOR UPDATE',
            [channelId]
        );
        const channel = channelResult.rows[0];
        if (!channel || !channel.is_active) {
            await client.query('ROLLBACK');
            throw new LinkError('CHANNEL_NOT_FOUND');
        }

        const groupResult = await client.query(
            'SELECT * FROM groups WHERE id = $1 FOR UPDATE',
            [groupId]
        );
        const group = groupResult.rows[0];
        if (!group || !group.is_active) {
            await client.query('ROLLBACK');
            throw new LinkError('GROUP_NOT_FOUND');
        }

        const existingForChannel = await client.query(
            'SELECT id FROM channel_group_links WHERE channel_id = $1 AND is_active = true',
            [channelId]
        );
        if (existingForChannel.rows[0]) {
            await client.query('ROLLBACK');
            throw new LinkError('CHANNEL_ALREADY_LINKED');
        }

        const existingForGroup = await client.query(
            'SELECT id FROM channel_group_links WHERE group_id = $1 AND is_active = true',
            [groupId]
        );
        if (existingForGroup.rows[0]) {
            await client.query('ROLLBACK');
            throw new LinkError('GROUP_ALREADY_LINKED');
        }

        const inserted = await client.query(
            `INSERT INTO channel_group_links (channel_id, group_id, linked_by)
             VALUES ($1, $2, $3) RETURNING *`,
            [channelId, groupId, linkedBy]
        );

        await client.query('COMMIT');
        return inserted.rows[0];
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackErr) {

        }
        if (err instanceof LinkError) {
            throw err;
        }
        if (err.code === UNIQUE_VIOLATION) {

            const stillFreeChannel = !(await getActiveLinkByChannel(channelId));
            throw new LinkError(stillFreeChannel ? 'GROUP_ALREADY_LINKED' : 'CHANNEL_ALREADY_LINKED');
        }
        throw err;
    } finally {
        client.release();
    }
}

async function unlinkChannel(channelId, unlinkedBy) {
    const result = await db.query(
        `UPDATE channel_group_links SET is_active = false, unlinked_at = now(), unlinked_by = $2
         WHERE channel_id = $1 AND is_active = true RETURNING *`,
        [channelId, unlinkedBy || null]
    );
    return result.rows[0] || null;
}

async function unlinkGroup(groupId, unlinkedBy) {
    const result = await db.query(
        `UPDATE channel_group_links SET is_active = false, unlinked_at = now(), unlinked_by = $2
         WHERE group_id = $1 AND is_active = true RETURNING *`,
        [groupId, unlinkedBy || null]
    );
    return result.rows[0] || null;
}

async function unlinkChannelWithClient(client, channelId, unlinkedBy) {
    const result = await client.query(
        `UPDATE channel_group_links SET is_active = false, unlinked_at = now(), unlinked_by = $2
         WHERE channel_id = $1 AND is_active = true RETURNING *`,
        [channelId, unlinkedBy || null]
    );
    return result.rows[0] || null;
}

async function unlinkGroupWithClient(client, groupId, unlinkedBy) {
    const result = await client.query(
        `UPDATE channel_group_links SET is_active = false, unlinked_at = now(), unlinked_by = $2
         WHERE group_id = $1 AND is_active = true RETURNING *`,
        [groupId, unlinkedBy || null]
    );
    return result.rows[0] || null;
}

module.exports = {
    LinkError,
    getActiveLinkByChannel,
    getActiveLinkByGroup,
    getLinkStatusForChannel,
    getLinkStatusForGroup,
    linkChannelToGroup,
    unlinkChannel,
    unlinkGroup,
    unlinkChannelWithClient,
    unlinkGroupWithClient
};
