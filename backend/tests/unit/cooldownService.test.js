const test = require('node:test');
const assert = require('node:assert/strict');
const { mockModule, freshRequire, servicesDir } = require('../helpers/moduleMock');

function loadService(initialCooldownSeconds) {
    const dir = servicesDir();
    const settings = new Map([['message_cooldown_seconds', String(initialCooldownSeconds)]]);
    const redisStore = new Map();
    const redisTtl = new Map();

    const restoreDb = mockModule('../config/database', dir, {
        query: async (text, params) => {
            if (text.startsWith('SELECT value FROM system_settings')) {
                const value = settings.get(params[0]);
                return { rows: value === undefined ? [] : [{ value }] };
            }
            if (text.startsWith('INSERT INTO system_settings')) {
                settings.set(params[0], params[1]);
                return { rows: [{ key: params[0], value: params[1] }] };
            }
            throw new Error(`Unexpected query in test double: ${text}`);
        }
    });

    const restoreRedis = mockModule('../config/redis', dir, {
        getClient: () => ({
            get: async (key) => (redisStore.has(key) ? redisStore.get(key) : null),
            pttl: async (key) => (redisTtl.has(key) ? redisTtl.get(key) : -2),
            set: async (key, value, mode, ttlMs) => {
                redisStore.set(key, value);
                redisTtl.set(key, ttlMs);
                return 'OK';
            }
        })
    });

    const service = freshRequire('../services/cooldown.service', dir);
    const restore = () => {
        restoreDb();
        restoreRedis();
    };
    return { service, restore, redisStore };
}

test('checkAndApply allows the first message and then blocks an immediate second one', async () => {
    const { service, restore } = loadService(5);
    try {
        const first = await service.checkAndApply({ sub: 42, role: 'employee' });
        assert.equal(first.allowed, true);

        const second = await service.checkAndApply({ sub: 42, role: 'employee' });
        assert.equal(second.allowed, false);
        assert.ok(second.retryAfterMs > 0);
    } finally {
        restore();
    }
});

test('checkAndApply exempts management and super_admin regardless of the cooldown setting', async () => {
    const { service, restore } = loadService(10);
    try {
        const manager = await service.checkAndApply({ sub: 1, role: 'management' });
        const managerAgain = await service.checkAndApply({ sub: 1, role: 'management' });
        const admin = await service.checkAndApply({ sub: 2, role: 'super_admin' });
        assert.equal(manager.allowed, true);
        assert.equal(managerAgain.allowed, true);
        assert.equal(admin.allowed, true);
    } finally {
        restore();
    }
});

test('checkAndApply is a pass-through when the cooldown is disabled', async () => {
    const { service, restore } = loadService(0);
    try {
        const first = await service.checkAndApply({ sub: 5, role: 'employee' });
        const second = await service.checkAndApply({ sub: 5, role: 'employee' });
        assert.equal(first.allowed, true);
        assert.equal(second.allowed, true);
    } finally {
        restore();
    }
});

test('checkAndApply keeps separate cooldown windows per user', async () => {
    const { service, restore } = loadService(5);
    try {
        const userA = await service.checkAndApply({ sub: 100, role: 'employee' });
        const userB = await service.checkAndApply({ sub: 200, role: 'management' });
        assert.equal(userA.allowed, true);
        assert.equal(userB.allowed, true);
    } finally {
        restore();
    }
});

test('setCooldownSeconds normalizes invalid values down to zero', async () => {
    const { service, restore } = loadService(0);
    try {
        assert.equal(await service.setCooldownSeconds(-3), 0);
        assert.equal(await service.setCooldownSeconds(Number.NaN), 0);
        assert.equal(await service.setCooldownSeconds(7.9), 7);
    } finally {
        restore();
    }
});
