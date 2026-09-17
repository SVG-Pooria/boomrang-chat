const channelFileService = require('../services/channelFile.service');
const pollService = require('../services/poll.service');
const summaryService = require('../services/summary.service');
const targetService = require('../services/workspaceTarget.service');
const complianceService = require('../services/compliance.service');
const messageService = require('../services/message.service');
const channelMessageService = require('../services/channelMessage.service');
const groupMessageService = require('../services/groupMessage.service');
const db = require('../config/database');
const notifier = require('../socket/notifier');
const asyncHandler = require('../utils/asyncHandler');

function parseId(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isSafeUrl(value) {
    if (typeof value !== 'string' || value.length > 2000) {
        return false;
    }
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (err) {
        return false;
    }
}

async function resolveTarget(req) {
    const { targetType } = req.params;
    const targetId = parseId(req.params.targetId);
    if (!targetService.isValidTargetType(targetType) || !targetId) {
        return { error: 'INVALID_TARGET' };
    }
    const membership = await targetService.getMembership(targetType, targetId, req.user.sub);
    if (!membership) {
        return { error: 'NOT_A_MEMBER' };
    }
    return { targetType, targetId, membership };
}

function respondTargetError(res, error) {
    return res.status(error === 'NOT_A_MEMBER' ? 403 : 400).json({ error });
}

async function getPanel(req, res) {
    const target = await resolveTarget(req);
    if (target.error) {
        return respondTargetError(res, target.error);
    }
    const [media, vault, links, polls] = await Promise.all([
        channelFileService.listAttachments(target.targetType, target.targetId, 'media'),
        channelFileService.listAttachments(target.targetType, target.targetId, 'files'),
        channelFileService.listLinks(target.targetType, target.targetId),
        pollService.listForTarget(target.targetType, target.targetId, req.user.sub)
    ]);
    return res.status(200).json({ media, vault, links, polls });
}

async function addLink(req, res) {
    const target = await resolveTarget(req);
    if (target.error) {
        return respondTargetError(res, target.error);
    }
    const { title, url, icon } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'INVALID_TITLE' });
    }
    if (!isSafeUrl(url)) {
        return res.status(400).json({ error: 'INVALID_URL' });
    }
    const id = await channelFileService.addLink(target.targetType, target.targetId, req.user.sub, {
        title: title.trim(),
        url,
        icon
    });
    notifier.notifyChannelFileChanged(target.targetType, target.targetId);
    return res.status(201).json({ linkId: id });
}

async function removeLink(req, res) {
    const linkId = parseId(req.params.linkId);
    if (!linkId) {
        return res.status(400).json({ error: 'INVALID_LINK_ID' });
    }
    const result = await channelFileService.removeLink(linkId, req.user);
    if (result.error) {
        return res.status(result.error === 'NOT_FOUND' ? 404 : 403).json({ error: result.error });
    }
    notifier.notifyChannelFileChanged(result.targetType, result.targetId);
    return res.status(200).json({ success: true });
}

