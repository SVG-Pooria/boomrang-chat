const { request, checkServerReachable, loginWithPassword } = require('../integration/helpers/apiClient');
const { hasSuperAdminCredentials, SUPER_ADMIN_PHONE, SUPER_ADMIN_PASSWORD } = require('../integration/helpers/env');
const { createTestUser, deactivateTestUser } = require('../integration/helpers/fixtures');
const { connectSocket, waitForConnect, waitForEvent, emitWithAck, loadSocketIoClient } = require('../integration/helpers/socketClient');

const EMPLOYEE_COUNT = Number(process.env.LOAD_EMPLOYEE_COUNT || 150);
const MESSAGES_PER_USER = Number(process.env.LOAD_MESSAGES_PER_USER || 3);
const BATCH_SIZE = Number(process.env.LOAD_BATCH_SIZE || 20);
const CLEANUP = process.env.LOAD_CLEANUP !== 'false';

const REMINDER_BURST_COUNT = Number(process.env.LOAD_REMINDER_COUNT || 8);
const REMINDER_CREATE_BATCH_SIZE = Number(process.env.LOAD_REMINDER_BATCH_SIZE || 4);
const REMINDER_FILE_SIZE_MB = Number(process.env.LOAD_REMINDER_FILE_SIZE_MB || 3);
const REMINDER_PROBE_INTERVAL_MS = Number(process.env.LOAD_REMINDER_PROBE_INTERVAL_MS || 250);
const REMINDER_DELIVERY_POLL_INTERVAL_MS = Number(process.env.LOAD_REMINDER_POLL_INTERVAL_MS || 2000);
const REMINDER_DELIVERY_TIMEOUT_MS = Number(process.env.LOAD_REMINDER_TIMEOUT_MS || 90000);
const REMINDER_HEALTHY_LATENCY_MS = Number(process.env.LOAD_REMINDER_HEALTHY_LATENCY_MS || 2000);

class Stats {
    constructor(label) {
        this.label = label;
        this.samples = [];
        this.failures = 0;
    }

    record(durationMs) {
        this.samples.push(durationMs);
    }

    fail() {
        this.failures += 1;
    }

    percentile(p) {
        if (this.samples.length === 0) {
            return 0;
        }
        const sorted = [...this.samples].sort((a, b) => a - b);
        const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
        return sorted[index];
    }

    report() {
        const total = this.samples.length + this.failures;
        const avg = this.samples.length
            ? Math.round(this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length)
            : 0;
        console.log(
            `${this.label}: total=${total} ok=${this.samples.length} failed=${this.failures} ` +
            `avg=${avg}ms p50=${this.percentile(50)}ms p95=${this.percentile(95)}ms p99=${this.percentile(99)}ms`
        );
    }
}

async function inBatches(items, batchSize, worker) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(worker));
        results.push(...batchResults);
    }
    return results;
}

