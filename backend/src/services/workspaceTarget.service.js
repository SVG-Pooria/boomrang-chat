const db = require('../config/database');

const TARGET_TYPES = ['conversation', 'channel', 'group'];

function isValidTargetType(value) {
    return TARGET_TYPES.includes(value);
}

async function getMembership(targetType, targetId, userId) {
    if (targetType === 'channel') {
        const result = await db.query(
            'SELECT * FROM channel_members WHERE channel_id = $1 AND user_id = $2',
            [targetId, userId]
        );
        return result.rows[0] || null;
    }
    if (targetType === 'group') {
        const result = await db.query(
            'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2',
            [targetId, userId]
        );
        return result.rows[0] || null;
    }
    const result = await db.query(
        'SELECT * FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
        [targetId, userId]
    );
    return result.rows[0] || null;
}

async function displayName(targetType, targetId, viewerUserId) {
    if (targetType === 'channel') {
        const result = await db.query('SELECT title FROM channels WHERE id = $1', [targetId]);
        return result.rows[0] ? `#${result.rows[0].title}` : 'کانال حذف‌شده';
    }
    if (targetType === 'group') {
        const result = await db.query('SELECT title FROM groups WHERE id = $1', [targetId]);
        return result.rows[0] ? result.rows[0].title : 'گروه حذف‌شده';
    }
    const conversation = await db.query('SELECT * FROM conversations WHERE id = $1', [targetId]);
    const row = conversation.rows[0];
    if (!row) {
        return 'گفتگوی حذف‌شده';
    }
    if (row.type !== 'direct') {
        return row.title || 'گفتگو';
    }
    if (!viewerUserId) {
        return 'گفتگوی شخصی';
    }
    return 'گفتگوی شخصی';
}

async function listMemberIds(targetType, targetId) {
    const table =
        targetType === 'channel'
            ? 'channel_members'
            : targetType === 'group'
              ? 'group_members'
              : 'conversation_members';
    const column =
        targetType === 'channel' ? 'channel_id' : targetType === 'group' ? 'group_id' : 'conversation_id';
    const result = await db.query(`SELECT user_id FROM ${table} WHERE ${column} = $1`, [targetId]);
    return result.rows.map((row) => row.user_id);
}

async function canModerate(targetType, targetId, viewer) {
    if (viewer.role === 'super_admin') {
        return true;
    }
    if (targetType !== 'channel' && targetType !== 'group') {
        return false;
    }
    const membership = await getMembership(targetType, targetId, viewer.sub);
    return Boolean(membership) && (membership.role === 'owner' || membership.role === 'admin');
}

module.exports = {
    TARGET_TYPES,
    isValidTargetType,
    getMembership,
    canModerate,
    displayName,
    listMemberIds
};
