const test = require('node:test');
const assert = require('node:assert/strict');
const { request, checkServerReachable, loginWithPassword } = require('./helpers/apiClient');
const {
    hasSuperAdminCredentials,
    SUPER_ADMIN_PHONE,
    SUPER_ADMIN_PASSWORD
} = require('./helpers/env');
const { createTestUser } = require('./helpers/fixtures');
const channelCoreService = require('../../src/services/channelCore.service');
const groupCoreService = require('../../src/services/groupCore.service');

test('channel <-> group linking: create, duplicate prevention, permissions, unlink', async (t) => {
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
    const outsider = await createTestUser(superAdminSession.token, { role: 'employee' });

    const channel = await channelCoreService.createChannel({
        title: 'کانال تست پیوند',
        ownerId: owner.user.id,
        visibility: 'public'
    });
    const group = await groupCoreService.createGroup({
        title: 'گروه تست پیوند',
        ownerId: owner.user.id,
        visibility: 'public'
    });
    const strangerGroup = await groupCoreService.createGroup({
        title: 'گروه غریبه',
        ownerId: outsider.user.id,
        visibility: 'public'
    });
    const secondChannel = await channelCoreService.createChannel({
        title: 'کانال دوم',
        ownerId: owner.user.id,
        visibility: 'public'
    });

    await t.test('link-status starts unlinked', async () => {
        const result = await request('GET', `/channels/${channel.id}/link-status`, { token: owner.token });
        assert.equal(result.status, 200);
        assert.equal(result.data.linked, false);
    });

    await t.test('an outsider without manage_link cannot link the channel', async () => {
        const result = await request('POST', `/channels/${channel.id}/link`, {
            token: outsider.token,
            body: { groupId: group.id }
        });
        assert.equal(result.status, 403);
    });

    await t.test('linking someone else\'s group without permission on that group is rejected', async () => {
        const result = await request('POST', `/channels/${channel.id}/link`, {
            token: owner.token,
            body: { groupId: strangerGroup.id }
        });
        assert.equal(result.status, 403);
    });

    await t.test('the channel owner can link an existing group they own', async () => {
        const result = await request('POST', `/channels/${channel.id}/link`, {
            token: owner.token,
            body: { groupId: group.id }
        });
        assert.equal(result.status, 201);
        assert.equal(result.data.linked, true);
        assert.equal(result.data.group.id, group.id);
    });

    await t.test('link-status now reflects the active link', async () => {
        const result = await request('GET', `/channels/${channel.id}/link-status`, { token: owner.token });
        assert.equal(result.status, 200);
        assert.equal(result.data.linked, true);
        assert.equal(result.data.group.id, group.id);
    });

    await t.test('the same channel cannot be linked to a second group', async () => {
        const anotherGroup = await groupCoreService.createGroup({
            title: 'گروه دیگر',
            ownerId: owner.user.id,
            visibility: 'public'
        });
        const result = await request('POST', `/channels/${channel.id}/link`, {
            token: owner.token,
            body: { groupId: anotherGroup.id }
        });
        assert.equal(result.status, 409);
        assert.equal(result.data.error, 'CHANNEL_ALREADY_LINKED');
    });

    await t.test('a group that is already linked cannot be linked to a second channel', async () => {
        const result = await request('POST', `/channels/${secondChannel.id}/link`, {
            token: owner.token,
            body: { groupId: group.id }
        });
        assert.equal(result.status, 409);
        assert.equal(result.data.error, 'GROUP_ALREADY_LINKED');
    });

    await t.test('the owner can unlink, and the group is free to be linked again afterwards', async () => {
        const unlinkResult = await request('DELETE', `/channels/${channel.id}/link`, { token: owner.token });
        assert.equal(unlinkResult.status, 200);
        assert.equal(unlinkResult.data.unlinked, true);

        const statusAfter = await request('GET', `/channels/${channel.id}/link-status`, { token: owner.token });
        assert.equal(statusAfter.data.linked, false);

        const relinkResult = await request('POST', `/channels/${secondChannel.id}/link`, {
            token: owner.token,
            body: { groupId: group.id }
        });
        assert.equal(relinkResult.status, 201);
    });

    await t.test('creating a brand new group inline while linking works in one step', async () => {
        const thirdChannel = await channelCoreService.createChannel({
            title: 'کانال سوم',
            ownerId: owner.user.id,
            visibility: 'public'
        });
        const result = await request('POST', `/channels/${thirdChannel.id}/link`, {
            token: owner.token,
            body: { newGroup: { title: 'گروه تازه ساخته شده' } }
        });
        assert.equal(result.status, 201);
        assert.equal(result.data.linked, true);
        assert.ok(result.data.group.id);
    });
});