async function timed(stats, fn) {
    const startedAt = Date.now();
    try {
        const result = await fn();
        stats.record(Date.now() - startedAt);
        return result;
    } catch (err) {
        stats.fail();
        throw err;
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildReminderForm({ index, targetType, targetId, buffer }) {
    const form = new FormData();
    form.append('title', `یادآوری بار سنگین ${index}`);
    form.append('message', `پیوست حجیم شماره ${index} برای آزمایش بار همزمان`);
    form.append('targetType', targetType);
    form.append('targetId', String(targetId));
    form.append('scheduledAt', new Date(Date.now() - 2000).toISOString());
    form.append('mode', 'file');
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    form.append('file', blob, `load-reminder-${index}.bin`);
    return form;
}

async function waitForReminderDelivery(token, reminderId, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await request('GET', `/admin/bot/reminders/${reminderId}/deliveries`, { token });
        const delivery = (result.data.deliveries || [])[0];
        if (delivery) {
            return delivery;
        }
        await sleep(REMINDER_DELIVERY_POLL_INTERVAL_MS);
    }
    throw new Error(`Timed out waiting for reminder #${reminderId} to be delivered`);
}

async function probeServerHealth(stats, isDone) {
    while (!isDone()) {
        await timed(stats, () => request('GET', '/health')).catch(() => {});
        await sleep(REMINDER_PROBE_INTERVAL_MS);
    }
}

/**
 * Step 42: fires several bot reminders at once, each carrying its own large file
 * attachment, targeting a channel and a group in equal measure. While
 * runDueReminders() (bot.service.js) works through cloning every attachment and
 * delivering every message, this scenario keeps hammering a cheap, unrelated
 * endpoint (/health) on a short interval. If cloning the attachments blocks the
 * server's event loop, those health probes stack up and their latency spikes;
 * if the send loop stays responsive (sequential-but-non-blocking, or
 * concurrent with a concurrency cap), probe latency should stay flat regardless
 * of how many reminders are in flight.
 */
async function runReminderAttachmentBurstScenario(superAdminToken) {
    console.log(
        `\nPreparing bot reminder attachment burst: ${REMINDER_BURST_COUNT} reminders x ` +
        `${REMINDER_FILE_SIZE_MB}MB, split across a channel and a group...`
    );

    const owner = await createTestUser(superAdminToken, { role: 'employee' });

    const channelResult = await request('POST', '/channels', {
        token: superAdminToken,
        body: { title: `کانال بار سنگین ${Date.now()}`, visibility: 'public', managerId: owner.user.id }
    });
    const groupResult = await request('POST', '/groups', {
        token: superAdminToken,
        body: { title: `گروه بار سنگین ${Date.now()}`, visibility: 'public', managerId: owner.user.id }
    });
    if (channelResult.status !== 201 || groupResult.status !== 201) {
        console.error('Could not create the channel/group needed for the reminder burst scenario, skipping it.');
        return;
    }
    const channel = channelResult.data.channel;
    const group = groupResult.data.group;

    const largeBuffer = Buffer.alloc(REMINDER_FILE_SIZE_MB * 1024 * 1024, 'x');

    const creationStats = new Stats('reminder creation (upload + insert)');
    const indexes = Array.from({ length: REMINDER_BURST_COUNT }, (_, i) => i);
    const reminders = await inBatches(indexes, REMINDER_CREATE_BATCH_SIZE, (index) =>
        timed(creationStats, async () => {
            const targetType = index % 2 === 0 ? 'channel' : 'group';
            const targetId = targetType === 'channel' ? channel.id : group.id;
            const form = buildReminderForm({ index, targetType, targetId, buffer: largeBuffer });
            const result = await request('POST', '/admin/bot/reminders', { token: superAdminToken, formData: form });
            if (result.status !== 201) {
                throw new Error(`Reminder #${index} creation failed: ${JSON.stringify(result.data)}`);
            }
            return result.data.reminder;
        })
    );
    creationStats.report();

    console.log('All reminders are due; waiting for the scheduler to deliver them while probing server health...');
    let probingDone = false;
    const probeStats = new Stats('server health during reminder burst');
    const probePromise = probeServerHealth(probeStats, () => probingDone);

    const deliveryStats = new Stats('reminder delivery confirmation');
    const deliveryResults = await Promise.allSettled(
        reminders.map((reminder) =>
            timed(deliveryStats, () => waitForReminderDelivery(superAdminToken, reminder.id, REMINDER_DELIVERY_TIMEOUT_MS))
        )
    );

    probingDone = true;
    await probePromise;

    deliveryStats.report();
    probeStats.report();

    const failedDeliveries = deliveryResults.filter((outcome) => outcome.status === 'rejected').length;
    if (failedDeliveries > 0) {
        console.error(`${failedDeliveries} of ${reminders.length} reminders were not delivered before the timeout.`);
    }

    const p95ProbeLatency = probeStats.percentile(95);
    if (p95ProbeLatency > REMINDER_HEALTHY_LATENCY_MS) {
        console.warn(
            `WARNING: p95 /health latency during the reminder burst was ${p95ProbeLatency}ms, above the ` +
            `${REMINDER_HEALTHY_LATENCY_MS}ms threshold. This suggests attachment cloning in runDueReminders ` +
            'is blocking the server instead of processing reminders concurrently with a bounded pool.'
        );
    } else {
        console.log(`Server stayed responsive during the burst (p95 /health latency: ${p95ProbeLatency}ms).`);
    }

    if (CLEANUP) {
        console.log('Cleaning up burst reminders and test user...');
        await inBatches(reminders, REMINDER_CREATE_BATCH_SIZE, (reminder) =>
            request('DELETE', `/admin/bot/reminders/${reminder.id}`, { token: superAdminToken }).catch(() => {})
        );
        await deactivateTestUser(superAdminToken, owner.user.id);
    } else {
        console.log('Skipping reminder burst cleanup (LOAD_CLEANUP=false); reminders and test user remain.');
    }
}

async function run() {
    const reachable = await checkServerReachable();
    if (!reachable) {
        console.error('No backend reachable at TEST_BASE_URL. Start the server first, then re-run this script.');
        process.exitCode = 1;
        return;
    }
    if (!hasSuperAdminCredentials()) {
        console.error('Set TEST_SUPER_ADMIN_PHONE and TEST_SUPER_ADMIN_PASSWORD before running the load test.');
        process.exitCode = 1;
        return;
    }
    if (!loadSocketIoClient()) {
        console.error('socket.io-client is not installed. Run "npm install" in backend/ before running the load test.');
        process.exitCode = 1;
        return;
    }

    console.log(`Preparing ${EMPLOYEE_COUNT} test employees in batches of ${BATCH_SIZE}...`);
    const superAdminSession = await loginWithPassword(SUPER_ADMIN_PHONE, SUPER_ADMIN_PASSWORD);
    const superAdminToken = superAdminSession.token;

    const creationStats = new Stats('user creation');
    const users = await inBatches(
        Array.from({ length: EMPLOYEE_COUNT }, (_, i) => i),
        BATCH_SIZE,
        () => timed(creationStats, () => createTestUser(superAdminToken, { role: 'employee' }))
    );
    creationStats.report();

    console.log('Logging every user back in and connecting sockets...');
    const loginStats = new Stats('login');
    const socketConnectStats = new Stats('socket connect');
    const sockets = [];

    await inBatches(users, BATCH_SIZE, async (user) => {
        await timed(loginStats, () => loginWithPassword(user.phone, user.password));
        const socket = connectSocket(user.token);
        await timed(socketConnectStats, () => waitForConnect(socket, 10000));
        sockets.push(socket);
    });
    loginStats.report();
    socketConnectStats.report();

    console.log('Listing conversations for every user...');
    const listStats = new Stats('list conversations');
    await inBatches(users, BATCH_SIZE, (user) =>
        timed(listStats, () => request('GET', '/conversations', { token: user.token }))
    );
    listStats.report();

    console.log(`Sending ${MESSAGES_PER_USER} messages per user across paired conversations...`);
    const messageStats = new Stats('message send');
    const pairs = [];
    for (let i = 0; i + 1 < users.length; i += 2) {
        pairs.push([users[i], users[i + 1]]);
    }

    await inBatches(pairs, Math.max(1, Math.floor(BATCH_SIZE / 2)), async ([userA, userB]) => {
        const socketA = sockets[users.indexOf(userA)];
        const socketB = sockets[users.indexOf(userB)];
        for (let i = 0; i < MESSAGES_PER_USER; i += 1) {
            try {
                const incoming = waitForEvent(socketB, 'message:new', 8000);
                await timed(messageStats, async () => {
                    const ack = await emitWithAck(socketA, 'message:send', {
                        targetUserId: userB.user.id,
                        body: `load test message ${i + 1} from ${userA.user.fullName}`
                    });
                    if (ack.error) {
                        if (ack.error !== 'COOLDOWN_ACTIVE') {
                            throw new Error(ack.error);
                        }
                    }
                    return ack;
                });
                await incoming.catch(() => {});
            } catch (err) {
                continue;
            }
        }
    });
    messageStats.report();

    console.log('Disconnecting sockets...');
    sockets.forEach((socket) => socket.disconnect());

    if (CLEANUP) {
        console.log('Deactivating test users...');
        await inBatches(users, BATCH_SIZE, (user) => deactivateTestUser(superAdminToken, user.user.id));
    } else {
        console.log('Skipping cleanup (LOAD_CLEANUP=false); test users remain active.');
    }

    await runReminderAttachmentBurstScenario(superAdminToken);

    console.log('Load test complete.');
}

run().catch((err) => {
    console.error('Load test failed:', err.message);
    process.exitCode = 1;
});
