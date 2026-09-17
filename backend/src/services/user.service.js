const db = require('../config/database');
const cryptoUtil = require('../utils/crypto.util');
const channelService = require('./channel.service');
const userExportService = require('./userExport.service');
const presenceService = require('./presence.service');
const sessionService = require('./session.service');
const adminAudit = require('./adminAudit.service');
const { HIDDEN_ROLE, isHiddenRole } = require('../config/visibility');

const CREATABLE_ROLES = ['employee', 'manager', 'management', 'super_admin'];
const CHANGEABLE_ROLES = ['employee'];
const ROLE_LABELS = { employee: 'کارمند', manager: 'مدیر', management: 'هیئت مدیره', super_admin: 'ادمین کل' };
const DND_LABEL_MAX_LENGTH = 60;

function isDndCurrentlyActive(row) {
    if (!row.dnd_enabled) {
        return false;
    }
    if (!row.dnd_until) {
        return true;
    }
    return new Date(row.dnd_until).getTime() > Date.now();
}

function buildAvatarUrl(row) {
    if (!row.avatar_path) {
        return null;
    }
    const version = row.avatar_updated_at ? new Date(row.avatar_updated_at).getTime() : 0;
    return `/api/avatars/user/${row.id}?v=${version}`;
}

function toPublicUser(row) {
    return {
        id: row.id,
        fullName: row.full_name,
        phone: row.phone,
        role: row.role,
        tagId: row.tag_id,
        isActive: row.is_active,
        hasPassword: Boolean(row.password_encrypted),
        dndEnabled: isDndCurrentlyActive(row),
        dndLabel: row.dnd_label || null,
        dndUntil: row.dnd_until,
        avatarUrl: buildAvatarUrl(row),
        createdAt: row.created_at
    };
}

const DIRECTORY_ROLES = ['employee', 'manager', 'management'];

async function listDirectory() {
    const result = await db.query(
        `SELECT u.id, u.full_name, u.phone, u.role, u.tag_id, t.name AS tag_name,
                u.dnd_enabled, u.dnd_label, u.dnd_until, u.avatar_path, u.avatar_updated_at
         FROM users u
         LEFT JOIN tags t ON t.id = u.tag_id
         WHERE u.is_active = true AND u.is_bot = false AND u.role = ANY($1::varchar[])
         ORDER BY u.full_name`,
        [DIRECTORY_ROLES]
    );
    return result.rows.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        phone: row.phone,
        role: row.role,
        tagId: row.tag_id,
        tagName: row.tag_name,
        dndEnabled: isDndCurrentlyActive(row),
        dndLabel: row.dnd_label || null,
        dndUntil: row.dnd_until,
        avatarUrl: buildAvatarUrl(row)
    }));
}

async function listUsers({ role, tagId, requesterRole } = {}) {
    const params = [];
    let condition = 'is_bot = false';
    if (role) {
        params.push(role);
        condition += ` AND role = $${params.length}`;
    }
    if (tagId) {
        params.push(tagId);
        condition += ` AND tag_id = $${params.length}`;
    }
    if (!isHiddenRole(requesterRole)) {
        params.push(HIDDEN_ROLE);
        condition += ` AND role != $${params.length}`;
    }
    const result = await db.query(`SELECT * FROM users WHERE ${condition} ORDER BY full_name`, params);
    return result.rows.map(toPublicUser);
}

