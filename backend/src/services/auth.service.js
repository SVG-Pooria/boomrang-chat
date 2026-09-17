const db = require('../config/database');
const passwordService = require('./password.service');
const presenceService = require('./presence.service');
const activityLogService = require('./activityLog.service');
const sessionService = require('./session.service');

async function findUserByPhone(phone) {
    const result = await db.query(
        `SELECT u.*, t.name AS tag_name
         FROM users u
         LEFT JOIN tags t ON t.id = u.tag_id
         WHERE u.phone = $1`,
        [phone]
    );
    return result.rows[0] || null;
}

function avatarUrlOf(user) {
    if (!user.avatar_path) {
        return null;
    }
    const version = user.avatar_updated_at ? new Date(user.avatar_updated_at).getTime() : 0;
    return `/api/avatars/user/${user.id}?v=${version}`;
}

function toPublicUser(user) {
    return {
        id: user.id,
        fullName: user.full_name,
        role: user.role,
        phone: user.phone,
        tagId: user.tag_id,
        tagName: user.tag_name || null,
        avatarUrl: avatarUrlOf(user)
    };
}

async function login(phone, password, context) {
    const user = await findUserByPhone(phone);
    if (!user || !user.is_active || user.is_bot) {
        throw new Error('INVALID_CREDENTIALS');
    }
    if (!user.password_encrypted) {
        return { needsSetup: true };
    }
    const isValid = await passwordService.verifyPassword(user.id, password || '');
    if (!isValid) {
        throw new Error('INVALID_CREDENTIALS');
    }
    const token = await sessionService.issue(user, context);
    await presenceService.markOnline(user.id);
    await activityLogService.log(user.id, 'user.login', {});
    return {
        token,
        mustChangePassword: user.password_must_change,
        user: toPublicUser(user)
    };
}

async function completeInitialSetup(phone, newPassword, context) {
    const user = await findUserByPhone(phone);
    if (!user) {
        throw new Error('USER_NOT_FOUND');
    }
    if (user.password_encrypted) {
        throw new Error('PASSWORD_ALREADY_SET');
    }
    await passwordService.setInitialPassword(user.id, newPassword);
    await activityLogService.log(user.id, 'user.password.initial_setup', {});
    const token = await sessionService.issue(user, context);
    await presenceService.markOnline(user.id);
    return {
        token,
        user: toPublicUser(user)
    };
}

async function logout(userId, sessionId) {
    if (sessionId) {
        await sessionService.revoke(sessionId, userId);
    }
    await presenceService.markOffline(userId);
    await activityLogService.log(userId, 'user.logout', {});
}

module.exports = { login, completeInitialSetup, logout, findUserByPhone, toPublicUser };
