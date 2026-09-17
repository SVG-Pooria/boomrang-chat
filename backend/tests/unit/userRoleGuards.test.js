const test = require('node:test');
const assert = require('node:assert/strict');
const { mockModule, freshRequire, servicesDir } = require('../helpers/moduleMock');

function loadService(users) {
    const dir = servicesDir();
    const updates = [];
    const restoreDb = mockModule('../config/database', dir, {
        pool: {},
        query: async (text, params) => {
            if (text.startsWith('SELECT * FROM users WHERE id')) {
                return { rows: users.filter((user) => user.id === params[0]) };
            }
            if (text.includes("role = 'super_admin' AND is_active = true")) {
                return { rows: [{ count: users.filter((u) => u.role === 'super_admin' && u.is_active).length }] };
            }
            if (text.startsWith('UPDATE users SET role')) {
                updates.push(params);
                const user = users.find((u) => u.id === params[1]);
                return { rows: [{ ...user, role: params[0] }] };
            }
            throw new Error(`Unexpected query in test double: ${text}`);
        }
    });
    const restoreChannel = mockModule('./channel.service', dir, {
        ensureSystemChannelMembership: async () => {}
    });
    const service = freshRequire('../services/user.service', dir);
    return {
        service,
        updates,
        restore: () => {
            restoreDb();
            restoreChannel();
        }
    };
}

const PEOPLE = [
    { id: 1, full_name: 'ادمین', role: 'super_admin', is_active: true, is_bot: false },
    { id: 2, full_name: 'کارمند', role: 'employee', is_active: true, is_bot: false },
    { id: 3, full_name: 'مدیر', role: 'management', is_active: true, is_bot: false }
];

test('a super admin can promote an employee to management', async () => {
    const { service, updates, restore } = loadService(PEOPLE);
    try {
        const result = await service.changeRole(2, 'management', { sub: 1, role: 'super_admin' });
        assert.equal(result.previousRole, 'employee');
        assert.equal(result.user.role, 'management');
        assert.deepEqual(updates, [['management', 2]]);
    } finally {
        restore();
    }
});

test('nobody can change their own role', async () => {
    const { service, updates, restore } = loadService(PEOPLE);
    try {
        await assert.rejects(
            service.changeRole(1, 'employee', { sub: 1, role: 'super_admin' }),
            /CANNOT_CHANGE_OWN_ROLE/
        );
        assert.equal(updates.length, 0);
    } finally {
        restore();
    }
});

test('management keeps the narrow employee-only role rule', async () => {
    const { service, restore } = loadService(PEOPLE);
    try {
        await assert.rejects(
            service.changeRole(2, 'management', { sub: 3, role: 'management' }),
            /ROLE_NOT_ALLOWED/
        );
    } finally {
        restore();
    }
});

test('the last active super admin cannot be demoted', async () => {
    const people = [
        { id: 1, full_name: 'ادمین قدیمی', role: 'super_admin', is_active: false, is_bot: false },
        { id: 4, full_name: 'ادمین فعال', role: 'super_admin', is_active: true, is_bot: false }
    ];
    const { service, restore } = loadService(people);
    try {
        await assert.rejects(
            service.changeRole(4, 'employee', { sub: 1, role: 'super_admin' }),
            /LAST_SUPER_ADMIN/
        );
    } finally {
        restore();
    }
});

test('an admin cannot disable their own account', async () => {
    const { service, restore } = loadService(PEOPLE);
    try {
        await assert.rejects(service.setActive(1, false, { sub: 1, role: 'super_admin' }), /CANNOT_DISABLE_SELF/);
    } finally {
        restore();
    }
});
