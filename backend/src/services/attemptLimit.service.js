const redis = require('../config/redis');

const LIMITS = {
    initialSetupByIp: { prefix: 'limit:setup:ip', max: 10, windowSeconds: 900 },
    initialSetupByPhone: { prefix: 'limit:setup:phone', max: 5, windowSeconds: 900 },
    passwordCheckByUser: { prefix: 'limit:password:user', max: 5, windowSeconds: 900 },
    uploadsByUser: { prefix: 'limit:upload:user', max: 60, windowSeconds: 60 }
};

function keyFor(limit, subject) {
    return `${limit.prefix}:${subject}`;
}

async function blockedFor(client, key, limit) {
    const count = Number(await client.get(key)) || 0;
    if (count < limit.max) {
        return null;
    }
    const ttl = await client.ttl(key);
    return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : limit.windowSeconds };
}

async function increment(client, key, limit) {
    const count = await client.incr(key);
    if (count === 1) {
        await client.expire(key, limit.windowSeconds);
    }
    return count;
}

async function consume(limit, subject) {
    const client = redis.getClient();
    const key = keyFor(limit, subject);
    const blocked = await blockedFor(client, key, limit);
    if (blocked) {
        return blocked;
    }
    await increment(client, key, limit);
    return { allowed: true };
}

async function check(limit, subject) {
    const blocked = await blockedFor(redis.getClient(), keyFor(limit, subject), limit);
    return blocked || { allowed: true };
}

async function registerFailure(limit, subject) {
    return increment(redis.getClient(), keyFor(limit, subject), limit);
}

async function clear(limit, subject) {
    await redis.getClient().del(keyFor(limit, subject));
}

module.exports = { LIMITS, consume, check, registerFailure, clear };
