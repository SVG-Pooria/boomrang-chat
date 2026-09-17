const managerService = require('../services/manager.service');
const teamManagementService = require('../services/teamManagement.service');
const capabilityService = require('../services/capability.service');
const notifier = require('../socket/notifier');
const asyncHandler = require('../utils/asyncHandler');

function parseId(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function getProfile(req, res) {
    return res.status(200).json(await managerService.profile(req.user));
}

async function getOverview(req, res) {
    return res.status(200).json(await managerService.overview(req.user));
}

async function getInbox(req, res) {
    return res.status(200).json(await managerService.inbox(req.user));
}

async function getTasks(req, res) {
    return res.status(200).json(await managerService.board(req.user));
}

async function getTeam(req, res) {
    return res.status(200).json(await managerService.team(req.user));
}

async function getSpaces(req, res) {
    return res.status(200).json(await managerService.spaces(req.user));
}

async function setSpacePinned(req, res) {
    const targetId = parseId(req.params.targetId);
    const { pinned } = req.body || {};
    if (!targetId || typeof pinned !== 'boolean') {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const result = await managerService.setSpacePinned(req.user, req.params.targetType, targetId, pinned);
    if (result.error) {
        return res.status(result.error === 'INVALID_TARGET' ? 400 : 404).json({ error: result.error });
    }
    notifier.notifyManagerSpacesChanged(req.user.sub);
    return res.status(200).json(result);
}

async function getReports(req, res) {
    return res.status(200).json(await managerService.reports(req.user));
}

async function getTeamMembers(req, res) {
    const [members, tags, capabilities] = await Promise.all([
        teamManagementService.listMembers(req.user),
        teamManagementService.listTags(),
        capabilityService.capabilitiesFor(req.user)
    ]);
    return res.status(200).json({
        members,
        tags,
        capabilities,
        permissions: capabilityService.PERMISSIONS.map((permission) => ({
            key: permission,
            label: capabilityService.PERMISSION_LABELS[permission]
        }))
    });
}

function memberActionStatus(error) {
    if (error === 'FORBIDDEN') {
        return 403;
    }
    if (error === 'TAG_NOT_FOUND' || error === 'USER_NOT_FOUND') {
        return 404;
    }
    return 400;
}

async function setMemberTag(req, res) {
    const userId = parseId(req.params.userId);
    if (!userId) {
        return res.status(400).json({ error: 'INVALID_USER_ID' });
    }
    const tagId = req.body && req.body.tagId === null ? null : parseId(req.body ? req.body.tagId : null);
    if (tagId === null && req.body.tagId !== null && req.body.tagId !== undefined) {
        return res.status(400).json({ error: 'INVALID_TAG_ID' });
    }
    const result = await teamManagementService.setTag(req.user, userId, tagId);
    if (result.error) {
        return res.status(memberActionStatus(result.error)).json({ error: result.error });
    }
    return res.status(200).json({ members: await teamManagementService.listMembers(req.user) });
}

async function setMemberTitle(req, res) {
    const userId = parseId(req.params.userId);
    if (!userId) {
        return res.status(400).json({ error: 'INVALID_USER_ID' });
    }
    const result = await teamManagementService.setJobTitle(req.user, userId, (req.body || {}).jobTitle);
    if (result.error) {
        return res.status(memberActionStatus(result.error)).json({ error: result.error });
    }
    return res.status(200).json({ members: await teamManagementService.listMembers(req.user) });
}

async function setMemberPermission(req, res) {
    const userId = parseId(req.params.userId);
    const { permission, enabled } = req.body || {};
    if (!userId || typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const result = await teamManagementService.setPermission(req.user, userId, permission, enabled);
    if (result.error) {
        return res.status(memberActionStatus(result.error)).json({ error: result.error });
    }
    return res.status(200).json({ members: await teamManagementService.listMembers(req.user) });
}

async function setMemberRole(req, res) {
    const userId = parseId(req.params.userId);
    const { role } = req.body || {};
    if (!userId) {
        return res.status(400).json({ error: 'INVALID_USER_ID' });
    }
    const result = await teamManagementService.setRole(req.user, userId, role);
    if (result.error) {
        return res.status(memberActionStatus(result.error)).json({ error: result.error });
    }
    notifier.notifyWorkspaceChanged('team');
    return res.status(200).json({ members: await teamManagementService.listMembers(req.user) });
}

module.exports = {
    getProfile: asyncHandler(getProfile),
    getOverview: asyncHandler(getOverview),
    getInbox: asyncHandler(getInbox),
    getTasks: asyncHandler(getTasks),
    getTeam: asyncHandler(getTeam),
    getSpaces: asyncHandler(getSpaces),
    setSpacePinned: asyncHandler(setSpacePinned),
    getReports: asyncHandler(getReports),
    getTeamMembers: asyncHandler(getTeamMembers),
    setMemberTag: asyncHandler(setMemberTag),
    setMemberTitle: asyncHandler(setMemberTitle),
    setMemberPermission: asyncHandler(setMemberPermission),
    setMemberRole: asyncHandler(setMemberRole)
};
