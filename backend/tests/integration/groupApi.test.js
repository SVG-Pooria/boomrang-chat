const test = require('node:test');
const assert = require('node:assert/strict');
const { request, checkServerReachable, loginWithPassword } = require('./helpers/apiClient');
const { hasSuperAdminCredentials, SUPER_ADMIN_PHONE, SUPER_ADMIN_PASSWORD } = require('./helpers/env');
const { createTestUser } = require('./helpers/fixtures');

test('group API: create, membership, roles, free chat, pinning', async (t) => {
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
    const owner = await createTestUser(superAdminSession.token, { role: 'employee' });
    const member = await createTestUser(superAdminSession.token, { role: 'employee' });

    let groupId;
    let firstMessageId;

    await t.test('owner can create a group', async () => {
        const result = await request('POST', '/groups', {
            token: superAdminSession.token,
            body: { title: 'گروه آزمایشی', visibility: 'public', managerId: owner.user.id }
        });
        assert.equal(result.status, 201);
        groupId = result.data.group.id;
    });

    await t.test('a member can self-join a public group and chat freely by default', async () => {
        const join = await request('POST', `/groups/${groupId}/members`, { token: member.token, body: {} });
        assert.equal(join.status, 201);

        const sendResult = await request('POST', `/groups/${groupId}/messages`, {
            token: member.token,
            body: { body: 'سلام گروه' }
        });
        assert.equal(sendResult.status, 201);
        firstMessageId = sendResult.data.message.id;
    });

    await t.test('a reply references the original message', async () => {
        const reply = await request('POST', `/groups/${groupId}/messages`, {
            token: owner.token,
            body: { body: 'پاسخ به پیام', replyToId: firstMessageId }
        });
        assert.equal(reply.status, 201);
        assert.equal(reply.data.message.reply_to_id, firstMessageId);
    });

    await t.test('the owner can delete any message thanks to full owner permissions', async () => {
        const result = await request('DELETE', `/groups/${groupId}/messages/${firstMessageId}`, {
            token: owner.token
        });
        assert.equal(result.status, 200);
    });

    await t.test('pinning a message requires pin_messages permission', async () => {
        const secondMessage = await request('POST', `/groups/${groupId}/messages`, {
            token: owner.token,
            body: { body: 'پیام قابل پین' }
        });
        const pin = await request('PATCH', `/groups/${groupId}/messages/${secondMessage.data.message.id}/pin`, {
            token: member.token,
            body: { pinned: true }
        });
        assert.equal(pin.status, 403);

        const pinAsOwner = await request(
            'PATCH',
            `/groups/${groupId}/messages/${secondMessage.data.message.id}/pin`,
            { token: owner.token, body: { pinned: true } }
        );
        assert.equal(pinAsOwner.status, 200);
        assert.equal(pinAsOwner.data.message.is_pinned, true);
    });

    await t.test('the owner can edit group info with no explicit edit_info permission on their row', async () => {
        const result = await request('PUT', `/groups/${groupId}`, {
            token: owner.token,
            body: { title: 'گروه آزمایشی (ویرایش‌شده)' }
        });
        assert.equal(result.status, 200);
        assert.equal(result.data.group.title, 'گروه آزمایشی (ویرایش‌شده)');
    });

    await t.test('a plain member without edit_info cannot edit group info, unlike the owner', async () => {
        const result = await request('PUT', `/groups/${groupId}`, {
            token: member.token,
            body: { title: 'تلاش ناموفق عضو' }
        });
        assert.equal(result.status, 403);
        assert.equal(result.data.error, 'ACTION_NOT_PERMITTED');
    });

    await t.test('leaving the group removes membership, and the owner cannot leave', async () => {
        const leave = await request('DELETE', `/groups/${groupId}/members/${member.user.id}`, {
            token: member.token
        });
        assert.equal(leave.status, 200);

        const ownerLeave = await request('DELETE', `/groups/${groupId}/members/${owner.user.id}`, {
            token: owner.token
        });
        assert.equal(ownerLeave.status, 409);
        assert.equal(ownerLeave.data.error, 'OWNER_CANNOT_LEAVE');
    });
});
