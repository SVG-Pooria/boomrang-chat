const db = require('../config/database');
const conversationService = require('./conversation.service');

async function createTicket(requesterId, subject, message) {
    const result = await db.query(
        `INSERT INTO management_chat_requests (requester_id, subject, message)
         VALUES ($1, $2, $3) RETURNING *`,
        [requesterId, subject, message || null]
    );
    return result.rows[0];
}

async function getTicketById(ticketId) {
    const result = await db.query('SELECT * FROM management_chat_requests WHERE id = $1', [ticketId]);
    return result.rows[0] || null;
}

async function listForRequester(requesterId) {
    const result = await db.query(
        'SELECT * FROM management_chat_requests WHERE requester_id = $1 ORDER BY created_at DESC',
        [requesterId]
    );
    return result.rows;
}

async function listByStatus(status) {
    const params = [];
    let condition = '';
    if (status) {
        params.push(status);
        condition = 'WHERE t.status = $1';
    }
    const result = await db.query(
        `SELECT t.*, u.full_name AS requester_name, u.phone AS requester_phone
         FROM management_chat_requests t
         JOIN users u ON u.id = t.requester_id
         ${condition}
         ORDER BY t.created_at DESC`,
        params
    );
    return result.rows;
}

async function approveTicket(ticketId, reviewerId) {
    const ticket = await getTicketById(ticketId);
    if (!ticket) {
        return { error: 'TICKET_NOT_FOUND' };
    }
    if (ticket.status !== 'pending') {
        return { error: 'TICKET_ALREADY_REVIEWED' };
    }
    const conversation = await conversationService.getOrCreateApprovedDirect(
        ticket.requester_id,
        reviewerId,
        reviewerId
    );
    const updated = await db.query(
        `UPDATE management_chat_requests
         SET status = 'approved', reviewed_by = $1, reviewed_at = now(), resulting_conversation_id = $2
         WHERE id = $3 RETURNING *`,
        [reviewerId, conversation.id, ticketId]
    );
    return { ticket: updated.rows[0], conversation };
}

async function rejectTicket(ticketId, reviewerId, reviewNote) {
    const ticket = await getTicketById(ticketId);
    if (!ticket) {
        return { error: 'TICKET_NOT_FOUND' };
    }
    if (ticket.status !== 'pending') {
        return { error: 'TICKET_ALREADY_REVIEWED' };
    }
    const updated = await db.query(
        `UPDATE management_chat_requests
         SET status = 'rejected', reviewed_by = $1, reviewed_at = now(), review_note = $2
         WHERE id = $3 RETURNING *`,
        [reviewerId, reviewNote || null, ticketId]
    );
    return { ticket: updated.rows[0] };
}

module.exports = {
    createTicket,
    getTicketById,
    listForRequester,
    listByStatus,
    approveTicket,
    rejectTicket
};
