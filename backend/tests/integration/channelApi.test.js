const test = require('node:test');
const assert = require('node:assert/strict');
const { request, checkServerReachable, loginWithPassword } = require('./helpers/apiClient');
const { hasSuperAdminCredentials, SUPER_ADMIN_PHONE, SUPER_ADMIN_PASSWORD } = require('./helpers/env');
const { createTestUser } = require('./helpers/fixtures');

test('channel API: create, membership, roles, feed posting permissions', async (t) => {
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
    const outsider = await createTestUser(superAdminSession.token, { role: 'employee' });

    let channelId;

    await t.test('owner can create a channel and is granted the owner role', async () => {
        const result = await request('POST', '/channels', {
            token: superAdminSession.token,
            body: { title: 'کانال آزمایشی', visibility: 'public', managerId: owner.user.id }
        });
        assert.equal(result.status, 201);
        channelId = result.data.channel.id;

        const getResult = await request('GET', `/channels/${channelId}`, { token: owner.token });
        assert.equal(getResult.status, 200);
        assert.equal(getResult.data.membership.role, 'owner');
    });

    await t.test('an outsider may self-join because the channel is public', async () => {
        const result = await request('POST', `/channels/${channelId}/members`, {
            token: member.token,
            body: {}
        });
        assert.equal(result.status, 201);
        assert.equal(result.data.member.role, 'member');
    });

    await t.test('a plain member cannot post to the channel (read-only by default)', async () => {
        const result = await request('POST', `/channels/${channelId}/messages`, {
            token: member.token,
            body: { body: 'سلام' }
        });
        assert.equal(result.status, 403);
        assert.equal(result.data.error, 'ACTION_NOT_PERMITTED');
    });

    await t.test('the owner can post to the channel feed', async () => {
        const result = await request('POST', `/channels/${channelId}/messages`, {
            token: owner.token,
            body: { body: 'اطلاعیه اول' }
        });
        assert.equal(result.status, 201);
        assert.equal(result.data.message.body, 'اطلاعیه اول');
    });

    await t.test('promoting the member to admin with post rights lets them post', async () => {
        const promote = await request('PATCH', `/channels/${channelId}/members/${member.user.id}/role`, {
            token: owner.token,
            body: { role: 'admin', permissions: { post: true, manage_members: true } }
        });
        assert.equal(promote.status, 200);
        assert.equal(promote.data.member.role, 'admin');

        const postResult = await request('POST', `/channels/${channelId}/messages`, {
            token: member.token,
            body: { body: 'پست دوم توسط ادمین' }
        });
        assert.equal(postResult.status, 201);
    });

    await t.test('a private channel rejects self-join', async () => {
        const privateResult = await request('POST', '/channels', {
            token: superAdminSession.token,
            body: { title: 'کانال خصوصی', visibility: 'private', managerId: owner.user.id }
        });
        const privateChannelId = privateResult.data.channel.id;
        const joinResult = await request('POST', `/channels/${privateChannelId}/members`, {
            token: outsider.token,
            body: {}
        });
        assert.equal(joinResult.status, 403);
        assert.equal(joinResult.data.error, 'CHANNEL_IS_PRIVATE');
    });

    await t.test('feed messages can be listed with pagination', async () => {
        const list = await request('GET', `/channels/${channelId}/messages?limit=10`, { token: owner.token });
        assert.equal(list.status, 200);
        assert.ok(Array.isArray(list.data.messages));
        assert.ok(list.data.messages.length >= 2);
    });

    await t.test('the owner can edit channel info with no explicit edit_info permission on their row', async () => {
        const result = await request('PUT', `/channels/${channelId}`, {
            token: owner.token,
            body: { title: 'کانال آزمایشی (ویرایش‌شده)' }
        });
        assert.equal(result.status, 200);
        assert.equal(result.data.channel.title, 'کانال آزمایشی (ویرایش‌شده)');
    });

    await t.test('an admin without edit_info cannot edit channel info, unlike the owner', async () => {
        const result = await request('PUT', `/channels/${channelId}`, {
            token: member.token,
            body: { title: 'تلاش ناموفق ادمین' }
        });
        assert.equal(result.status, 403);
        assert.equal(result.data.error, 'ACTION_NOT_PERMITTED');
    });

    await t.test('only the owner can archive (delete) the channel', async () => {
        const forbidden = await request('DELETE', `/channels/${channelId}`, { token: member.token });
        assert.equal(forbidden.status, 403);

        const allowed = await request('DELETE', `/channels/${channelId}`, { token: owner.token });
        assert.equal(allowed.status, 200);
        assert.equal(allowed.data.archived, true);
    });
});
