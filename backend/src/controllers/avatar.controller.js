const fs = require('fs/promises');
const avatarUploadService = require('../services/avatarUpload.service');
const activityLogService = require('../services/activityLog.service');
const groupCoreService = require('../services/groupCore.service');
const channelCoreService = require('../services/channelCore.service');
const permissionMatrix = require('../services/channelGroupPermission.service');

const SUPER_ADMIN_MEMBERSHIP = Object.freeze({ role: 'owner', permissions: permissionMatrix.OWNER_PERMISSIONS });

const ENTITY_KINDS = {
    group: {
        idParam: 'groupId',
        notFoundError: 'GROUP_NOT_FOUND',
        getById: (id) => groupCoreService.getGroupById(id),
        getMembership: (id, userId) => groupCoreService.getGroupMembership(id, userId)
    },
    channel: {
        idParam: 'channelId',
        notFoundError: 'CHANNEL_NOT_FOUND',
        getById: (id) => channelCoreService.getChannelById(id),
        getMembership: (id, userId) => channelCoreService.getChannelMembership(id, userId)
    }
};

function parseId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function buildEntityAvatarUrl(kind, entityId, updatedAt) {
    const version = updatedAt ? new Date(updatedAt).getTime() : 0;
    return `/api/avatars/${kind}/${entityId}?v=${version}`;
}

async function resolveActorMembership(kind, entityId, req) {
    if (req.user.role === 'super_admin') {
        return SUPER_ADMIN_MEMBERSHIP;
    }
    return ENTITY_KINDS[kind].getMembership(entityId, req.user.sub);
}

async function uploadMyAvatar(req, res) {
    const stored = await avatarUploadService.processAvatarUpload({
        tempPath: req.file.path,
        mimeType: req.file.mimetype,
        actorId: req.user.sub
    });

    if (stored.status === 'infected') {
        return res.status(422).json({ error: 'INFECTED_FILE' });
    }
    if (stored.status === 'scan_error') {
        return res.status(503).json({ error: 'SCAN_UNAVAILABLE' });
    }
    if (stored.status === 'invalid_image') {
        return res.status(400).json({ error: 'INVALID_IMAGE' });
    }

    const updated = await avatarUploadService.setUserAvatar(req.user.sub, stored.avatarPath);
    if (!updated) {
        return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }

    await activityLogService.log(req.user.sub, 'user.avatar.updated', { userId: req.user.sub });

    return res.status(200).json({
        avatarUrl: `/api/avatars/user/${req.user.sub}?v=${new Date(updated.avatar_updated_at).getTime()}`,
        avatarUpdatedAt: updated.avatar_updated_at
    });
}

async function deleteMyAvatar(req, res) {
    const updated = await avatarUploadService.clearUserAvatar(req.user.sub);
    if (!updated) {
        return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }

    await activityLogService.log(req.user.sub, 'user.avatar.removed', { userId: req.user.sub });

    return res.status(200).json({ avatarUrl: null });
}

function uploadEntityAvatar(kind) {
    return async function handler(req, res) {
        const config = ENTITY_KINDS[kind];
        const entityId = parseId(req.params[config.idParam]);
        if (!entityId) {
            return res.status(400).json({ error: 'INVALID_REQUEST' });
        }
        const entity = await config.getById(entityId);
        if (!entity) {
            return res.status(404).json({ error: config.notFoundError });
        }
        const membership = await resolveActorMembership(kind, entityId, req);
        try {
            permissionMatrix.assertCan(membership, 'edit_info');
        } catch (err) {
            if (err instanceof permissionMatrix.PermissionError) {
                return res.status(403).json({ error: err.code });
            }
            throw err;
        }

        const stored = await avatarUploadService.processAvatarUpload({
            tempPath: req.file.path,
            mimeType: req.file.mimetype,
            actorId: req.user.sub
        });
        if (stored.status === 'infected') {
            return res.status(422).json({ error: 'INFECTED_FILE' });
        }
        if (stored.status === 'scan_error') {
            return res.status(503).json({ error: 'SCAN_UNAVAILABLE' });
        }
        if (stored.status === 'invalid_image') {
            return res.status(400).json({ error: 'INVALID_IMAGE' });
        }

        const updated = await avatarUploadService.setEntityAvatar(kind, entityId, stored.avatarPath);
        await activityLogService.log(req.user.sub, `${kind}.avatar.updated`, { [config.idParam]: entityId });

        return res.status(200).json({
            avatarUrl: buildEntityAvatarUrl(kind, entityId, updated.updated_at),
            avatarUpdatedAt: updated.updated_at
        });
    };
}

