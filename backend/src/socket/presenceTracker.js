const db = require('../config/database');
const redis = require('../config/redis');
const presenceService = require('../services/presence.service');
const { isHiddenRole } = require('../config/visibility');

const SOCKET_SET_PREFIX = 'presence:sockets:';
const LEGACY_COUNTER_PATTERN = 'presence:socketcount:*';

function socketSetKey(userId) {
    return `${SOCKET_SET_PREFIX}${userId}`;
}

async function registerConnection(userId, socketId) {
    const client = redis.getClient();
    await client.sadd(socketSetKey(userId), socketId);
    await presenceService.markOnline(userId);
    return client.scard(socketSetKey(userId));
}

async function registerDisconnection(userId, socketId) {
    const client = redis.getClient();
    await client.srem(socketSetKey(userId), socketId);
    const remaining = await client.scard(socketSetKey(userId));
    if (remaining === 0) {
        await presenceService.markOffline(userId);
    }
    return remaining;
}

async function scanKeys(client, pattern) {
    const keys = [];
    let cursor = '0';
    do {
        const [next, batch] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        keys.push(...batch);
    } while (cursor !== '0');
    return keys;
}

async function reconcile(io) {
    const client = redis.getClient();
    const liveSockets = await io.fetchSockets();
    const liveSocketIds = new Set(liveSockets.map((socket) => socket.id));
    const connectedUserIds = [...new Set(liveSockets.map((socket) => socket.data && socket.data.userId).filter(Boolean))];

    const legacyCounters = await scanKeys(client, LEGACY_COUNTER_PATTERN);
    if (legacyCounters.length) {
        await client.del(...legacyCounters);
    }

    for (const key of await scanKeys(client, `${SOCKET_SET_PREFIX}*`)) {
        const stale = (await client.smembers(key)).filter((socketId) => !liveSocketIds.has(socketId));
        if (stale.length) {
            await client.srem(key, ...stale);
        }
    }

    const cleared = await db.query(
        `UPDATE presence SET status = 'offline'
         WHERE status = 'online' AND NOT (user_id = ANY($1::int[]))
         RETURNING user_id`,
        [connectedUserIds]
    );
    if (cleared.rows.length) {
        const users = await db.query('SELECT id, role FROM users WHERE id = ANY($1::int[])', [
            cleared.rows.map((row) => row.user_id)
        ]);
        users.rows
            .filter((user) => !isHiddenRole(user.role))
            .forEach((user) => io.emit('presence:update', { userId: user.id, status: 'offline' }));
    }
    return { markedOffline: cleared.rows.length };
}

module.exports = { registerConnection, registerDisconnection, reconcile };
