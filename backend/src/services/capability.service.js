const db = require('../config/database');
const { isHiddenRole } = require('../config/visibility');

const PERMISSIONS = ['schedule_meetings', 'assign_tasks'];
const PERMISSION_LABELS = { schedule_meetings: 'تعریف جلسه', assign_tasks: 'تعریف وظیفه' };
const EXECUTIVE_ROLES = ['super_admin', 'management'];
const LEADER_ROLES = ['super_admin', 'management', 'manager'];

function isExecutive(role) {
    return EXECUTIVE_ROLES.includes(role);
}

function isLeader(role) {
    return LEADER_ROLES.includes(role);
}

function isValidPermission(value) {
    return PERMISSIONS.includes(value);
}

async function grantedFor(userId) {
    const result = await db.query('SELECT permission FROM user_permissions WHERE user_id = $1', [userId]);
    return result.rows.map((row) => row.permission);
}

async function grantedMap(userIds) {
    const map = new Map();
    if (!userIds.length) {
        return map;
    }
    const result = await db.query(
        'SELECT user_id, permission FROM user_permissions WHERE user_id = ANY($1::int[])',
        [userIds]
    );
    for (const row of result.rows) {
        if (!map.has(row.user_id)) {
            map.set(row.user_id, []);
        }
        map.get(row.user_id).push(row.permission);
    }
    return map;
}

async function has(viewer, permission) {
    if (isLeader(viewer.role)) {
        return true;
    }
    const result = await db.query(
        'SELECT 1 FROM user_permissions WHERE user_id = $1 AND permission = $2',
        [viewer.sub, permission]
    );
    return result.rows.length > 0;
}

async function capabilitiesFor(viewer) {
    const granted = isLeader(viewer.role) ? PERMISSIONS : await grantedFor(viewer.sub);
    return {
        scheduleMeetings: granted.includes('schedule_meetings'),
        assignTasks: granted.includes('assign_tasks'),
        manageTeam: isLeader(viewer.role),
        executive: isExecutive(viewer.role)
    };
}

async function setPermission(targetUserId, permission, enabled, actor) {
    if (!isExecutive(actor.role)) {
        return { error: 'FORBIDDEN' };
    }
    if (!isValidPermission(permission)) {
        return { error: 'INVALID_PERMISSION' };
    }
    const target = await db.query('SELECT id, role, is_active, is_bot FROM users WHERE id = $1', [targetUserId]);
    const row = target.rows[0];
    if (!row || !row.is_active || row.is_bot || isHiddenRole(row.role)) {
        return { error: 'USER_NOT_FOUND' };
    }
    if (isLeader(row.role)) {
        return { error: 'ROLE_ALREADY_INCLUDES_PERMISSION' };
    }
    if (enabled) {
        await db.query(
            `INSERT INTO user_permissions (user_id, permission, granted_by) VALUES ($1, $2, $3)
             ON CONFLICT (user_id, permission) DO NOTHING`,
            [targetUserId, permission, actor.sub]
        );
    } else {
        await db.query('DELETE FROM user_permissions WHERE user_id = $1 AND permission = $2', [
            targetUserId,
            permission
        ]);
    }
    return { permissions: await grantedFor(targetUserId) };
}

module.exports = {
    PERMISSIONS,
    PERMISSION_LABELS,
    EXECUTIVE_ROLES,
    LEADER_ROLES,
    isExecutive,
    isLeader,
    isValidPermission,
    grantedFor,
    grantedMap,
    has,
    capabilitiesFor,
    setPermission
};
