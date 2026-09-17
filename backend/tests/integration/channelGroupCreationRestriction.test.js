const test = require('node:test');
const assert = require('node:assert/strict');
const { request, checkServerReachable, loginWithPassword } = require('./helpers/apiClient');
const { hasSuperAdminCredentials, SUPER_ADMIN_PHONE, SUPER_ADMIN_PASSWORD } = require('./helpers/env');
const { createTestUser } = require('./helpers/fixtures');

test('channel/group creation and manager assignment are super_admin-only', async (t) => {
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
    const employee = await createTestUser(superAdminSession.token, { role: 'employee' });
    const management = await createTestUser(superAdminSession.token, { role: 'management' });
    const futureManager = await createTestUser(superAdminSession.token, { role: 'employee' });
    const nextManager = await createTestUser(superAdminSession.token, { role: 'employee' });

    let channelId;
    let groupId;

    await t.test('an employee cannot create a channel', async () => {
        const result = await request('POST', '/channels', {
            token: employee.token,
            body: { title: 'کانال غیرمجاز' }
        });
        assert.equal(result.status, 403);
    });

    await t.test('a management user cannot create a channel either - only super_admin may', async () => {
        const result = await request('POST', '/channels', {
            token: management.token,
            body: { title: 'کانال غیرمجاز مدیریت' }
        });
        assert.equal(result.status, 403);
    });

    await t.test('an employee cannot create a group', async () => {
        const result = await request('POST', '/groups', {
            token: employee.token,
            body: { title: 'گروه غیرمجاز' }
        });
        assert.equal(result.status, 403);
    });

    await t.test('super_admin can create a channel and delegate a manager', async () => {
        const result = await request('POST', '/channels', {
            token: superAdminSession.token,
            body: { title: 'کانال ادمین کل', visibility: 'public', managerId: futureManager.user.id }
        });
        assert.equal(result.status, 201);
        channelId = result.data.channel.id;

        assert.equal(Object.prototype.hasOwnProperty.call(result.data.channel, 'created_by'), false);

        const membersResult = await request('GET', `/channels/${channelId}/members`, { token: futureManager.token });
        assert.equal(membersResult.status, 200);
        const managerMembership = membersResult.data.members.find((m) => m.userId === futureManager.user.id);
        assert.equal(managerMembership.role, 'owner');

        const superAdminAsMember = membersResult.data.members.find((m) => m.userId === superAdminSession.user.id);
        assert.equal(superAdminAsMember, undefined);
    });

    await t.test('super_admin can create a group and delegate a manager', async () => {
        const result = await request('POST', '/groups', {
            token: superAdminSession.token,
            body: { title: 'گروه ادمین کل', visibility: 'public', managerId: futureManager.user.id }
        });
        assert.equal(result.status, 201);
        groupId = result.data.group.id;
        assert.equal(Object.prototype.hasOwnProperty.call(result.data.group, 'created_by'), false);
    });

    await t.test('the delegated manager cannot reassign who manages the channel', async () => {
        const result = await request('PATCH', `/channels/${channelId}/manager`, {
            token: futureManager.token,
            body: { userId: nextManager.user.id }
        });
        assert.equal(result.status, 403);
    });

    await t.test('only super_admin can transfer the channel manager seat', async () => {
        const addResult = await request('POST', `/channels/${channelId}/members`, {
            token: futureManager.token,
            body: { userId: nextManager.user.id }
        });
        assert.equal(addResult.status, 201);

        const transferResult = await request('PATCH', `/channels/${channelId}/manager`, {
            token: superAdminSession.token,
            body: { userId: nextManager.user.id }
        });
        assert.equal(transferResult.status, 200);

        const membersResult = await request('GET', `/channels/${channelId}/members`, { token: nextManager.token });
        const newOwner = membersResult.data.members.find((m) => m.userId === nextManager.user.id);
        assert.equal(newOwner.role, 'owner');

        const previousManager = membersResult.data.members.find((m) => m.userId === futureManager.user.id);
        assert.equal(previousManager.role, 'admin');
        assert.equal(previousManager.permissions.manage_admins, true);
    });

    await t.test('only super_admin can transfer the group manager seat', async () => {
        const transferResult = await request('PATCH', `/groups/${groupId}/manager`, {
            token: superAdminSession.token,
            body: { userId: nextManager.user.id }
        });
        assert.equal(transferResult.status, 200);
    });
});