async function createUser({ fullName, phone, role, tagId, password }) {
    if (!CREATABLE_ROLES.includes(role)) {
        throw new Error('INVALID_ROLE');
    }
    const encrypted = password ? cryptoUtil.encrypt(password) : null;
    const result = await db.query(
        `INSERT INTO users (full_name, phone, role, tag_id, password_encrypted, password_set_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [fullName, phone, role, tagId || null, encrypted, encrypted ? new Date() : null]
    );
    const user = result.rows[0];
    await channelService.ensureSystemChannelMembership(user.id, user.role);
    return toPublicUser(user);
}

async function countActiveSuperAdmins() {
    const result = await db.query(
        `SELECT count(*)::int AS count FROM users WHERE role = 'super_admin' AND is_active = true`
    );
    return result.rows[0].count;
}

async function setActive(userId, isActive, actor = null) {
    const existing = await getUserById(userId);
    if (!existing || existing.is_bot) {
        return null;
    }
    if (!isActive && actor) {
        if (Number(userId) === Number(actor.sub)) {
            throw new Error('CANNOT_DISABLE_SELF');
        }
        if (existing.role === 'super_admin' && existing.is_active && (await countActiveSuperAdmins()) <= 1) {
            throw new Error('LAST_SUPER_ADMIN');
        }
    }
    const result = await db.query('UPDATE users SET is_active = $1 WHERE id = $2 RETURNING *', [isActive, userId]);
    if (!isActive) {
        await sessionService.revokeForUser(userId, actor ? actor.sub : null);
        await presenceService.markOffline(userId);
    }
    return toPublicUser(result.rows[0]);
}

async function setTag(userId, tagId) {
    const result = await db.query(
        `UPDATE users SET tag_id = $1 WHERE id = $2
         RETURNING *, (SELECT name FROM tags WHERE id = $1) AS tag_name`,
        [tagId || null, userId]
    );
    const row = result.rows[0];
    return row ? { ...toPublicUser(row), tagName: row.tag_name || null } : null;
}

async function changeRole(userId, newRole, actor = null) {
    const existing = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    const current = existing.rows[0];
    if (!current || current.is_bot) {
        throw new Error('USER_NOT_FOUND');
    }
    if (actor && isHiddenRole(actor.role)) {
        if (!CREATABLE_ROLES.includes(newRole)) {
            throw new Error('ROLE_NOT_ALLOWED');
        }
        if (Number(userId) === Number(actor.sub)) {
            throw new Error('CANNOT_CHANGE_OWN_ROLE');
        }
        if (current.role === 'super_admin' && newRole !== 'super_admin' && (await countActiveSuperAdmins()) <= 1) {
            throw new Error('LAST_SUPER_ADMIN');
        }
    } else if (!CHANGEABLE_ROLES.includes(newRole) || !CHANGEABLE_ROLES.includes(current.role)) {
        throw new Error('ROLE_NOT_ALLOWED');
    }
    const result = await db.query('UPDATE users SET role = $1 WHERE id = $2 RETURNING *', [newRole, userId]);
    const user = result.rows[0];
    await channelService.ensureSystemChannelMembership(user.id, user.role);
    return { user: toPublicUser(user), previousRole: current.role, fullName: current.full_name };
}

async function getSelfStatus(userId) {
    const result = await db.query(
        'SELECT dnd_enabled, dnd_label, dnd_until FROM users WHERE id = $1',
        [userId]
    );
    const row = result.rows[0];
    if (!row) {
        return null;
    }
    return {
        dndEnabled: isDndCurrentlyActive(row),
        dndLabel: row.dnd_label || null,
        dndUntil: row.dnd_until
    };
}

async function updateSelfStatus(userId, { enabled, label, until }) {
    const normalizedLabel = label ? label.trim().slice(0, DND_LABEL_MAX_LENGTH) : null;
    const result = await db.query(
        `UPDATE users SET dnd_enabled = $1, dnd_label = $2, dnd_until = $3
         WHERE id = $4 RETURNING dnd_enabled, dnd_label, dnd_until`,
        [Boolean(enabled), enabled ? normalizedLabel : null, enabled ? until || null : null, userId]
    );
    const row = result.rows[0];
    if (!row) {
        return null;
    }
    return {
        dndEnabled: isDndCurrentlyActive(row),
        dndLabel: row.dnd_label || null,
        dndUntil: row.dnd_until
    };
}

async function getUserById(userId) {
    const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    return result.rows[0] || null;
}

async function countSuperAdmins() {
    const result = await db.query(
        `SELECT count(*)::int AS count FROM users WHERE role = 'super_admin'`
    );
    return result.rows[0].count;
}

async function hardDeleteUser(userId, { adminId, withBackup } = {}) {
    if (Number(userId) === Number(adminId)) {
        throw new Error('CANNOT_DELETE_SELF');
    }

    const existing = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    const target = existing.rows[0];
    if (!target) {
        throw new Error('USER_NOT_FOUND');
    }

    if (target.role === 'super_admin') {
        const remaining = await countSuperAdmins();
        if (remaining <= 1) {
            throw new Error('LAST_SUPER_ADMIN');
        }
    }

    let archive = null;
    if (withBackup) {
        archive = await userExportService.exportUserArchive(userId, adminId);
    }

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const deleted = await client.query('DELETE FROM users WHERE id = $1 RETURNING *', [userId]);
        if (!deleted.rows[0]) {
            await client.query('ROLLBACK');
            throw new Error('USER_NOT_FOUND');
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    require('../socket/notifier').endUserSockets(userId);
    if (archive) {
        await userExportService.markDeleted(archive.id);
    }

    await adminAudit.record(adminId, 'user.deleted', `${target.full_name} — ${target.phone}`, {
        targetUserId: userId,
        targetRole: target.role,
        withBackup: Boolean(withBackup),
        archiveId: archive ? archive.id : null
    });

    return { deleted: true, archive };
}

async function listOnlineUserIds() {
    const result = await db.query(
        `SELECT p.user_id
         FROM presence p
         JOIN users u ON u.id = p.user_id
         WHERE p.status = 'online' AND u.is_active = true AND u.is_bot = false AND u.role <> $1`,
        [HIDDEN_ROLE]
    );
    return result.rows.map((row) => row.user_id);
}

module.exports = {
    CREATABLE_ROLES,
    CHANGEABLE_ROLES,
    ROLE_LABELS,
    DIRECTORY_ROLES,
    DND_LABEL_MAX_LENGTH,
    listUsers,
    listDirectory,
    listOnlineUserIds,
    createUser,
    setActive,
    setTag,
    changeRole,
    getSelfStatus,
    updateSelfStatus,
    toPublicUser,
    getUserById,
    hardDeleteUser
};
