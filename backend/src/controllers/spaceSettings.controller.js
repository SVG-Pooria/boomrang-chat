const spaceAdmin = require('../services/spaceAdmin.service');
const adminAudit = require('../services/adminAudit.service');
const { AdminConsoleError } = require('../services/adminConsole.service');
const format = require('../utils/persianFormat.util');

const SPACE_KINDS = ['channel', 'group'];
const SPACE_LABELS = { channel: 'کانال', group: 'گروه' };
const VISIBILITY_LABELS = { public: 'عمومی', private: 'خصوصی' };

function parseId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function parseSpace(req) {
    const id = parseId(req.params.id);
    return SPACE_KINDS.includes(req.params.kind) && id ? { kind: req.params.kind, id } : null;
}

function handleConsoleError(err, res) {
    if (err instanceof AdminConsoleError) {
        res.status(err.status).json({ error: err.code });
        return true;
    }
    return false;
}

function describeSpace(kind, title) {
    return `${SPACE_LABELS[kind]} ${title}`;
}

async function spaceDetails(req, res) {
    const target = parseSpace(req);
    if (!target) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    try {
        return res.status(200).json({ space: await spaceAdmin.details(target.kind, target.id) });
    } catch (err) {
        if (handleConsoleError(err, res)) return undefined;
        throw err;
    }
}

async function updateSpaceInfo(req, res) {
    const target = parseSpace(req);
    if (!target) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    try {
        const { before, after } = await spaceAdmin.updateInfo(target.kind, target.id, req.body || {});
        const changes = [];
        if (before.title !== after.title) {
            changes.push(`نام: ${before.title} ← ${after.title}`);
        }
        if ((before.description || '') !== (after.description || '')) {
            changes.push('توضیحات');
        }
        if (before.visibility !== after.visibility) {
            changes.push(`دسترسی: ${VISIBILITY_LABELS[before.visibility]} ← ${VISIBILITY_LABELS[after.visibility]}`);
        }
        if (changes.length) {
            await adminAudit.record(
                req.user.sub,
                `${target.kind}.updated`,
                `${describeSpace(target.kind, after.title)} — ${changes.join('، ')}`,
                { kind: target.kind, spaceId: target.id }
            );
        }
        return res.status(200).json({ space: await spaceAdmin.details(target.kind, target.id) });
    } catch (err) {
        if (handleConsoleError(err, res)) return undefined;
        throw err;
    }
}

async function uploadSpaceAvatar(req, res) {
    const target = parseSpace(req);
    if (!target) {
        await spaceAdmin.discardUpload(req.file);
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    try {
        const { space, avatarUrl } = await spaceAdmin.replaceAvatar(target.kind, target.id, req.file, req.user.sub);
        await adminAudit.record(
            req.user.sub,
            `${target.kind}.avatar_changed`,
            describeSpace(target.kind, space.title),
            { kind: target.kind, spaceId: target.id }
        );
        return res.status(200).json({ avatarUrl });
    } catch (err) {
        if (handleConsoleError(err, res)) return undefined;
        throw err;
    }
}

async function removeSpaceAvatar(req, res) {
    const target = parseSpace(req);
    if (!target) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    try {
        const space = await spaceAdmin.removeAvatar(target.kind, target.id);
        await adminAudit.record(
            req.user.sub,
            `${target.kind}.avatar_changed`,
            `${describeSpace(target.kind, space.title)} — حذف عکس`,
            { kind: target.kind, spaceId: target.id }
        );
        return res.status(200).json({ avatarUrl: null });
    } catch (err) {
        if (handleConsoleError(err, res)) return undefined;
        throw err;
    }
}

async function linkSpace(req, res) {
    const target = parseSpace(req);
    const targetId = parseId((req.body || {}).targetId);
    if (!target || !targetId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    try {
        const linked = await spaceAdmin.link(target.kind, target.id, targetId, req.user.sub);
        await adminAudit.record(
            req.user.sub,
            'space.linked',
            `کانال #${linked.channel_title} ↔ گروه ${linked.group_title}`,
            { channelId: linked.channelId, groupId: linked.groupId }
        );
        return res.status(200).json({ space: await spaceAdmin.details(target.kind, target.id) });
    } catch (err) {
        if (handleConsoleError(err, res)) return undefined;
        throw err;
    }
}

async function unlinkSpace(req, res) {
    const target = parseSpace(req);
    if (!target) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    try {
        const unlinked = await spaceAdmin.unlink(target.kind, target.id, req.user.sub);
        await adminAudit.record(
            req.user.sub,
            'space.unlinked',
            `کانال #${unlinked.channel_title} ↔ گروه ${unlinked.group_title}`,
            { channelId: unlinked.channelId, groupId: unlinked.groupId }
        );
        return res.status(200).json({ space: await spaceAdmin.details(target.kind, target.id) });
    } catch (err) {
        if (handleConsoleError(err, res)) return undefined;
        throw err;
    }
}

async function setMemberPermissions(req, res) {
    const target = parseSpace(req);
    const userId = parseId(req.params.userId);
    if (!target || !userId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    try {
        const result = await spaceAdmin.setMemberPermissions(
            target.kind,
            target.id,
            userId,
            (req.body || {}).permissions
        );
        if (result.changes.length) {
            await adminAudit.record(
                req.user.sub,
                `${target.kind}.member_permissions_changed`,
                `${result.name} — ${describeSpace(target.kind, result.space.title)}: ${result.changes.join('، ')}`,
                { kind: target.kind, spaceId: target.id, userId }
            );
        }
        return res.status(200).json({ permissions: result.permissions });
    } catch (err) {
        if (handleConsoleError(err, res)) return undefined;
        throw err;
    }
}

async function deleteSpace(req, res) {
    const target = parseSpace(req);
    if (!target) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    try {
        const result = await spaceAdmin.removePermanently(
            target.kind,
            target.id,
            (req.body || {}).confirmTitle,
            req.user.sub
        );
        await adminAudit.record(
            req.user.sub,
            `${target.kind}.deleted`,
            `${describeSpace(target.kind, result.space.title)} — ${format.toPersianDigits(result.messages)} پیام، ${format.toPersianDigits(result.files)} فایل، ${format.toPersianDigits(result.members)} عضو`,
            { kind: target.kind, spaceId: target.id, messages: result.messages, files: result.files }
        );
        return res.status(200).json({ deleted: true });
    } catch (err) {
        if (handleConsoleError(err, res)) return undefined;
        throw err;
    }
}

module.exports = {
    spaceDetails,
    updateSpaceInfo,
    uploadSpaceAvatar,
    removeSpaceAvatar,
    linkSpace,
    unlinkSpace,
    setMemberPermissions,
    deleteSpace
};
