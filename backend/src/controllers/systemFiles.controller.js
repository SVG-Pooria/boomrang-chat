const systemFiles = require('../services/systemFiles.service');
const forwardMonitor = require('../services/forwardMonitor.service');
const adminAudit = require('../services/adminAudit.service');

function parseId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

async function listFiles(req, res) {
    const scope = systemFiles.SCOPES.includes(req.query.scope) ? req.query.scope : null;
    const files = await systemFiles.list({ scope, search: req.query.search });
    return res.status(200).json({ files });
}

async function deleteFile(req, res) {
    const fileId = parseId(req.params.id);
    if (!fileId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const removed = await systemFiles.remove(fileId);
    if (!removed) {
        return res.status(404).json({ error: 'FILE_NOT_FOUND' });
    }
    await adminAudit.record(req.user.sub, 'file.deleted', `${removed.name} — ${removed.place}`, {
        fileId,
        scope: removed.scope,
        backupCopyRemoved: removed.backupCopyRemoved,
        backupMirrorConfigured: removed.backupMirrorConfigured
    });
    return res.status(200).json({
        deleted: true,
        backupCopyRemoved: removed.backupCopyRemoved,
        backupMirrorConfigured: removed.backupMirrorConfigured
    });
}

async function forwardQueue(req, res) {
    return res.status(200).json(await forwardMonitor.overview());
}

async function retryForward(req, res) {
    const id = parseId(req.params.id);
    if (!id) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const retried = await forwardMonitor.retry(id);
    if (!retried) {
        return res.status(404).json({ error: 'DEAD_LETTER_NOT_FOUND' });
    }
    await adminAudit.record(req.user.sub, 'forward.retried', `کانال #${retried.channel} → گروه ${retried.group}`, {
        deadLetterId: id
    });
    return res.status(200).json({ retried: true });
}

async function discardForward(req, res) {
    const id = parseId(req.params.id);
    if (!id) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const discarded = await forwardMonitor.discard(id);
    if (!discarded) {
        return res.status(404).json({ error: 'DEAD_LETTER_NOT_FOUND' });
    }
    await adminAudit.record(req.user.sub, 'forward.discarded', `کانال #${discarded.channel} → گروه ${discarded.group}`, {
        deadLetterId: id
    });
    return res.status(200).json({ discarded: true });
}

module.exports = { listFiles, deleteFile, forwardQueue, retryForward, discardForward };
