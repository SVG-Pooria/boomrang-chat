const test = require('node:test');
const assert = require('node:assert/strict');
const { mockModule, freshRequire, servicesDir } = require('../helpers/moduleMock');

function loadTracker({ queryHandler } = {}) {
    const dir = servicesDir();
    const sets = new Map();
    const strings = new Map();
    const presenceCalls = [];
    const queries = [];

    const restoreRedis = mockModule('../config/redis', dir, {
        getClient: () => ({
            sadd: async (key, ...members) => {
                const set = sets.get(key) || new Set();
                members.forEach((member) => set.add(member));
                sets.set(key, set);
                return members.length;
            },
            srem: async (key, ...members) => {
                const set = sets.get(key);
                if (!set) return 0;
                members.forEach((member) => set.delete(member));
                if (set.size === 0) sets.delete(key);
                return members.length;
            },
            scard: async (key) => (sets.get(key) ? sets.get(key).size : 0),
            smembers: async (key) => [...(sets.get(key) || [])],
            scan: async (cursor, match, pattern) => {
                const prefix = pattern.replace('*', '');
                const keys = [...sets.keys(), ...strings.keys()].filter((key) => key.startsWith(prefix));
                return ['0', keys];
            },
            del: async (...keys) => {
                keys.forEach((key) => {
                    strings.delete(key);
                    sets.delete(key);
                });
                return keys.length;
            }
        })
    });
    const restoreDb = mockModule('../config/database', dir, {
        query: async (text, params) => {
            queries.push({ text, params });
            return queryHandler ? queryHandler(text, params) : { rows: [] };
        }
    });
    const restorePresence = mockModule('./presence.service', dir, {
        markOnline: async (userId) => presenceCalls.push(['online', userId]),
        markOffline: async (userId) => presenceCalls.push(['offline', userId])
    });
    const tracker = freshRequire('../socket/presenceTracker', dir);
    return {
        tracker,
        sets,
        strings,
        presenceCalls,
        queries,
        restore: () => {
            restoreRedis();
            restoreDb();
            restorePresence();
        }
    };
}

test('a user stays online until their last socket disconnects', async () => {
    const { tracker, presenceCalls, restore } = loadTracker();
    try {
        assert.equal(await tracker.registerConnection(5, 'tab-a'), 1);
        assert.equal(await tracker.registerConnection(5, 'tab-b'), 2);
        assert.equal(await tracker.registerDisconnection(5, 'tab-a'), 1);
        assert.deepEqual(presenceCalls.filter(([state]) => state === 'offline'), []);
        assert.equal(await tracker.registerDisconnection(5, 'tab-b'), 0);
        assert.deepEqual(presenceCalls.at(-1), ['offline', 5]);
    } finally {
        restore();
    }
});

test('a repeated disconnect never leaves a negative or phantom count', async () => {
    const { tracker, sets, restore } = loadTracker();
    try {
        await tracker.registerConnection(8, 'only-tab');
        assert.equal(await tracker.registerDisconnection(8, 'only-tab'), 0);
        assert.equal(await tracker.registerDisconnection(8, 'only-tab'), 0);
        assert.equal(sets.has('presence:sockets:8'), false);
    } finally {
        restore();
    }
});

test('reconciling after a restart drops stale sockets and clears ghost presence', async () => {
    const { tracker, sets, strings, queries, restore } = loadTracker({
        queryHandler: (text) => {
            if (text.includes('UPDATE presence')) return { rows: [{ user_id: 8 }, { user_id: 7 }] };
            if (text.includes('SELECT id, role FROM users')) {
                return { rows: [{ id: 8, role: 'employee' }, { id: 7, role: 'super_admin' }] };
            }
            return { rows: [] };
        }
    });
    try {
        sets.set('presence:sockets:5', new Set(['live-socket', 'dead-socket']));
        sets.set('presence:sockets:8', new Set(['dead-socket-2']));
        strings.set('presence:socketcount:5', '6');
        const emitted = [];
        const io = {
            fetchSockets: async () => [{ id: 'live-socket', data: { userId: 5 } }],
            emit: (event, payload) => emitted.push([event, payload])
        };

        const outcome = await tracker.reconcile(io);

        assert.deepEqual([...sets.get('presence:sockets:5')], ['live-socket']);
        assert.equal(sets.has('presence:sockets:8'), false);
        assert.equal(strings.has('presence:socketcount:5'), false);
        const update = queries.find((q) => q.text.includes('UPDATE presence'));
        assert.deepEqual(update.params, [[5]]);
        assert.deepEqual(emitted, [['presence:update', { userId: 8, status: 'offline' }]]);
        assert.deepEqual(outcome, { markedOffline: 2 });
    } finally {
        restore();
    }
});
