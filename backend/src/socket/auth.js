const sessionService = require('../services/session.service');

async function authenticateSocket(socket, next) {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) {
        return next(new Error('UNAUTHORIZED'));
    }
    let outcome;
    try {
        outcome = await sessionService.authenticate(token);
    } catch (err) {
        return next(new Error('INTERNAL_ERROR'));
    }
    if (outcome.error) {
        return next(new Error(outcome.error));
    }
    const { row, sessionId } = outcome;
    socket.user = {
        sub: row.id,
        fullName: row.full_name,
        phone: row.phone,
        role: row.role,
        tagId: row.tag_id,
        is_active: row.is_active,
        is_locked: row.is_locked,
        sessionId
    };
    return next();
}

module.exports = authenticateSocket;
