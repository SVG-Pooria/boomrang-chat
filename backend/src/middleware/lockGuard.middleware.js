const OPEN_PREFIX = '/api/lock';

function lockGuard(req, res, next) {
    if (!req.user || !req.user.is_locked) {
        return next();
    }
    if (req.path.startsWith(OPEN_PREFIX)) {
        return next();
    }
    return res.status(423).json({ error: 'SCREEN_LOCKED' });
}

module.exports = lockGuard;