async function createPoll(req, res) {
    const target = await resolveTarget(req);
    if (target.error) {
        return respondTargetError(res, target.error);
    }
    const { question, options } = req.body || {};
    if (!question || typeof question !== 'string' || !question.trim()) {
        return res.status(400).json({ error: 'INVALID_QUESTION' });
    }
    if (
        !Array.isArray(options) ||
        options.length < pollService.MIN_OPTIONS ||
        options.length > pollService.MAX_OPTIONS ||
        options.some((option) => typeof option !== 'string' || !option.trim())
    ) {
        return res.status(400).json({ error: 'INVALID_OPTIONS' });
    }
    const trimmedQuestion = question.trim();
    let message;
    if (target.targetType === 'channel') {
        message = await channelMessageService.createChannelMessage({
            channelId: target.targetId,
            senderId: req.user.sub,
            body: trimmedQuestion,
            type: 'poll'
        });
    } else if (target.targetType === 'group') {
        message = await groupMessageService.createGroupMessage({
            groupId: target.targetId,
            senderId: req.user.sub,
            body: trimmedQuestion,
            type: 'poll'
        });
    } else {
        message = await messageService.createMessage({
            conversationId: target.targetId,
            senderId: req.user.sub,
            body: trimmedQuestion,
            type: 'poll'
        });
    }

    const poll = await pollService.createPoll({
        targetType: target.targetType,
        targetId: target.targetId,
        question: trimmedQuestion,
        options: options.map((option) => option.trim()),
        createdBy: req.user.sub,
        messageId: message.id
    });

    if (target.targetType === 'channel') {
        notifier.notifyChannelMessageCreated(target.targetId, message);
    } else if (target.targetType === 'group') {
        notifier.notifyGroupMessageCreated(target.targetId, message);
    } else {
        notifier.notifyConversationMessageCreated(target.targetId, message);
    }
    notifier.notifyPollChanged(target.targetType, target.targetId, poll);
    summaryService.touch(target.targetType, target.targetId, { force: true });
    return res.status(201).json({ poll, message });
}

async function votePoll(req, res) {
    const pollId = parseId(req.params.pollId);
    const optionId = parseId((req.body || {}).optionId);
    if (!pollId || !optionId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const existing = await pollService.serialize(pollId, req.user.sub);
    if (!existing) {
        return res.status(404).json({ error: 'NOT_FOUND' });
    }
    const result = await pollService.vote(pollId, optionId, req.user.sub);
    if (result.error) {
        const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'POLL_CLOSED' ? 409 : 400;
        return res.status(status).json({ error: result.error });
    }
    const membership = await targetService.getMembership(result.targetType, result.targetId, req.user.sub);
    if (!membership) {
        return res.status(403).json({ error: 'NOT_A_MEMBER' });
    }
    notifier.notifyPollChanged(result.targetType, result.targetId, result.poll);
    summaryService.touch(result.targetType, result.targetId, { force: true });
    return res.status(200).json({ poll: result.poll });
}

async function closePoll(req, res) {
    const pollId = parseId(req.params.pollId);
    if (!pollId) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }
    const result = await pollService.closePoll(pollId, req.user);
    if (result.error) {
        return res.status(result.error === 'NOT_FOUND' ? 404 : 403).json({ error: result.error });
    }
    notifier.notifyPollChanged(result.targetType, result.targetId, result.poll);
    summaryService.touch(result.targetType, result.targetId, { force: true });
    return res.status(200).json({ poll: result.poll });
}

async function downloadMedia(req, res) {
    const target = await resolveTarget(req);
    if (target.error) {
        return respondTargetError(res, target.error);
    }
    const archiver = require('archiver');
    const files = await channelFileService.listAttachments(target.targetType, target.targetId, 'media');
    if (files.length === 0) {
        return res.status(404).json({ error: 'NO_MEDIA' });
    }
    const rows = await db.query(
        'SELECT id, original_path, compressed_path, original_name FROM message_files WHERE id = ANY($1::int[])',
        [files.map((file) => file.fileId)]
    );

    await complianceService.record(
        req.user.sub,
        'file.downloaded',
        `دانلود ${files.length} فایل رسانه‌ای از پروندهٔ گفتگو`,
        { targetType: target.targetType, targetId: target.targetId }
    );

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="media.zip"');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', () => res.end());
    archive.pipe(res);
    for (const row of rows.rows) {
        const path = row.compressed_path || row.original_path;
        if (path) {
            archive.file(path, { name: row.original_name || `file-${row.id}` });
        }
    }
    return archive.finalize();
}

module.exports = {
    getPanel: asyncHandler(getPanel),
    addLink: asyncHandler(addLink),
    removeLink: asyncHandler(removeLink),
    createPoll: asyncHandler(createPoll),
    votePoll: asyncHandler(votePoll),
    closePoll: asyncHandler(closePoll),
    downloadMedia: asyncHandler(downloadMedia)
};
