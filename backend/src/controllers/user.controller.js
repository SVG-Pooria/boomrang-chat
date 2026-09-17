const userService = require('../services/user.service');
const sessionService = require('../services/session.service');
const activityLogService = require('../services/activityLog.service');
const adminAudit = require('../services/adminAudit.service');

const PHONE_PATTERN = /^09\d{9}$/;
const GUARDED_USER_ERRORS = ['CANNOT_DISABLE_SELF', 'CANNOT_CHANGE_OWN_ROLE', 'LAST_SUPER_ADMIN', 'ROLE_NOT_ALLOWED'];

function isValidPhone(phone) {
    return typeof phone === 'string' && PHONE_PATTERN.test(phone);
}

function isValidUntil(value) {
    if (value === null || value === undefined) {
        return true;
    }
    if (typeof value !== 'string') {
        return false;
    }
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime());
}

async function listDirectory(req, res) {
    const users = await userService.listDirectory();
    return res.status(200).json({ users });
}

async function listPresence(req, res) {
    const online = await userService.listOnlineUserIds();
    return res.status(200).json({ online });
}

async function listUsers(req, res) {
    const { role, tagId } = req.query;
    const users = await userService.listUsers({
        role: role || null,
        tagId: tagId ? Number(tagId) : null,
        requesterRole: req.user.role
    });
    return res.status(200).json({ users });
}

async function createUser(req, res) {
    const { fullName, phone, role, tagId, password } = req.body || {};
    if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
        return res.status(400).json({ error: 'INVALID_FULL_NAME' });
    }
    if (!isValidPhone(phone)) {
        return res.status(400).json({ error: 'INVALID_PHONE' });
    }
    if (!userService.CREATABLE_ROLES.includes(role)) {
        return res.status(400).json({ error: 'INVALID_ROLE' });
    }
    if (password && password.length < 6) {
        return res.status(400).json({ error: 'WEAK_PASSWORD' });
    }
    try {
        const user = await userService.createUser({
            fullName: fullName.trim(),
            phone,
            role,
            tagId: tagId ? Number(tagId) : null,
            password: password || null
        });
        await adminAudit.record(req.user.sub, 'user.created', `${user.fullName} — ${userService.ROLE_LABELS[user.role]}`, {
            userId: user.id,
            role: user.role
        });
        return res.status(201).json({ user });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'PHONE_ALREADY_EXISTS' });
        }
        if (err.code === '23503') {
            return res.status(400).json({ error: 'INVALID_TAG' });
        }
        throw err;
    }
}

