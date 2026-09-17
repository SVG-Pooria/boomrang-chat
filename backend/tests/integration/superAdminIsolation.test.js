const test = require('node:test');
const assert = require('node:assert/strict');
const { request, checkServerReachable, loginWithPassword } = require('./helpers/apiClient');
const { hasSuperAdminCredentials, SUPER_ADMIN_PHONE, SUPER_ADMIN_PASSWORD } = require('./helpers/env');
const { createTestUser, deactivateTestUser } = require('./helpers/fixtures');

test('super admin conversational isolation against a live backend', async (t) => {
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
    const superAdminId = superAdminSession.user.id;

    const employee = await createTestUser(superAdminToken, { role: 'employee' });

    await t.test('super_admin never appears in the organization directory', async () => {
        const result = await request('GET', '/users/directory', { token: employee.token });
        assert.equal(result.status, 200);
        const match = result.data.users.find((u) => u.id === superAdminId);
        assert.equal(match, undefined, 'super_admin must not be listed in the directory');
    });

    await t.test('an employee cannot open a direct conversation targeting super_admin', async () => {
        const result = await request('POST', '/conversations/direct', {
            token: employee.token,
            body: { targetUserId: superAdminId }
        });
        assert.equal(result.status, 403);
        assert.equal(result.data.error, 'SUPER_ADMIN_NOT_REACHABLE');
    });

    await t.test('super_admin cannot open a direct conversation targeting an employee either', async () => {
        const result = await request('POST', '/conversations/direct', {
            token: superAdminToken,
            body: { targetUserId: employee.user.id }
        });
        assert.equal(result.status, 403);
        assert.equal(result.data.error, 'SUPER_ADMIN_NOT_REACHABLE');
    });

    await deactivateTestUser(superAdminToken, employee.user.id);
});
