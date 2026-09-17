const db = require('../config/database');
const format = require('../utils/persianFormat.util');
const { HIDDEN_ROLE } = require('../config/visibility');
const capabilityService = require('./capability.service');
const userService = require('./user.service');

const ASSIGNABLE_ROLES = ['employee', 'manager'];

function avatarUrlOf(row) {
    if (!row.avatar_path) {
        return null;
    }
    const version = row.avatar_updated_at ? new Date(row.avatar_updated_at).getTime() : 0;
    return `/api/avatars/user/${row.id}?v=${version}`;
}

function presenceOf(row, now) {
    if (row.presence_status !== 'online') {
        return 'offline';
    }
    return row.dnd_enabled && (!row.dnd_until || new Date(row.dnd_until) > now) ? 'away' : 'online';
}

function lastSeenLabel(row, presence, now) {
    if (presence !== 'offline') {
        return 'هم‌اکنون';
    }
    if (!row.last_seen_at) {
        return 'هنوز وارد نشده';
    }
    return format.relativeTime(new Date(row.last_seen_at), now);
}

function serialize(row, permissions, now = new Date()) {
    const presence = presenceOf(row, now);
    return {
        userId: row.id,
        name: row.full_name,
        phone: row.phone,
        jobTitle: row.job_title || null,
        unit: row.unit || null,
        presence,
        lastSeen: lastSeenLabel(row, presence, now),
        neverSignedIn: !row.last_seen_at,
        initials: format.initials(row.full_name),
        role: row.role,
        roleLabel: userService.ROLE_LABELS[row.role] || row.role,
        tagId: row.tag_id || null,
        tag: row.tag_name || null,
        managerId: row.manager_id || null,
        manager: row.manager_name || null,
        avatarUrl: avatarUrlOf(row),
        permissions: permissions || [],
        roleGrantsAll: capabilityService.isLeader(row.role)
    };
}

function scopeCondition(viewer) {
    if (capabilityService.isExecutive(viewer.role)) {
        return { condition: 'u.id <> $1', params: [viewer.sub] };
    }
    return { condition: 'u.manager_id = $1', params: [viewer.sub] };
}

async function listMembers(viewer) {
    const scope = scopeCondition(viewer);
    const result = await db.query(
        `SELECT u.id, u.full_name, u.phone, u.job_title, u.unit, u.role, u.tag_id, u.manager_id,
                u.avatar_path, u.avatar_updated_at, u.dnd_enabled, u.dnd_until,
                p.status AS presence_status, p.last_seen_at,
                t.name AS tag_name, m.full_name AS manager_name
         FROM users u
         LEFT JOIN tags t ON t.id = u.tag_id
         LEFT JOIN users m ON m.id = u.manager_id
         LEFT JOIN presence p ON p.user_id = u.id
         WHERE ${scope.condition} AND u.is_active = true AND u.is_bot = false AND u.role <> $${scope.params.length + 1}
         ORDER BY u.full_name`,
        [...scope.params, HIDDEN_ROLE]
    );
    const grants = await capabilityService.grantedMap(result.rows.map((row) => row.id));
    const now = new Date();
    return result.rows.map((row) => serialize(row, grants.get(row.id), now));
}

async function listTags() {
    const result = await db.query('SELECT id, name FROM tags ORDER BY name');
    return result.rows.map((row) => ({ tagId: row.id, name: row.name }));
}

async function inScope(viewer, userId) {
    const scope = scopeCondition(viewer);
    const result = await db.query(
        `SELECT 1 FROM users u WHERE u.id = $${scope.params.length + 1} AND ${scope.condition}
           AND u.is_active = true AND u.is_bot = false AND u.role <> $${scope.params.length + 2}`,
        [...scope.params, userId, HIDDEN_ROLE]
    );
    return result.rows.length > 0;
}

async function setTag(viewer, userId, tagId) {
    if (!(await inScope(viewer, userId))) {
        return { error: 'FORBIDDEN' };
    }
    if (tagId !== null) {
        const tag = await db.query('SELECT 1 FROM tags WHERE id = $1', [tagId]);
        if (!tag.rows[0]) {
            return { error: 'TAG_NOT_FOUND' };
        }
    }
    await db.query('UPDATE users SET tag_id = $2 WHERE id = $1', [userId, tagId]);
    return { updated: true };
}

async function setJobTitle(viewer, userId, jobTitle) {
    if (!capabilityService.isExecutive(viewer.role)) {
        return { error: 'FORBIDDEN' };
    }
    if (!(await inScope(viewer, userId))) {
        return { error: 'FORBIDDEN' };
    }
    const value = String(jobTitle || '').trim().slice(0, 80);
    await db.query('UPDATE users SET job_title = $2 WHERE id = $1', [userId, value || null]);
    return { jobTitle: value || null };
}

async function setPermission(viewer, userId, permission, enabled) {
    if (!capabilityService.isExecutive(viewer.role)) {
        return { error: 'FORBIDDEN' };
    }
    if (!(await inScope(viewer, userId))) {
        return { error: 'FORBIDDEN' };
    }
    return capabilityService.setPermission(userId, permission, enabled, viewer);
}

async function setRole(viewer, userId, role) {
    if (!capabilityService.isExecutive(viewer.role)) {
        return { error: 'FORBIDDEN' };
    }
    if (!ASSIGNABLE_ROLES.includes(role)) {
        return { error: 'INVALID_ROLE' };
    }
    if (!(await inScope(viewer, userId))) {
        return { error: 'FORBIDDEN' };
    }
    await db.query('UPDATE users SET role = $2 WHERE id = $1', [userId, role]);
    if (role === 'manager') {
        await db.query('DELETE FROM user_permissions WHERE user_id = $1', [userId]);
    }
    return { updated: true };
}

module.exports = {
    ASSIGNABLE_ROLES,
    listMembers,
    listTags,
    inScope,
    setTag,
    setJobTitle,
    setPermission,
    setRole
};