async function setActive(req, res) {
    const userId = Number(req.params.id);
    const { isActive } = req.body || {};
    if (!Number.isInteger(userId) || typeof isActive !== 'boolean') {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    let user;
    try {
        user = await userService.setActive(userId, isActive, req.user);
    } catch (err) {
        if (GUARDED_USER_ERRORS.includes(err.message)) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    if (!user) {
        return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }
    await adminAudit.record(req.user.sub, isActive ? 'user.enabled' : 'user.disabled', user.fullName, { userId });
    return res.status(200).json({ user });
}

async function setTag(req, res) {
    const userId = Number(req.params.id);
    const { tagId } = req.body || {};
    if (!Number.isInteger(userId)) {
        return res.status(400).json({ error: 'INVALID_USER_ID' });
    }
    if (tagId !== null && tagId !== undefined && !Number.isInteger(Number(tagId))) {
        return res.status(400).json({ error: 'INVALID_TAG' });
    }
    try {
        const user = await userService.setTag(userId, tagId ? Number(tagId) : null);
        if (!user) {
            return res.status(404).json({ error: 'USER_NOT_FOUND' });
        }
        await adminAudit.record(req.user.sub, 'user.tag_changed', `${user.fullName} — ${user.tagName || 'بدون تگ'}`, {
            userId,
            tagId: user.tagId
        });
        return res.status(200).json({ user });
    } catch (err) {
        if (err.code === '23503') {
            return res.status(400).json({ error: 'INVALID_TAG' });
        }
        throw err;
    }
}

async function changeRole(req, res) {
    const userId = Number(req.params.id);
    const { role } = req.body || {};
    if (!Number.isInteger(userId)) {
        return res.status(400).json({ error: 'INVALID_USER_ID' });
    }
    try {
        const { user, previousRole, fullName } = await userService.changeRole(userId, role, req.user);
        if (previousRole !== user.role) {
            await sessionService.revokeForUser(userId, req.user.sub);
            await adminAudit.record(
                req.user.sub,
                'user.role_changed',
                `${fullName}: ${userService.ROLE_LABELS[previousRole]} ← ${userService.ROLE_LABELS[user.role]}`,
                { userId, previousRole, role: user.role }
            );
        }
        return res.status(200).json({ user });
    } catch (err) {
        if (err.message === 'USER_NOT_FOUND') {
            return res.status(404).json({ error: 'USER_NOT_FOUND' });
        }
        if (GUARDED_USER_ERRORS.includes(err.message)) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
}

async function hardDeleteUser(req, res) {
    const userId = Number(req.params.id);
    const { confirmName, withBackup } = req.body || {};
    if (!Number.isInteger(userId)) {
        return res.status(400).json({ error: 'INVALID_USER_ID' });
    }
    if (typeof confirmName !== 'string' || !confirmName.trim()) {
        return res.status(400).json({ error: 'CONFIRM_NAME_REQUIRED' });
    }
    if (typeof withBackup !== 'boolean') {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }

    const target = await userService.getUserById(userId);
    if (!target) {
        return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }
    if (confirmName.trim() !== target.full_name) {
        return res.status(400).json({ error: 'CONFIRM_NAME_MISMATCH' });
    }

    try {
        const result = await userService.hardDeleteUser(userId, { adminId: req.user.sub, withBackup });
        const archive = result.archive
            ? { id: result.archive.id, downloadUrl: `/api/admin/exports/${result.archive.id}/download` }
            : null;
        return res.status(200).json({ deleted: true, archive });
    } catch (err) {
        if (err.message === 'CANNOT_DELETE_SELF') {
            return res.status(403).json({ error: 'CANNOT_DELETE_SELF' });
        }
        if (err.message === 'USER_NOT_FOUND') {
            return res.status(404).json({ error: 'USER_NOT_FOUND' });
        }
        if (err.message === 'LAST_SUPER_ADMIN') {
            return res.status(403).json({ error: 'LAST_SUPER_ADMIN' });
        }
        console.error(`[hardDeleteUser] ${err.message}`, err);
        return res.status(500).json({ error: 'DELETE_FAILED' });
    }
}

async function getMyStatus(req, res) {
    const status = await userService.getSelfStatus(req.user.sub);
    if (!status) {
        return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }
    return res.status(200).json(status);
}

async function updateMyStatus(req, res) {
    const { enabled, label, until } = req.body || {};
    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    if (label !== undefined && label !== null && typeof label !== 'string') {
        return res.status(400).json({ error: 'INVALID_DND_LABEL' });
    }
    if (typeof label === 'string' && label.trim().length > userService.DND_LABEL_MAX_LENGTH) {
        return res.status(400).json({ error: 'INVALID_DND_LABEL' });
    }
    if (!isValidUntil(until)) {
        return res.status(400).json({ error: 'INVALID_DND_UNTIL' });
    }
    const status = await userService.updateSelfStatus(req.user.sub, { enabled, label, until });
    if (!status) {
        return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }
    await activityLogService.log(req.user.sub, 'user.status.updated', { enabled, label: label || null });
    return res.status(200).json(status);
}

module.exports = {
    listDirectory,
    listPresence,
    listUsers,
    createUser,
    setActive,
    setTag,
    changeRole,
    hardDeleteUser,
    getMyStatus,
    updateMyStatus
};