function deleteEntityAvatar(kind) {
    return async function handler(req, res) {
        const config = ENTITY_KINDS[kind];
        const entityId = parseId(req.params[config.idParam]);
        if (!entityId) {
            return res.status(400).json({ error: 'INVALID_REQUEST' });
        }
        const entity = await config.getById(entityId);
        if (!entity) {
            return res.status(404).json({ error: config.notFoundError });
        }
        const membership = await resolveActorMembership(kind, entityId, req);
        try {
            permissionMatrix.assertCan(membership, 'edit_info');
        } catch (err) {
            if (err instanceof permissionMatrix.PermissionError) {
                return res.status(403).json({ error: err.code });
            }
            throw err;
        }

        await avatarUploadService.clearEntityAvatar(kind, entityId);
        await activityLogService.log(req.user.sub, `${kind}.avatar.removed`, { [config.idParam]: entityId });

        return res.status(200).json({ avatarUrl: null });
    };
}

function serveEntityAvatar(kind) {
    return async function handler(req, res) {
        const config = ENTITY_KINDS[kind];
        const entityId = parseId(req.params[config.idParam]);
        if (!entityId) {
            return res.status(400).json({ error: 'INVALID_REQUEST' });
        }
        const entity = await config.getById(entityId);
        if (!entity) {
            return res.status(404).json({ error: config.notFoundError });
        }
        const membership = await resolveActorMembership(kind, entityId, req);
        if (!membership && entity.visibility !== 'public') {
            return res.status(403).json({ error: 'NOT_A_MEMBER' });
        }

        const avatarPath = await avatarUploadService.getEntityAvatarPath(kind, entityId);
        if (!avatarPath) {
            return res.status(404).json({ error: 'AVATAR_NOT_FOUND' });
        }

        try {
            await fs.access(avatarPath);
        } catch (err) {
            return res.status(404).json({ error: 'AVATAR_NOT_FOUND' });
        }

        res.set('Cache-Control', 'private, max-age=86400');
        return res.sendFile(avatarPath, (err) => {
            if (err && !res.headersSent) {
                res.status(404).json({ error: 'AVATAR_NOT_FOUND' });
            }
        });
    };
}

const uploadGroupAvatar = uploadEntityAvatar('group');
const deleteGroupAvatar = deleteEntityAvatar('group');
const serveGroupAvatar = serveEntityAvatar('group');
const uploadChannelAvatar = uploadEntityAvatar('channel');
const deleteChannelAvatar = deleteEntityAvatar('channel');
const serveChannelAvatar = serveEntityAvatar('channel');

async function serveUserAvatar(req, res) {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId)) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }

    const avatarPath = await avatarUploadService.getUserAvatarPath(userId);
    if (!avatarPath) {
        return res.status(404).json({ error: 'AVATAR_NOT_FOUND' });
    }

    try {
        await fs.access(avatarPath);
    } catch (err) {
        return res.status(404).json({ error: 'AVATAR_NOT_FOUND' });
    }

    res.set('Cache-Control', 'private, max-age=86400');
    return res.sendFile(avatarPath, (err) => {
        if (err && !res.headersSent) {
            res.status(404).json({ error: 'AVATAR_NOT_FOUND' });
        }
    });
}

module.exports = {
    uploadMyAvatar,
    deleteMyAvatar,
    serveUserAvatar,
    uploadGroupAvatar,
    deleteGroupAvatar,
    serveGroupAvatar,
    uploadChannelAvatar,
    deleteChannelAvatar,
    serveChannelAvatar
};
