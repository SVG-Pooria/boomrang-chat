const asyncHandler = require('../utils/asyncHandler');
const channelCoreService = require('../services/channelCore.service');
const groupCoreService = require('../services/groupCore.service');
const channelGroupLinkService = require('../services/channelGroupLink.service');
const permissionMatrix = require('../services/channelGroupPermission.service');
const notifier = require('../socket/notifier');
const activityLogService = require('../services/activityLog.service');

function parseId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function buildGroupAvatarUrl(group) {
    if (!group.avatar) {
        return null;
    }
    const version = group.updated_at ? new Date(group.updated_at).getTime() : 0;
    return `/api/avatars/group/${group.id}?v=${version}`;
}

function serializeLinkStatus(status) {
    if (!status.linked) {
        return { linked: false };
    }
    return {
        linked: true,
        link: {
            id: status.link.id,
            linkedAt: status.link.linked_at,
            linkedBy: status.link.linked_by
        },
        group: status.group
            ? { id: status.group.id, title: status.group.title, avatarUrl: buildGroupAvatarUrl(status.group) }
            : null
    };
}

async function createLink(req, res) {
    const channelId = parseId(req.params.channelId);
    if (!channelId) {
        return res.status(400).json({ error: 'INVALID_CHANNEL_ID' });
    }

    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }

    const channelMembership = await channelCoreService.getChannelMembership(channelId, req.user.sub);
    try {
        permissionMatrix.assertCan(channelMembership, 'manage_link');
    } catch (err) {
        if (err instanceof permissionMatrix.PermissionError) {
            return res.status(403).json({ error: err.code });
        }
        throw err;
    }

    const { groupId, newGroup } = req.body || {};

    let targetGroupId = null;

    if (newGroup && typeof newGroup === 'object') {
        const title = String(newGroup.title || '').trim();
        if (!title) {
            return res.status(400).json({ error: 'GROUP_TITLE_REQUIRED' });
        }
        const created = await groupCoreService.createGroup({
            title,
            description: newGroup.description,
            avatar: newGroup.avatar,
            visibility: newGroup.visibility,
            ownerId: req.user.sub
        });
        await notifier.joinUserToGroupRoom(created.id, req.user.sub);
        targetGroupId = created.id;
    } else {
        targetGroupId = parseId(groupId);
        if (!targetGroupId) {
            return res.status(400).json({ error: 'INVALID_GROUP_ID' });
        }
        const group = await groupCoreService.getGroupById(targetGroupId);
        if (!group) {
            return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
        }
        const groupMembership = await groupCoreService.getGroupMembership(targetGroupId, req.user.sub);
        try {
            permissionMatrix.assertCan(groupMembership, 'manage_link');
        } catch (err) {
            if (err instanceof permissionMatrix.PermissionError) {
                return res.status(403).json({ error: err.code });
            }
            throw err;
        }
    }

    try {
        const link = await channelGroupLinkService.linkChannelToGroup(channelId, targetGroupId, req.user.sub);
        notifier.notifyChannelGroupLinked(channelId, targetGroupId, link);
        await activityLogService.log(req.user.sub, 'channel_group.linked', {
            channelId,
            groupId: targetGroupId,
            linkId: link.id
        });
        const status = await channelGroupLinkService.getLinkStatusForChannel(channelId);
        return res.status(201).json(serializeLinkStatus(status));
    } catch (err) {
        if (err instanceof channelGroupLinkService.LinkError) {
            return res.status(409).json({ error: err.code });
        }
        throw err;
    }
}

async function removeLink(req, res) {
    const channelId = parseId(req.params.channelId);
    if (!channelId) {
        return res.status(400).json({ error: 'INVALID_CHANNEL_ID' });
    }

    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }

    const channelMembership = await channelCoreService.getChannelMembership(channelId, req.user.sub);
    try {
        permissionMatrix.assertCan(channelMembership, 'manage_link');
    } catch (err) {
        if (err instanceof permissionMatrix.PermissionError) {
            return res.status(403).json({ error: err.code });
        }
        throw err;
    }

    const removedLink = await channelGroupLinkService.unlinkChannel(channelId, req.user.sub);
    if (!removedLink) {
        return res.status(404).json({ error: 'LINK_NOT_FOUND' });
    }

    notifier.notifyChannelGroupUnlinked(channelId, removedLink.group_id);
    await activityLogService.log(req.user.sub, 'channel_group.unlinked', {
        channelId,
        groupId: removedLink.group_id,
        linkId: removedLink.id
    });
    return res.status(200).json({ unlinked: true });
}

async function getLinkStatus(req, res) {
    const channelId = parseId(req.params.channelId);
    if (!channelId) {
        return res.status(400).json({ error: 'INVALID_CHANNEL_ID' });
    }

    const channel = await channelCoreService.getChannelById(channelId);
    if (!channel) {
        return res.status(404).json({ error: 'CHANNEL_NOT_FOUND' });
    }

    const channelMembership = await channelCoreService.getChannelMembership(channelId, req.user.sub);
    try {
        permissionMatrix.assertCan(channelMembership, 'view');
    } catch (err) {
        if (err instanceof permissionMatrix.PermissionError) {
            return res.status(403).json({ error: err.code });
        }
        throw err;
    }

    const status = await channelGroupLinkService.getLinkStatusForChannel(channelId);
    return res.status(200).json(serializeLinkStatus(status));
}

module.exports = {
    createLink: asyncHandler(createLink),
    removeLink: asyncHandler(removeLink),
    getLinkStatus: asyncHandler(getLinkStatus)
};
