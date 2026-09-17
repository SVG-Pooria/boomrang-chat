const db = require('../config/database');

const SYSTEM_CHANNEL_TITLE = 'اطلاعیه‌ها';
const POST_ALLOWED_ROLES = ['management', 'super_admin'];

function roleInConvFor(role) {
    return POST_ALLOWED_ROLES.includes(role) ? 'can_post' : 'read_only';
}

async function getSystemChannel() {
    const result = await db.query(
        'SELECT * FROM conversations WHERE is_system_channel = true LIMIT 1'
    );
    return result.rows[0] || null;
}

async function getOrCreateSystemChannel() {
    const existing = await getSystemChannel();
    if (existing) {
        return existing;
    }
    try {
        const inserted = await db.query(
            `INSERT INTO conversations (type, is_system_channel, origin, title, created_by)
             VALUES ('channel', true, 'normal', $1, NULL) RETURNING *`,
            [SYSTEM_CHANNEL_TITLE]
        );
        return inserted.rows[0];
    } catch (err) {
        if (err.code === '23505') {
            return getSystemChannel();
        }
        throw err;
    }
}

async function ensureMembership(conversationId, userId, role) {
    await db.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role_in_conv)
         VALUES ($1, $2, $3)
         ON CONFLICT (conversation_id, user_id)
         DO UPDATE SET role_in_conv = $3`,
        [conversationId, userId, roleInConvFor(role)]
    );
}

async function ensureSystemChannelMembership(userId, role) {
    const channel = await getOrCreateSystemChannel();
    await ensureMembership(channel.id, userId, role);
    return channel;
}

async function ensureAllActiveUsersJoined() {
    const channel = await getOrCreateSystemChannel();
    const users = await db.query('SELECT id, role FROM users WHERE is_active = true');
    for (const user of users.rows) {
        await ensureMembership(channel.id, user.id, user.role);
    }
    return channel;
}

module.exports = {
    SYSTEM_CHANNEL_TITLE,
    POST_ALLOWED_ROLES,
    roleInConvFor,
    getSystemChannel,
    getOrCreateSystemChannel,
    ensureSystemChannelMembership,
    ensureAllActiveUsersJoined
};
