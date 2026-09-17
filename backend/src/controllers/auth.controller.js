const authService = require('../services/auth.service');
const loginRateLimitService = require('../services/loginRateLimit.service');
const attemptLimit = require('../services/attemptLimit.service');
const passwordService = require('../services/password.service');
const activityLogService = require('../services/activityLog.service');
const adminAudit = require('../services/adminAudit.service');
const sessionService = require('../services/session.service');
const capabilityService = require('../services/capability.service');
const format = require('../utils/persianFormat.util');

const PHONE_PATTERN = /^09\d{9}$/;

function isValidPhone(phone) {
    return typeof phone === 'string' && PHONE_PATTERN.test(phone);
}

function clientIp(req) {
    return req.ip || req.connection?.remoteAddress || 'unknown';
}

function sessionContext(req) {
    return { userAgent: req.get('user-agent'), ip: clientIp(req) };
}

async function recordLockout(phone, ip, failures) {
    const phoneLocked = failures.phoneAttempts === loginRateLimitService.MAX_ATTEMPTS_PER_PHONE;
    const ipLocked = failures.ipAttempts === loginRateLimitService.MAX_ATTEMPTS_PER_IP;
    if (!phoneLocked && !ipLocked) {
        return;
    }
    const account = await authService.findUserByPhone(phone);
    const displayIp = String(ip).replace(/^::ffff:/, '');
    const target = phoneLocked
        ? `${format.toPersianDigits(failures.phoneAttempts)} تلاش ناموفق پیاپی برای ${phone}`
        : `${format.toPersianDigits(failures.ipAttempts)} تلاش ناموفق از نشانی ${displayIp}`;
    await adminAudit.record(account && !account.is_bot ? account.id : null, 'auth.login_blocked', target, {
        phone,
        ip: displayIp
    });
}

async function login(req, res) {
    const { phone, password } = req.body || {};
    if (!isValidPhone(phone)) {
        return res.status(400).json({ error: 'INVALID_PHONE' });
    }
    const ip = clientIp(req);
    const limit = await loginRateLimitService.check(phone, ip);
    if (!limit.allowed) {
        return res.status(429).json({
            error: 'TOO_MANY_ATTEMPTS',
            retryAfterSeconds: limit.retryAfterSeconds
        });
    }
    try {
        const result = await authService.login(phone, password, sessionContext(req));
        if (result.needsSetup) {
            return res.status(200).json({ needsSetup: true });
        }
        await loginRateLimitService.clearFailures(phone, ip);
        return res.status(200).json(result);
    } catch (err) {
        if (err.message === 'INVALID_CREDENTIALS') {
            const failures = await loginRateLimitService.registerFailure(phone, ip);
            await recordLockout(phone, ip, failures);
            return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
        }

        console.error(`[auth.controller] Unexpected error logging in phone ${phone}:`, err);
        return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
}

async function currentUser(req, res) {
    const user = await authService.findUserByPhone(req.user.phone);
    if (!user) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    const capabilities = await capabilityService.capabilitiesFor(req.user);
    return res.status(200).json({ user: authService.toPublicUser(user), capabilities });
}

async function setPassword(req, res) {
    const { phone, newPassword, confirmPassword } = req.body || {};
    if (!isValidPhone(phone)) {
        return res.status(400).json({ error: 'INVALID_PHONE' });
    }
    const ipLimit = await attemptLimit.consume(attemptLimit.LIMITS.initialSetupByIp, clientIp(req));
    const limit = ipLimit.allowed
        ? await attemptLimit.consume(attemptLimit.LIMITS.initialSetupByPhone, phone)
        : ipLimit;
    if (!limit.allowed) {
        return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', retryAfterSeconds: limit.retryAfterSeconds });
    }
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'WEAK_PASSWORD' });
    }
    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'PASSWORD_MISMATCH' });
    }
    try {
        const result = await authService.completeInitialSetup(phone, newPassword, sessionContext(req));
        return res.status(200).json(result);
    } catch (err) {
        if (err.message === 'USER_NOT_FOUND') {
            return res.status(404).json({ error: 'USER_NOT_FOUND' });
        }
        if (err.message === 'PASSWORD_ALREADY_SET') {
            return res.status(409).json({ error: 'PASSWORD_ALREADY_SET' });
        }
        console.error(`[auth.controller] Unexpected error during initial password setup for phone ${phone}:`, err);
        return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
}

async function changePassword(req, res) {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'WEAK_PASSWORD' });
    }
    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'PASSWORD_MISMATCH' });
    }
    const limit = await attemptLimit.check(attemptLimit.LIMITS.passwordCheckByUser, req.user.sub);
    if (!limit.allowed) {
        return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', retryAfterSeconds: limit.retryAfterSeconds });
    }
    try {
        await passwordService.changePassword(req.user.sub, currentPassword || '', newPassword);
        await attemptLimit.clear(attemptLimit.LIMITS.passwordCheckByUser, req.user.sub);
        await sessionService.revokeOtherSessions(req.user.sub, req.user.sessionId);
        return res.status(200).json({ success: true });
    } catch (err) {
        if (err.message === 'CURRENT_PASSWORD_INVALID') {
            await attemptLimit.registerFailure(attemptLimit.LIMITS.passwordCheckByUser, req.user.sub);
            return res.status(401).json({ error: 'CURRENT_PASSWORD_INVALID' });
        }
        console.error(`[auth.controller] Unexpected error changing password for user ${req.user.sub}:`, err);
        return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
}

async function verifyPassword(req, res) {
    const { password } = req.body || {};
    if (!password) {
        return res.status(400).json({ error: 'INVALID_PASSWORD' });
    }
    const limit = await attemptLimit.check(attemptLimit.LIMITS.passwordCheckByUser, req.user.sub);
    if (!limit.allowed) {
        return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', retryAfterSeconds: limit.retryAfterSeconds });
    }
    const isValid = await passwordService.verifyPassword(req.user.sub, password);
    if (!isValid) {
        await attemptLimit.registerFailure(attemptLimit.LIMITS.passwordCheckByUser, req.user.sub);
        await activityLogService.log(req.user.sub, 'user.reauth_failed', {});
        return res.status(401).json({ error: 'INVALID_PASSWORD' });
    }
    await attemptLimit.clear(attemptLimit.LIMITS.passwordCheckByUser, req.user.sub);
    await sessionService.markReauthenticated(req.user.sessionId);
    await activityLogService.log(req.user.sub, 'user.reauth_succeeded', {});
    return res.status(200).json({ verified: true });
}

async function logout(req, res) {
    await authService.logout(req.user.sub, req.user.sessionId);
    return res.status(200).json({ success: true });
}

module.exports = { login, currentUser, setPassword, changePassword, verifyPassword, logout };
