const chatPinService = require('../services/chatPin.service');

async function list(req, res) {
    return res.status(200).json({ pins: await chatPinService.listForUser(req.user.sub) });
}

async function update(req, res) {
    const { scope, targetType, targetId, pinned } = req.body || {};
    const id = Number(targetId);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: 'INVALID_TARGET' });
    }
    const result = await chatPinService.setPin(req.user.sub, scope, targetType, id, Boolean(pinned));
    if (result.error) {
        return res.status(400).json({ error: result.error });
    }
    return res.status(200).json(result);
}

module.exports = { list, update };
