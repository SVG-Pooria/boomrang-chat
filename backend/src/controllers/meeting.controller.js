const meetingService = require('../services/meeting.service');
const capabilityService = require('../services/capability.service');
const complianceService = require('../services/compliance.service');
const notifier = require('../socket/notifier');
const asyncHandler = require('../utils/asyncHandler');

const MAX_ATTENDEES = 200;

function parseId(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseDate(value) {
    if (!value) {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseIdList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return [...new Set(value.map(parseId).filter(Boolean))].slice(0, MAX_ATTENDEES);
}

function statusCode(error) {
    if (error === 'NOT_FOUND') {
        return 404;
    }
    if (error === 'FORBIDDEN' || error === 'NOT_INVITED') {
        return 403;
    }
    return 400;
}

async function listMeetings(req, res) {
    const scope = meetingService.isValidScope(req.query.scope) ? req.query.scope : 'participant';
    const [meetings, capabilities] = await Promise.all([
        meetingService.listForViewer(req.user, scope),
        capabilityService.capabilitiesFor(req.user)
    ]);
    return res.status(200).json({ meetings, scope, capabilities });
}

async function createMeeting(req, res) {
    const { title, startsAt, endsAt, location, description, attendeeIds } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'INVALID_TITLE' });
    }
    const start = parseDate(startsAt);
    const end = parseDate(endsAt);
    if (!start || !end || new Date(end).getTime() <= new Date(start).getTime()) {
        return res.status(400).json({ error: 'INVALID_SCHEDULE' });
    }
    if (!(await capabilityService.has(req.user, 'schedule_meetings'))) {
        return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const meeting = await meetingService.createMeeting({
        title,
        startsAt: start,
        endsAt: end,
        location,
        description,
        attendeeIds: parseIdList(attendeeIds),
        createdBy: req.user.sub
    });
    await complianceService.recordTeamActivity(
        req.user.sub,
        'meeting.created',
        `جلسهٔ «${meeting.title}» را تنظیم کرد`,
        { meetingId: meeting.meetingId }
    );
    notifier.notifyWorkspaceChanged('meetings');
    return res.status(201).json({ meeting });
}

async function updateMeeting(req, res) {
    const meetingId = parseId(req.params.id);
    if (!meetingId) {
        return res.status(400).json({ error: 'INVALID_MEETING_ID' });
    }
    const { title, startsAt, endsAt, location, description, attendeeIds } = req.body || {};
    const patch = { title };
    if (startsAt !== undefined) {
        patch.startsAt = parseDate(startsAt);
    }
    if (endsAt !== undefined) {
        patch.endsAt = parseDate(endsAt);
    }
    if (location !== undefined) {
        patch.location = location;
    }
    if (description !== undefined) {
        patch.description = description;
    }
    if (attendeeIds !== undefined) {
        patch.attendeeIds = parseIdList(attendeeIds);
    }
    const result = await meetingService.updateMeeting(meetingId, req.user, patch);
    if (result.error) {
        return res.status(statusCode(result.error)).json({ error: result.error });
    }
    notifier.notifyWorkspaceChanged('meetings');
    return res.status(200).json({ meeting: result.meeting });
}

async function cancelMeeting(req, res) {
    const meetingId = parseId(req.params.id);
    if (!meetingId) {
        return res.status(400).json({ error: 'INVALID_MEETING_ID' });
    }
    const result = await meetingService.cancelMeeting(meetingId, req.user);
    if (result.error) {
        return res.status(statusCode(result.error)).json({ error: result.error });
    }
    await complianceService.recordTeamActivity(
        req.user.sub,
        'meeting.canceled',
        `جلسهٔ «${result.meeting.title}» را لغو کرد`,
        { meetingId }
    );
    notifier.notifyWorkspaceChanged('meetings');
    return res.status(200).json({ meeting: result.meeting });
}

async function confirmAttendance(req, res) {
    const meetingId = parseId(req.params.id);
    if (!meetingId) {
        return res.status(400).json({ error: 'INVALID_MEETING_ID' });
    }
    const confirmed = req.body && req.body.confirmed === false ? false : true;
    const result = await meetingService.confirmAttendance(meetingId, req.user, confirmed);
    if (result.error) {
        return res.status(statusCode(result.error)).json({ error: result.error });
    }
    notifier.notifyWorkspaceChanged('meetings');
    return res.status(200).json({ meeting: result.meeting });
}

async function markAttendance(req, res) {
    const meetingId = parseId(req.params.id);
    if (!meetingId) {
        return res.status(400).json({ error: 'INVALID_MEETING_ID' });
    }
    const attendedIds = parseIdList(req.body ? req.body.attendedIds : []);
    const result = await meetingService.markAttendance(meetingId, req.user, attendedIds);
    if (result.error) {
        return res.status(statusCode(result.error)).json({ error: result.error });
    }
    notifier.notifyWorkspaceChanged('meetings');
    return res.status(200).json({ meeting: result.meeting });
}

async function saveMinutes(req, res) {
    const meetingId = parseId(req.params.id);
    if (!meetingId) {
        return res.status(400).json({ error: 'INVALID_MEETING_ID' });
    }
    const { minutes, actionsCount } = req.body || {};
    if (!Array.isArray(minutes) || minutes.some((line) => typeof line !== 'string')) {
        return res.status(400).json({ error: 'INVALID_MINUTES' });
    }
    const result = await meetingService.saveMinutes(
        meetingId,
        req.user,
        minutes.map((line) => line.trim()).filter(Boolean),
        Number(actionsCount) || 0
    );
    if (result.error) {
        return res.status(statusCode(result.error)).json({ error: result.error });
    }
    notifier.notifyWorkspaceChanged('meetings');
    return res.status(200).json({ meeting: result.meeting });
}

module.exports = {
    listMeetings: asyncHandler(listMeetings),
    createMeeting: asyncHandler(createMeeting),
    updateMeeting: asyncHandler(updateMeeting),
    cancelMeeting: asyncHandler(cancelMeeting),
    confirmAttendance: asyncHandler(confirmAttendance),
    markAttendance: asyncHandler(markAttendance),
    saveMinutes: asyncHandler(saveMinutes)
};
