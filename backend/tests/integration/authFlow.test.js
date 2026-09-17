const test = require('node:test');
const assert = require('node:assert/strict');
const { request, checkServerReachable, loginWithPassword } = require('./helpers/apiClient');
const { hasSuperAdminCredentials, SUPER_ADMIN_PHONE, SUPER_ADMIN_PASSWORD, randomTestPhone } = require('./helpers/env');
const { createTestUser, deactivateTestUser } = require('./helpers/fixtures');

test('auth flow against a live backend', async (t) => {
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
    let createdUserId = null;

    await t.test('rejects an invalid phone shape', async () => {
        const result = await request('POST', '/auth/login', { body: { phone: '12345', password: 'x' } });
        assert.equal(result.status, 400);
        assert.equal(result.data.error, 'INVALID_PHONE');
    });

    await t.test('rejects wrong credentials for an existing user', async () => {
        const employee = await createTestUser(superAdminToken, { role: 'employee' });
        createdUserId = employee.user.id;
        const result = await request('POST', '/auth/login', {
            body: { phone: employee.phone, password: 'totally-wrong-password' }
        });
        assert.equal(result.status, 401);
        assert.equal(result.data.error, 'INVALID_CREDENTIALS');
    });

    await t.test('first login without a password yet triggers the setup flow', async () => {
        const phone = randomTestPhone();
        const created = await request('POST', '/users', {
            token: superAdminToken,
            body: { fullName: 'Stage10 Setup Flow', phone, role: 'employee', tagId: null }
        });
        assert.equal(created.status, 201);

        const loginAttempt = await request('POST', '/auth/login', { body: { phone, password: '' } });
        assert.equal(loginAttempt.status, 200);
        assert.equal(loginAttempt.data.needsSetup, true);

        const mismatch = await request('POST', '/auth/set-password', {
            body: { phone, newPassword: 'abcdef1', confirmPassword: 'abcdef2' }
        });
        assert.equal(mismatch.status, 400);
        assert.equal(mismatch.data.error, 'PASSWORD_MISMATCH');

        const setup = await request('POST', '/auth/set-password', {
            body: { phone, newPassword: 'FreshPass123', confirmPassword: 'FreshPass123' }
        });
        assert.equal(setup.status, 200);
        assert.ok(setup.data.token);

        const repeatSetup = await request('POST', '/auth/set-password', {
            body: { phone, newPassword: 'AnotherPass123', confirmPassword: 'AnotherPass123' }
        });
        assert.equal(repeatSetup.status, 409);
        assert.equal(repeatSetup.data.error, 'PASSWORD_ALREADY_SET');

        await deactivateTestUser(superAdminToken, created.data.user.id);
    });

    await t.test('self-service password change requires the current password', async () => {
        const employee = await createTestUser(superAdminToken, { role: 'employee' });
        const wrongCurrent = await request('POST', '/auth/change-password', {
            token: employee.token,
            body: { currentPassword: 'not-the-real-one', newPassword: 'NewPass123', confirmPassword: 'NewPass123' }
        });
        assert.equal(wrongCurrent.status, 401);
        assert.equal(wrongCurrent.data.error, 'CURRENT_PASSWORD_INVALID');

        const changed = await request('POST', '/auth/change-password', {
            token: employee.token,
            body: { currentPassword: employee.password, newPassword: 'NewPass123', confirmPassword: 'NewPass123' }
        });
        assert.equal(changed.status, 200);

        const reLogin = await loginWithPassword(employee.phone, 'NewPass123');
        assert.ok(reLogin.token);

        await deactivateTestUser(superAdminToken, employee.user.id);
    });

    await t.test('a deactivated account can no longer authenticate', async () => {
        const employee = await createTestUser(superAdminToken, { role: 'employee' });
        await deactivateTestUser(superAdminToken, employee.user.id);
        const result = await request('POST', '/auth/login', {
            body: { phone: employee.phone, password: employee.password }
        });
        assert.equal(result.status, 401);
        assert.equal(result.data.error, 'INVALID_CREDENTIALS');
    });

    if (createdUserId) {
        await deactivateTestUser(superAdminToken, createdUserId);
    }
});
