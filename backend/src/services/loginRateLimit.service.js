const redis = require('../config/redis');

const WINDOW_SECONDS = 300;
const MAX_ATTEMPTS_PER_PHONE = 5;
const MAX_ATTEMPTS_PER_IP = 20;

function phoneKey(phone) {
    return `login:fail:phone:${phone}`;
}

function ipKey(ip) {
    return `login:fail:ip:${ip}`;
}

async function readCounter(client, key) {
    const raw = await client.get(key);
    return raw ? Number(raw) : 0;
}

async function check(phone, ip) {
    const client = redis.getClient();
    const keys = [
        { key: phoneKey(phone), max: MAX_ATTEMPTS_PER_PHONE },
        { key: ipKey(ip), max: MAX_ATTEMPTS_PER_IP }
    ];
    for (const entry of keys) {
        const attempts = await readCounter(client, entry.key);
        if (attempts >= entry.max) {
            const ttl = await client.ttl(entry.key);
            return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS };
        }
    }
    return { allowed: true };
}

async function registerFailure(phone, ip) {
    const client = redis.getClient();
    const counts = [];
    for (const key of [phoneKey(phone), ipKey(ip)]) {
        const attempts = await client.incr(key);
        if (attempts === 1) {
            await client.expire(key, WINDOW_SECONDS);
        }
        counts.push(attempts);
    }
    return { phoneAttempts: counts[0], ipAttempts: counts[1] };
}

async function clearFailures(phone, ip) {
    const client = redis.getClient();
    await client.del(phoneKey(phone), ipKey(ip));
}

module.exports = {
    WINDOW_SECONDS,
    MAX_ATTEMPTS_PER_PHONE,
    MAX_ATTEMPTS_PER_IP,
    check,
    registerFailure,
    clearFailures
};
