const summaryService = require('../services/summary.service');
const targetService = require('../services/workspaceTarget.service');
const complianceService = require('../services/compliance.service');
const notifier = require('../socket/notifier');
const permissionMatrix = require('../services/channelGroupPermission.service');
const asyncHandler = require('../utils/asyncHandler');

const MAX_MANUAL_BULLETS = 5;
const MAX_MANUAL_BULLET_CHARS = 300;

function parseId(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function requireMember(req, res, next) {
    const { targetType } = req.params;
    const targetId = parseId(req.params.targetId);
    if (!targetService.isValidTargetType(targetType) || !targetId) {
        return res.status(400).json({ error: 'INVALID_TARGET' });
    }
    const membership = await targetService.getMembership(targetType, targetId, req.user.sub);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    req.summaryTarget = { targetType, targetId, membership };
    return next();
}

function curationError(target) {
    if (target.targetType === 'conversation') {
        return target.membership.role_in_conv === 'read_only' ? 'ACTION_NOT_PERMITTED' : null;
    }
    try {
        permissionMatrix.assertCan(target.membership, 'pin_messages');
        return null;
    } catch (err) {
        if (err instanceof permissionMatrix.PermissionError) {
            return err.code;
        }
        throw err;
    }
}

async function getSummary(req, res) {
    const { targetType, targetId } = req.summaryTarget;
    const summary = await summaryService.getSummary(targetType, targetId);
    return res.status(200).json({ summary });
}

async function refreshSummary(req, res) {
    const { targetType, targetId } = req.summaryTarget;
    const current = await summaryService.readSummary(targetType, targetId);
    if (current && current.isManual) {
        return res.status(409).json({ error: 'SUMMARY_PINNED' });
    }
    if (!(await summaryService.claimRefreshSlot(targetType, targetId))) {
        return res.status(429).json({
            error: 'REFRESH_RATE_LIMITED',
            retryAfterSeconds: summaryService.REFRESH_COOLDOWN_SECONDS
        });
    }
    const summary = await summaryService.forceRefresh(targetType, targetId);
    return res.status(200).json({ summary });
}

async function publishSummary(req, res) {
    const target = req.summaryTarget;
    const denied = curationError(target);
    if (denied) {
        return res.status(403).json({ error: denied });
    }
    const { bullets } = req.body || {};
    if (!Array.isArray(bullets) || bullets.length === 0 || bullets.length > MAX_MANUAL_BULLETS) {
        return res.status(400).json({ error: 'INVALID_BULLETS' });
    }
    if (
        bullets.some(
            (line) => typeof line !== 'string' || !line.trim() || line.length > MAX_MANUAL_BULLET_CHARS
        )
    ) {
        return res.status(400).json({ error: 'INVALID_BULLETS' });
    }
    const summary = await summaryService.publishManual(
        target.targetType,
        target.targetId,
        req.user.sub,
        bullets.map((line) => line.trim())
    );
    const name = await targetService.displayName(target.targetType, target.targetId, req.user.sub);
    await complianceService.record(req.user.sub, 'summary.published', `انتشار خلاصهٔ دستی برای ${name}`, {
        targetType: target.targetType,
        targetId: target.targetId
    });
    if (target.targetType !== 'conversation') {
        await complianceService.recordTeamActivity(req.user.sub, 'report.published', `خلاصهٔ ${name} را منتشر کرد`, {
            targetType: target.targetType,
            targetId: target.targetId
        });
    }
    return res.status(200).json({ summary });
}

async function sendSummary(req, res) {
    const target = req.summaryTarget;
    const name = await targetService.displayName(target.targetType, target.targetId, req.user.sub);
    const sent = await summaryService.sendReport(
        target.targetType,
        target.targetId,
        req.user.sub,
        name
    );
    if (!sent) {
        return res.status(409).json({ error: 'SUMMARY_EMPTY' });
    }
    if (!sent.repeated) {
        await complianceService.record(req.user.sub, 'summary.sent', `ارسال خلاصهٔ ${name} برای مدیریت`, {
            targetType: target.targetType,
            targetId: target.targetId,
            reportId: sent.reportId
        });
        notifier.notifyWorkspaceChanged('reports');
    }
    return res.status(200).json({ reportId: sent.reportId });
}

async function clearManual(req, res) {
    const target = req.summaryTarget;
    const denied = curationError(target);
    if (denied) {
        return res.status(403).json({ error: denied });
    }
    const result = await summaryService.clearManual(target.targetType, target.targetId);
    if (result.cleared) {
        const name = await targetService.displayName(target.targetType, target.targetId, req.user.sub);
        await complianceService.record(
            req.user.sub,
            'summary.unpinned',
            `بازگشت خلاصهٔ ${name} به حالت خودکار`,
            { targetType: target.targetType, targetId: target.targetId }
        );
    }
    return res.status(200).json({ summary: result.summary });
}

module.exports = {
    requireMember: asyncHandler(requireMember),
    getSummary: asyncHandler(getSummary),
    refreshSummary: asyncHandler(refreshSummary),
    publishSummary: asyncHandler(publishSummary),
    sendSummary: asyncHandler(sendSummary),
    clearManual: asyncHandler(clearManual)
};
