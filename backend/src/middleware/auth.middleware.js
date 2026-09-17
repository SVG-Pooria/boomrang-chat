const sessionService = require('../services/session.service');
const asyncHandler = require('../utils/asyncHandler');

async function requireAuthHandler(req, res, next) {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    const outcome = await sessionService.authenticate(token);
    if (outcome.error) {
        return res.status(401).json({ error: outcome.error });
    }
    const { row, sessionId } = outcome;
    req.user = {
        sub: row.id,
        fullName: row.full_name,
        phone: row.phone,
        role: row.role,
        tagId: row.tag_id,
        is_active: row.is_active,
        is_lock_enabled: row.is_lock_enabled,
        is_locked: row.is_locked,
        password_must_change: row.password_must_change,
        sessionId
    };
    sessionService.touch(sessionId).catch(() => {});
    return next();
}

module.exports = asyncHandler(requireAuthHandler);
