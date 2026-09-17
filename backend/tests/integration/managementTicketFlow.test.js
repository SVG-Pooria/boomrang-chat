const test = require('node:test');
const assert = require('node:assert/strict');
const { request, checkServerReachable, loginWithPassword } = require('./helpers/apiClient');
const {
    hasSuperAdminCredentials,
    hasManagementCredentials,
    SUPER_ADMIN_PHONE,
    SUPER_ADMIN_PASSWORD,
    MANAGEMENT_PHONE,
    MANAGEMENT_PASSWORD
} = require('./helpers/env');
const { createTestUser, deactivateTestUser } = require('./helpers/fixtures');
const { connectSocket, waitForConnect, waitForEvent, emitWithAck, loadSocketIoClient } = require('./helpers/socketClient');

test('management ticket flow against a live backend', async (t) => {
    const reachable = await checkServerReachable();
    if (!reachable) {
        t.skip('No backend reachable at TEST_BASE_URL, skipping live integration tests');
        return;
    }
    if (!hasSuperAdminCredentials()) {
        t.skip('TEST_SUPER_ADMIN_PHONE / TEST_SUPER_ADMIN_PASSWORD not provided, skipping live integration tests');
        return;
    }
    if (!hasManagementCredentials()) {
        t.skip('TEST_MANAGEMENT_PHONE / TEST_MANAGEMENT_PASSWORD not provided, skipping ticket approval tests');
        return;
    }

    const superAdminSession = await loginWithPassword(SUPER_ADMIN_PHONE, SUPER_ADMIN_PASSWORD);
    const superAdminToken = superAdminSession.token;
    const managementSession = await loginWithPassword(MANAGEMENT_PHONE, MANAGEMENT_PASSWORD);
    const managementToken = managementSession.token;

    const employee = await createTestUser(superAdminToken, { role: 'employee' });

    await t.test('an employee cannot message management directly without a ticket', async () => {
        const result = await request('POST', '/conversations/direct', {
            token: employee.token,
            body: { targetUserId: managementSession.user.id }
        });
        assert.equal(result.status, 403);
        assert.equal(result.data.error, 'MANAGEMENT_TICKET_REQUIRED');
    });

    let rejectedTicketId;
    await t.test('management can reject a ticket', async () => {
        const created = await request('POST', '/management-tickets', {
            token: employee.token,
            body: { subject: 'Stage10 rejection scenario', message: 'please reject this one' }
        });
        assert.equal(created.status, 201);
        assert.equal(created.data.ticket.status, 'pending');
        rejectedTicketId = created.data.ticket.id;

        const rejected = await request('POST', `/management-tickets/${rejectedTicketId}/reject`, {
            token: managementToken,
            body: { reason: 'not needed right now' }
        });
        assert.equal(rejected.status, 200);
        assert.equal(rejected.data.ticket.status, 'rejected');

        const doubleReject = await request('POST', `/management-tickets/${rejectedTicketId}/reject`, {
            token: managementToken,
            body: {}
        });
        assert.equal(doubleReject.status, 409);
        assert.equal(doubleReject.data.error, 'TICKET_ALREADY_REVIEWED');
    });

    let approvedConversationId;
    await t.test('submit -> approve -> conversation opens -> messaging works', async () => {
        const created = await request('POST', '/management-tickets', {
            token: employee.token,
            body: { subject: 'Stage10 approval scenario', message: 'need to discuss budget' }
        });
        assert.equal(created.status, 201);
        const ticketId = created.data.ticket.id;

        const approved = await request('POST', `/management-tickets/${ticketId}/approve`, {
            token: managementToken,
            body: {}
        });
        assert.equal(approved.status, 200);
        assert.equal(approved.data.ticket.status, 'approved');
        assert.ok(approved.data.conversation.id);
        approvedConversationId = approved.data.conversation.id;
        assert.equal(approved.data.conversation.origin, 'management_approved');

        const employeeConversations = await request('GET', '/conversations', { token: employee.token });
        assert.equal(employeeConversations.status, 200);
        const found = employeeConversations.data.conversations.find((c) => c.id === approvedConversationId);
        assert.ok(found, 'the approved conversation should now appear in the employee conversation list');

        if (!loadSocketIoClient()) {
            t.skip('socket.io-client is not installed, skipping the real-time messaging assertion (run npm install first)');
            return;
        }

        const employeeSocket = connectSocket(employee.token);
        const managementSocket = connectSocket(managementToken);
        try {
            await Promise.all([waitForConnect(employeeSocket), waitForConnect(managementSocket)]);

            const incoming = waitForEvent(managementSocket, 'message:new', 8000);
            const sendResult = await emitWithAck(employeeSocket, 'message:send', {
                conversationId: approvedConversationId,
                body: 'hello from the approved ticket conversation'
            });
            assert.ok(sendResult.message, `message:send should succeed, got ${JSON.stringify(sendResult)}`);

            const pushed = await incoming;
            assert.equal(pushed.conversationId, approvedConversationId);
            assert.equal(pushed.message.body, 'hello from the approved ticket conversation');
        } finally {
            employeeSocket.disconnect();
            managementSocket.disconnect();
        }
    });

    await t.test('management can close the approved conversation, after which a new ticket is required', async () => {
        const closed = await request('POST', `/conversations/${approvedConversationId}/close`, {
            token: managementToken,
            body: {}
        });
        assert.equal(closed.status, 200);
        assert.ok(closed.data.conversation.closed_at);

        const blocked = await request('POST', '/conversations/direct', {
            token: employee.token,
            body: { targetUserId: managementSession.user.id }
        });
        assert.equal(blocked.status, 403);
        assert.equal(blocked.data.error, 'MANAGEMENT_TICKET_REQUIRED');
    });

    await deactivateTestUser(superAdminToken, employee.user.id);
});
