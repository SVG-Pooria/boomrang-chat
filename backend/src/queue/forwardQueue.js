const redis = require('../config/redis');

const QUEUE_KEY = 'queue:channel_group_forward';
const PROCESSING_KEY = 'queue:channel_group_forward:processing';
const DELAYED_KEY = 'queue:channel_group_forward:delayed';
const DEAD_KEY = 'queue:channel_group_forward:dead';

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60000;

function computeBackoffDelayMs(attempts) {
    const delay = BASE_DELAY_MS * (2 ** Math.max(0, attempts - 1));
    return Math.min(delay, MAX_DELAY_MS);
}

function serializeJob(job) {
    return JSON.stringify(job);
}

function parseJob(raw) {
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw);
    } catch (err) {
        return null;
    }
}

async function enqueueForward({ channelId, channelMessageId, groupId }) {
    const client = redis.getClient();
    const job = {
        channelId,
        channelMessageId,
        groupId,
        attempts: 0,
        enqueuedAt: Date.now()
    };
    await client.lpush(QUEUE_KEY, serializeJob(job));
    return job;
}

let blockingClient = null;

function getBlockingClient() {
    if (!blockingClient) {
        blockingClient = redis.createDuplicate();
    }
    return blockingClient;
}

async function dequeueForProcessing(timeoutSeconds = 5) {
    const raw = await getBlockingClient().brpoplpush(QUEUE_KEY, PROCESSING_KEY, timeoutSeconds);
    return parseJob(raw);
}

async function acknowledge(job) {
    const client = redis.getClient();
    await client.lrem(PROCESSING_KEY, 1, serializeJob(job));
}

async function retryOrDeadLetter(job, errorMessage) {
    const client = redis.getClient();
    await client.lrem(PROCESSING_KEY, 1, serializeJob(job));

    const nextJob = { ...job, attempts: (job.attempts || 0) + 1, lastError: errorMessage };

    if (nextJob.attempts >= MAX_ATTEMPTS) {
        await client.lpush(DEAD_KEY, serializeJob(nextJob));
        return { deadLettered: true, job: nextJob };
    }

    const runAt = Date.now() + computeBackoffDelayMs(nextJob.attempts);
    await client.zadd(DELAYED_KEY, runAt, serializeJob(nextJob));
    return { deadLettered: false, job: nextJob, runAt };
}

async function promoteDueDelayedJobs() {
    const client = redis.getClient();
    const now = Date.now();
    const due = await client.zrangebyscore(DELAYED_KEY, 0, now);
    if (!due.length) {
        return 0;
    }
    const pipeline = client.pipeline();
    due.forEach((raw) => {
        pipeline.lpush(QUEUE_KEY, raw);
        pipeline.zrem(DELAYED_KEY, raw);
    });
    await pipeline.exec();
    return due.length;
}

async function getQueueDepths() {
    const client = redis.getClient();
    const [pending, processing, delayed, dead] = await Promise.all([
        client.llen(QUEUE_KEY),
        client.llen(PROCESSING_KEY),
        client.zcard(DELAYED_KEY),
        client.llen(DEAD_KEY)
    ]);
    return { pending, processing, delayed, dead };
}

module.exports = {
    QUEUE_KEY,
    PROCESSING_KEY,
    DELAYED_KEY,
    DEAD_KEY,
    MAX_ATTEMPTS,
    computeBackoffDelayMs,
    serializeJob,
    parseJob,
    enqueueForward,
    dequeueForProcessing,
    acknowledge,
    retryOrDeadLetter,
    promoteDueDelayedJobs,
    getQueueDepths
};
