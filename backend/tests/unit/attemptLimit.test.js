const test = require('node:test');
const assert = require('node:assert/strict');
const { mockModule, freshRequire, servicesDir } = require('../helpers/moduleMock');

function loadService() {
    const dir = servicesDir();
    const store = new Map();
    const expiries = new Map();
    const restoreRedis = mockModule('../config/redis', dir, {
        getClient: () => ({
            get: async (key) => (store.has(key) ? String(store.get(key)) : null),
            incr: async (key) => {
                const next = (store.get(key) || 0) + 1;
                store.set(key, next);
                return next;
            },
            expire: async (key, seconds) => {
                expiries.set(key, seconds);
                return 1;
            },
            ttl: async (key) => expiries.get(key) || -1,
            del: async (key) => {
                store.delete(key);
                expiries.delete(key);
                return 1;
            }
        })
    });
    const service = freshRequire('../services/attemptLimit.service', dir);
    return { service, store, expiries, restore: restoreRedis };
}

test('consuming attempts blocks once the window allowance is used up', async () => {
    const { service, expiries, restore } = loadService();
    const limit = { prefix: 'limit:test', max: 3, windowSeconds: 120 };
    try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            assert.deepEqual(await service.consume(limit, '10.0.0.5'), { allowed: true });
        }
        assert.deepEqual(await service.consume(limit, '10.0.0.5'), { allowed: false, retryAfterSeconds: 120 });
        assert.deepEqual(await service.consume(limit, '10.0.0.6'), { allowed: true });
        assert.equal(expiries.get('limit:test:10.0.0.5'), 120);
    } finally {
        restore();
    }
});

test('failures only count when registered and a success clears them', async () => {
    const { service, restore } = loadService();
    const limit = service.LIMITS.passwordCheckByUser;
    try {
        for (let attempt = 0; attempt < limit.max; attempt += 1) {
            assert.equal((await service.check(limit, 7)).allowed, true);
            await service.registerFailure(limit, 7);
        }
        const blocked = await service.check(limit, 7);
        assert.equal(blocked.allowed, false);
        assert.equal(blocked.retryAfterSeconds, limit.windowSeconds);
        await service.clear(limit, 7);
        assert.deepEqual(await service.check(limit, 7), { allowed: true });
    } finally {
        restore();
    }
});

test('allowed origins are parsed from a comma separated list', () => {
    const { parseOrigins } = freshRequire('../config/allowedOrigins', servicesDir());
    assert.deepEqual(parseOrigins(' https://chat.example.ir/, http://10.0.0.2:8090 ,,'), [
        'https://chat.example.ir',
        'http://10.0.0.2:8090'
    ]);
    assert.deepEqual(parseOrigins(undefined), []);
});
