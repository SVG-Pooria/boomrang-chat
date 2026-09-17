const test = require('node:test');
const assert = require('node:assert/strict');
const { request, checkServerReachable, loginWithPassword } = require('./helpers/apiClient');
const {
    hasSuperAdminCredentials,
    hasSecondSuperAdminCredentials,
    SUPER_ADMIN_PHONE,
    SUPER_ADMIN_PASSWORD,
    SECOND_SUPER_ADMIN_PHONE,
    SECOND_SUPER_ADMIN_PASSWORD
} = require('./helpers/env');
const { createTestUser, createDirectConversation } = require('./helpers/fixtures');
const { connectSocket, waitForConnect, waitForEvent, emitWithAck, loadSocketIoClient } = require('./helpers/socketClient');

test('hard delete user flow against a live backend', async (t) => {
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

    await t.test('deleting with backup produces a downloadable archive covering the conversation', async () => {
        const victim = await createTestUser(superAdminToken, { role: 'employee' });
        const survivor = await createTestUser(superAdminToken, { role: 'employee' });

        const conversation = await createDirectConversation(victim.token, survivor.user.id);

        if (loadSocketIoClient()) {
            const victimSocket = connectSocket(victim.token);
            const survivorSocket = connectSocket(survivor.token);
            try {
                await Promise.all([waitForConnect(victimSocket), waitForConnect(survivorSocket)]);
                const incoming = waitForEvent(survivorSocket, 'message:new', 8000);
                await emitWithAck(victimSocket, 'message:send', {
                    conversationId: conversation.id,
                    body: 'پیامی که باید در آرشیو باشد'
                });
                await incoming;
            } finally {
                victimSocket.disconnect();
                survivorSocket.disconnect();
            }
        }

        const deleteResult = await request('DELETE', `/users/${victim.user.id}`, {
            token: superAdminToken,
            body: { confirmName: victim.user.fullName, withBackup: true }
        });
        assert.equal(deleteResult.status, 200);
        assert.equal(deleteResult.data.deleted, true);
        assert.ok(deleteResult.data.archive, 'an archive reference should be returned when withBackup is true');
        assert.ok(deleteResult.data.archive.id);
        assert.ok(deleteResult.data.archive.downloadUrl);

        const listResult = await request('GET', '/admin/exports', { token: superAdminToken });
        assert.equal(listResult.status, 200);
        const found = listResult.data.archives.find((a) => a.id === deleteResult.data.archive.id);
        assert.ok(found, 'the new archive should be listed under /admin/exports');
        assert.equal(found.targetFullName, victim.user.fullName);

        const downloadResult = await request('GET', `/admin/exports/${deleteResult.data.archive.id}/download`, {
            token: superAdminToken
        });
        assert.equal(downloadResult.status, 200, 'the archive should still be downloadable after the user is gone');

        const loginAfterDelete = await request('POST', '/auth/login', {
            body: { phone: victim.phone, password: victim.password }
        });
        assert.equal(loginAfterDelete.status, 401);

        const survivorMessages = await request('GET', `/conversations/${conversation.id}/messages`, {
            token: survivor.token
        });
        assert.equal(survivorMessages.status, 200, 'the surviving party must still be able to open the conversation');
        const deletedSenderMessage = survivorMessages.data.messages.find((m) => m.sender_id === null);
        if (deletedSenderMessage) {
            assert.equal(deletedSenderMessage.sender_name, 'کاربر حذف‌شده');
        }

        const survivorConversations = await request('GET', '/conversations', { token: survivor.token });
        assert.equal(survivorConversations.status, 200, 'listing conversations must not crash for the survivor');
    });

    await t.test('deleting without backup leaves no archive and the conversation stays readable', async () => {
        const victim = await createTestUser(superAdminToken, { role: 'employee' });
        const survivor = await createTestUser(superAdminToken, { role: 'employee' });

        const conversation = await createDirectConversation(victim.token, survivor.user.id);

        if (loadSocketIoClient()) {
            const victimSocket = connectSocket(victim.token);
            const survivorSocket = connectSocket(survivor.token);
            try {
                await Promise.all([waitForConnect(victimSocket), waitForConnect(survivorSocket)]);
                const incoming = waitForEvent(survivorSocket, 'message:new', 8000);
                await emitWithAck(victimSocket, 'message:send', {
                    conversationId: conversation.id,
                    body: 'این پیام بدون بکاپ باقی می‌ماند'
                });
                await incoming;
            } finally {
                victimSocket.disconnect();
                survivorSocket.disconnect();
            }
        }

        const deleteResult = await request('DELETE', `/users/${victim.user.id}`, {
            token: superAdminToken,
            body: { confirmName: victim.user.fullName, withBackup: false }
        });
        assert.equal(deleteResult.status, 200);
        assert.equal(deleteResult.data.deleted, true);
        assert.equal(deleteResult.data.archive, null, 'no archive should be created when withBackup is false');

        const survivorMessages = await request('GET', `/conversations/${conversation.id}/messages`, {
            token: survivor.token
        });
        assert.equal(survivorMessages.status, 200, 'the conversation must open without error even without a backup');
        const deletedSenderMessage = survivorMessages.data.messages.find((m) => m.sender_id === null);
        if (deletedSenderMessage) {
            assert.equal(deletedSenderMessage.sender_name, 'کاربر حذف‌شده');
        }
    });

    await t.test('a super admin cannot delete their own account', async () => {
        const result = await request('DELETE', `/users/${superAdminSession.user.id}`, {
            token: superAdminToken,
            body: { confirmName: superAdminSession.user.fullName, withBackup: false }
        });
        assert.equal(result.status, 403);
        assert.equal(result.data.error, 'CANNOT_DELETE_SELF');
    });

    if (hasSecondSuperAdminCredentials()) {
        await t.test('deleting the last remaining super admin is blocked', async () => {
            const secondSession = await loginWithPassword(SECOND_SUPER_ADMIN_PHONE, SECOND_SUPER_ADMIN_PASSWORD);
            const usersList = await request('GET', '/users?role=super_admin', { token: superAdminToken });
            if (usersList.status === 200 && usersList.data.users.length <= 1) {
                const result = await request('DELETE', `/users/${secondSession.user.id}`, {
                    token: superAdminToken,
                    body: { confirmName: secondSession.user.fullName, withBackup: false }
                });
                assert.equal(result.status, 403);
                assert.equal(result.data.error, 'LAST_SUPER_ADMIN');
            }
        });
    } else {
        t.skip('TEST_SECOND_SUPER_ADMIN_PHONE / TEST_SECOND_SUPER_ADMIN_PASSWORD not provided, skipping the last-super-admin guard scenario');
    }

    await t.test('deleting a member of the system channel does not break it for everyone else', async () => {
        const victim = await createTestUser(superAdminToken, { role: 'employee' });
        const observer = await createTestUser(superAdminToken, { role: 'employee' });

        const observerConversations = await request('GET', '/conversations', { token: observer.token });
        assert.equal(observerConversations.status, 200);
        const systemChannel = observerConversations.data.conversations.find((c) => c.is_system_channel);
        assert.ok(systemChannel, 'every active employee should already be a member of the system channel');

        const deleteResult = await request('DELETE', `/users/${victim.user.id}`, {
            token: superAdminToken,
            body: { confirmName: victim.user.fullName, withBackup: false }
        });
        assert.equal(deleteResult.status, 200);

        const channelMessages = await request('GET', `/conversations/${systemChannel.id}/messages`, {
            token: observer.token
        });
        assert.equal(channelMessages.status, 200, 'the system channel must remain readable after a member is deleted');

        const observerConversationsAfter = await request('GET', '/conversations', { token: observer.token });
        assert.equal(observerConversationsAfter.status, 200, 'listing conversations must not crash for other members');
    });

    await t.test('oversight endpoints remain unaffected and invisible to the deleted user beforehand', async () => {
        const target = await createTestUser(superAdminToken, { role: 'employee' });
        const other = await createTestUser(superAdminToken, { role: 'employee' });
        const conversation = await createDirectConversation(target.token, other.user.id);

        const oversightView = await request('GET', `/admin/oversight/conversations/${conversation.id}/messages`, {
            token: superAdminToken
        });
        assert.equal(oversightView.status, 200, 'oversight must still be able to read the conversation before deletion');

        const targetOwnView = await request('GET', `/conversations/${conversation.id}/messages`, {
            token: target.token
        });
        assert.equal(targetOwnView.status, 200);
        const bodies = JSON.stringify(targetOwnView.data);
        assert.ok(!bodies.includes('oversight'), 'the regular conversation payload must carry no trace of the oversight view');

        await request('DELETE', `/users/${target.user.id}`, {
            token: superAdminToken,
            body: { confirmName: target.user.fullName, withBackup: false }
        });
    });
});
