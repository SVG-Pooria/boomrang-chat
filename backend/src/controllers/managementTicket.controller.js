const ticketService = require('../services/managementTicket.service');
const activityLogService = require('../services/activityLog.service');
const complianceService = require('../services/compliance.service');
const notifier = require('../socket/notifier');

const SUBJECT_MAX_LENGTH = 255;
const MESSAGE_MAX_LENGTH = 2000;

async function createTicket(req, res) {
    const subject = String((req.body || {}).subject || '').trim();
    const message = String((req.body || {}).message || '').trim();
    if (!subject) {
        return res.status(400).json({ error: 'SUBJECT_REQUIRED' });
    }
    if (subject.length > SUBJECT_MAX_LENGTH) {
        return res.status(400).json({ error: 'SUBJECT_TOO_LONG' });
    }
    if (message.length > MESSAGE_MAX_LENGTH) {
        return res.status(400).json({ error: 'MESSAGE_TOO_LONG' });
    }
    const ticket = await ticketService.createTicket(req.user.sub, subject, message);
    await activityLogService.log(req.user.sub, 'management_ticket.created', { ticketId: ticket.id });
    await complianceService.recordTeamActivity(
        req.user.sub,
        'access.requested',
        'درخواست دسترسی به گفتگو با مدیریت ثبت کرد',
        { ticketId: ticket.id }
    );
    notifier.notifyManagementNewTicket(ticket, req.user);
    return res.status(201).json({ ticket });
}

async function listMine(req, res) {
    const tickets = await ticketService.listForRequester(req.user.sub);
    return res.status(200).json({ tickets });
}

async function listQueue(req, res) {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const tickets = await ticketService.listByStatus(status);
    return res.status(200).json({ tickets });
}

async function approve(req, res) {
    const ticketId = Number(req.params.id);
    if (!Number.isInteger(ticketId)) {
        return res.status(400).json({ error: 'INVALID_TICKET_ID' });
    }
    const outcome = await ticketService.approveTicket(ticketId, req.user.sub);
    if (outcome.error) {
        return res.status(409).json({ error: outcome.error });
    }
    await activityLogService.log(req.user.sub, 'management_ticket.approved', {
        ticketId,
        conversationId: outcome.conversation.id
    });
    await notifier.notifyTicketApproved(outcome.ticket, outcome.conversation);
    return res.status(200).json({ ticket: outcome.ticket, conversation: outcome.conversation });
}

async function reject(req, res) {
    const ticketId = Number(req.params.id);
    const reason = (req.body || {}).reason ? String(req.body.reason).trim().slice(0, MESSAGE_MAX_LENGTH) : null;
    if (!Number.isInteger(ticketId)) {
        return res.status(400).json({ error: 'INVALID_TICKET_ID' });
    }
    const outcome = await ticketService.rejectTicket(ticketId, req.user.sub, reason);
    if (outcome.error) {
        return res.status(409).json({ error: outcome.error });
    }
    await activityLogService.log(req.user.sub, 'management_ticket.rejected', { ticketId, reason });
    notifier.notifyTicketRejected(outcome.ticket);
    return res.status(200).json({ ticket: outcome.ticket });
}

module.exports = { createTicket, listMine, listQueue, approve, reject };
