const chatHistory = require('../services/chatHistory.service');
const targetService = require('../services/workspaceTarget.service');
const asyncHandler = require('../utils/asyncHandler');

async function getPinned(req, res) {
    const { targetType } = req.params;
    const targetId = Number(req.params.targetId);
    if (!targetService.isValidTargetType(targetType) || !Number.isInteger(targetId) || targetId <= 0) {
        return res.status(400).json({ error: 'INVALID_TARGET' });
    }
    const membership = await targetService.getMembership(targetType, targetId, req.user.sub);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    const pinned = await chatHistory.pinned(targetType, targetId, req.user.sub);
    return res.status(200).json({ pinned });
}

module.exports = { getPinned: asyncHandler(getPinned) };
