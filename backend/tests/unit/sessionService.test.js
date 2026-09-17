const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { mockModule, freshRequire, servicesDir } = require('../helpers/moduleMock');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret';

const SESSION_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

function loadService(handler) {
    const dir = servicesDir();
    const queries = [];
    const events = [];
    const restoreDb = mockModule('../config/database', dir, {
        query: async (text, params) => {
            queries.push({ text, params });
            return handler ? handler(text, params) : { rows: [] };
        }
    });
    const restoreNotifier = mockModule('../socket/notifier', dir, {
        notifyAdmins: (event) => events.push(event),
        endSessionSockets: (id) => events.push(`end:${id}`),
        endUserSockets: (id) => events.push(`end-user:${id}`)
    });
    const cache = new Map();
    const cacheWrites = [];
    const restoreRedis = mockModule('../config/redis', dir, {
        getClient: () => ({
            set: async (key, value, ...options) => {
                cacheWrites.push({ key, options });
                cache.set(key, value);
                return 'OK';
            },
            exists: async (key) => (cache.has(key) ? 1 : 0)
        })
    });
    const service = freshRequire('../services/session.service', dir);
    return {
        service,
        queries,
        events,
        cacheWrites,
        restore: () => {
            restoreDb();
            restoreNotifier();
            restoreRedis();
        }
    };
}

function tokenFor(payload) {
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

test('device labels name the browser and operating system', () => {
    const { service, restore } = loadService();
    try {
        assert.equal(
            service.deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
            'Chrome · Windows'
        );
        assert.equal(
            service.deviceLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0'),
            'Edge · Windows'
        );
        assert.equal(
            service.deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1'),
            'Safari · iPhone'
        );
        assert.equal(service.deviceLabel(''), 'دستگاه نامشخص');
    } finally {
        restore();
    }
});

test('issuing a token records a session that expires with the token', async () => {
    const { service, queries, events, restore } = loadService();
    try {
        const token = await service.issue({ id: 5, role: 'employee', phone: '09120000001' }, {
            userAgent: 'Firefox/128.0 (X11; Ubuntu; Linux x86_64)',
            ip: '::ffff:10.20.4.18'
        });
        const payload = jwt.decode(token);
        const insert = queries.find((q) => q.text.includes('INSERT INTO user_sessions'));
        assert.equal(insert.params[0], payload.sid);
        assert.equal(insert.params[1], 5);
        assert.equal(insert.params[3], '10.20.4.18');
        assert.equal(insert.params[4], payload.exp);
        assert.deepEqual(events, ['admin:sessions']);
    } finally {
        restore();
    }
});

test('a token without a session id is rejected before touching the database', async () => {
    const { service, queries, restore } = loadService();
    try {
        const outcome = await service.authenticate(tokenFor({ sub: 5, role: 'employee' }));
        assert.deepEqual(outcome, { error: 'INVALID_TOKEN' });
        assert.equal(queries.length, 0);
    } finally {
        restore();
    }
});

test('a revoked session can no longer authenticate', async () => {
    const { service, restore } = loadService(() => ({
        rows: [{ id: 5, is_active: true, session_id: SESSION_ID, revoked_at: new Date() }]
    }));
    try {
        const outcome = await service.authenticate(tokenFor({ sub: 5, sid: SESSION_ID }));
        assert.deepEqual(outcome, { error: 'SESSION_REVOKED' });
    } finally {
        restore();
    }
});

test('a disabled account is refused even with a live session', async () => {
    const { service, restore } = loadService(() => ({
        rows: [{ id: 5, is_active: false, session_id: SESSION_ID, revoked_at: null }]
    }));
    try {
        const outcome = await service.authenticate(tokenFor({ sub: 5, sid: SESSION_ID }));
        assert.deepEqual(outcome, { error: 'ACCOUNT_DISABLED' });
    } finally {
        restore();
    }
});

test('an active session authenticates and exposes its id', async () => {
    const { service, restore } = loadService(() => ({
        rows: [{ id: 5, role: 'employee', is_active: true, session_id: SESSION_ID, revoked_at: null }]
    }));
    try {
        const outcome = await service.authenticate(tokenFor({ sub: 5, sid: SESSION_ID }));
        assert.equal(outcome.sessionId, SESSION_ID);
        assert.equal(outcome.row.id, 5);
    } finally {
        restore();
    }
});

test('revoking a session disconnects its sockets', async () => {
    const { service, events, restore } = loadService(() => ({
        rows: [{ id: SESSION_ID, user_id: 5, user_agent: null, full_name: 'کاربر' }]
    }));
    try {
        const revoked = await service.revoke(SESSION_ID, 1);
        assert.equal(revoked.user_id, 5);
        assert.deepEqual(events, [`end:${SESSION_ID}`, 'admin:sessions']);
    } finally {
        restore();
    }
});

test('a verified password unlocks sensitive actions only for the same session and only briefly', async () => {
    const { service, cacheWrites, restore } = loadService();
    try {
        assert.equal(await service.isRecentlyReauthenticated(SESSION_ID), false);
        await service.markReauthenticated(SESSION_ID);
        assert.equal(await service.isRecentlyReauthenticated(SESSION_ID), true);
        assert.equal(await service.isRecentlyReauthenticated('7c9e6679-7425-40de-944b-e07fc1f90ae7'), false);
        assert.deepEqual(cacheWrites, [
            { key: `reauth:${SESSION_ID}`, options: ['EX', service.REAUTH_WINDOW_SECONDS] }
        ]);
        await service.markReauthenticated('not-a-session');
        assert.equal(cacheWrites.length, 1);
        assert.equal(await service.isRecentlyReauthenticated(undefined), false);
    } finally {
        restore();
    }
});
