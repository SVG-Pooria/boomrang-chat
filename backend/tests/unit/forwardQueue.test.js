const test = require('node:test');
const assert = require('node:assert/strict');
const forwardQueue = require('../../src/queue/forwardQueue');

test('computeBackoffDelayMs grows exponentially with each attempt', () => {
    const first = forwardQueue.computeBackoffDelayMs(1);
    const second = forwardQueue.computeBackoffDelayMs(2);
    const third = forwardQueue.computeBackoffDelayMs(3);
    assert.equal(first, 1000);
    assert.equal(second, 2000);
    assert.equal(third, 4000);
});

test('computeBackoffDelayMs is capped at the configured ceiling', () => {
    const delay = forwardQueue.computeBackoffDelayMs(20);
    assert.equal(delay, 60000);
});

test('serializeJob/parseJob round-trip a job unchanged', () => {
    const job = { channelId: 1, channelMessageId: 42, groupId: 7, attempts: 0 };
    const raw = forwardQueue.serializeJob(job);
    const parsed = forwardQueue.parseJob(raw);
    assert.deepEqual(parsed, job);
});

test('parseJob returns null for malformed input instead of throwing', () => {
    assert.equal(forwardQueue.parseJob('not-json'), null);
    assert.equal(forwardQueue.parseJob(null), null);
});

test('MAX_ATTEMPTS is a small positive bound so a broken forward cannot retry forever', () => {
    assert.ok(forwardQueue.MAX_ATTEMPTS > 0);
    assert.ok(forwardQueue.MAX_ATTEMPTS <= 10);
});
