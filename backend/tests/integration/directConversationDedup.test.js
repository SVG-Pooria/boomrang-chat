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

test('direct conversations are never duplicated for the same pair of users', async (t) => {
    const reachable = await checkServerReachable();
    if (!reachable) {
        t.skip('No backend reachable at TEST_BASE_URL, skipping live integration tests');
        return;
    }
    if (!hasSuperAdminCredentials()) {
        t.skip('TEST_SUPER_ADMIN_PHONE / TEST_SUPER_ADMIN_PASSWORD not provided, skipping live integration tests');
        return;
    }

    const superAdminSession = await loginWithPassword(SUPER_ADMIN_PHONE, SUPER_ADMIN_PASSWORD);
    const superAdminToken = superAdminSession.token;

    const employeeA = await createTestUser(superAdminToken, { role: 'employee' });
    const employeeB = await createTestUser(superAdminToken, { role: 'employee' });

    let conversationId;

    await t.test('calling start-chat twice in a row returns the same conversation', async () => {
        const first = await request('POST', '/conversations/direct', {
            token: employeeA.token,
            body: { targetUserId: employeeB.user.id }
        });
        assert.equal(first.status, 200);
        assert.ok(first.data.conversation.id);
        conversationId = first.data.conversation.id;

        const second = await request('POST', '/conversations/direct', {
            token: employeeA.token,
            body: { targetUserId: employeeB.user.id }
        });
        assert.equal(second.status, 200);
        assert.equal(second.data.conversation.id, conversationId, 'a second start-chat click must re-use the same conversation');
    });

    await t.test('starting the chat from the other side (B -> A) resolves to the same conversation', async () => {
        const fromOtherSide = await request('POST', '/conversations/direct', {
            token: employeeB.token,
            body: { targetUserId: employeeA.user.id }
        });
        assert.equal(fromOtherSide.status, 200);
        assert.equal(
            fromOtherSide.data.conversation.id,
            conversationId,
            'direction should not matter - it is still the same pair of users'
        );
    });

    await t.test('a brand-new pair hitting start-chat concurrently (double-tab / double-tap) never forks into two conversations', async () => {
        const employeeC = await createTestUser(superAdminToken, { role: 'employee' });
        const employeeD = await createTestUser(superAdminToken, { role: 'employee' });

        const results = await Promise.all([
            request('POST', '/conversations/direct', { token: employeeC.token, body: { targetUserId: employeeD.user.id } }),
            request('POST', '/conversations/direct', { token: employeeC.token, body: { targetUserId: employeeD.user.id } }),
            request('POST', '/conversations/direct', { token: employeeD.token, body: { targetUserId: employeeC.user.id } }),
            request('POST', '/conversations/direct', { token: employeeD.token, body: { targetUserId: employeeC.user.id } })
        ]);

        results.forEach((result) => {
            assert.equal(result.status, 200, `every concurrent request should succeed, got ${JSON.stringify(result.data)}`);
        });

        const ids = new Set(results.map((result) => result.data.conversation.id));
        assert.equal(ids.size, 1, `expected exactly one conversation id, got ${JSON.stringify([...ids])}`);

        const cList = await request('GET', '/conversations', { token: employeeC.token });
        const dList = await request('GET', '/conversations', { token: employeeD.token });
        const cMatches = cList.data.conversations.filter(
            (item) => item.type === 'direct' && item.otherUser && item.otherUser.sub === employeeD.user.id
        );
        const dMatches = dList.data.conversations.filter(
            (item) => item.type === 'direct' && item.otherUser && item.otherUser.sub === employeeC.user.id
        );
        assert.equal(cMatches.length, 1, 'employee C should see exactly one conversation with employee D');
        assert.equal(dMatches.length, 1, 'employee D should see exactly one conversation with employee C');

        await deactivateTestUser(superAdminToken, employeeC.user.id);
        await deactivateTestUser(superAdminToken, employeeD.user.id);
    });

    if (hasManagementCredentials()) {
        await t.test('the management-ticket approval path never forks a second conversation for a pair that already has one', async () => {
            const managementSession = await loginWithPassword(MANAGEMENT_PHONE, MANAGEMENT_PASSWORD);
            const managementToken = managementSession.token;

            const employeeE = await createTestUser(superAdminToken, { role: 'employee' });

            const createdTicket = await request('POST', '/management-tickets', {
                token: employeeE.token,
                body: { subject: 'Dedup check', message: 'first contact with management' }
            });
            assert.equal(createdTicket.status, 201);

            const approved = await request('POST', `/management-tickets/${createdTicket.data.ticket.id}/approve`, {
                token: managementToken,
                body: {}
            });
            assert.equal(approved.status, 200);
            const approvedConversationId = approved.data.conversation.id;

            const secondTicket = await request('POST', '/management-tickets', {
                token: employeeE.token,
                body: { subject: 'Dedup check follow-up', message: 'second ticket, same people' }
            });
            assert.equal(secondTicket.status, 201);
            const secondApproved = await request('POST', `/management-tickets/${secondTicket.data.ticket.id}/approve`, {
                token: managementToken,
                body: {}
            });
            assert.equal(secondApproved.status, 200);
            assert.equal(
                secondApproved.data.conversation.id,
                approvedConversationId,
                'approving a second ticket for the same pair must re-use the existing conversation'
            );

            await deactivateTestUser(superAdminToken, employeeE.user.id);
        });
    } else {
        t.skip('TEST_MANAGEMENT_PHONE / TEST_MANAGEMENT_PASSWORD not provided, skipping the management-ticket dedup scenario');
    }

    await deactivateTestUser(superAdminToken, employeeA.user.id);
    await deactivateTestUser(superAdminToken, employeeB.user.id);
});
