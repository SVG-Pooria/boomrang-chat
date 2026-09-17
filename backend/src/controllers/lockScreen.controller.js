const db = require('../config/database');
const passwordService = require('../services/password.service');
const activityLogService = require('../services/activityLog.service');

async function lockMyScreen(req, res) {
    if (!req.user.is_lock_enabled) {
        return res.status(403).json({ error: 'LOCK_NOT_ENABLED' });
    }
    if (req.user.is_locked) {
        return res.status(200).json({ isLocked: true, alreadyLocked: true });
    }
    await db.query('UPDATE users SET is_locked = true, locked_at = now() WHERE id = $1', [req.user.sub]);
    await activityLogService.log(req.user.sub, 'user.lock', {});
    return res.status(200).json({ isLocked: true, alreadyLocked: false });
}

async function unlockMyScreen(req, res) {
    const { password } = req.body || {};
    if (!req.user.is_locked) {
        return res.status(200).json({ isLocked: false, alreadyUnlocked: true });
    }
    const isValid = await passwordService.verifyPassword(req.user.sub, password || '');
    if (!isValid) {
        return res.status(401).json({ error: 'INVALID_PASSWORD' });
    }
    await db.query('UPDATE users SET is_locked = false, unlocked_at = now() WHERE id = $1', [req.user.sub]);
    await activityLogService.log(req.user.sub, 'user.unlock', {});
    return res.status(200).json({ isLocked: false, alreadyUnlocked: false });
}

async function getStatus(req, res) {
    const result = await db.query('SELECT is_lock_enabled, is_locked FROM users WHERE id = $1', [req.user.sub]);
    const row = result.rows[0];
    return res.status(200).json({
        lockEnabled: row ? row.is_lock_enabled : false,
        isLocked: row ? row.is_locked : false
    });
}

module.exports = { lockMyScreen, unlockMyScreen, getStatus };
