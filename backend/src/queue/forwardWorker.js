const db = require('../config/database');
const forwardQueue = require('./forwardQueue');
const channelMessageService = require('../services/channelMessage.service');
const groupMessageService = require('../services/groupMessage.service');
const channelGroupLinkService = require('../services/channelGroupLink.service');
const notifier = require('../socket/notifier');
const summaryService = require('../services/summary.service');

const POLL_TIMEOUT_SECONDS = 5;
const DELAYED_PROMOTION_INTERVAL_MS = 1000;

let running = false;
let loopPromise = null;
let promotionTimer = null;

async function persistDeadLetter(job, errorMessage) {
    try {
        await db.query(
            `INSERT INTO channel_forward_dead_letters
                (channel_id, group_id, channel_message_id, payload, error_message, attempts)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
            [
                job.channelId || null,
                job.groupId || null,
                job.channelMessageId || null,
                JSON.stringify(job),
                errorMessage || null,
                job.attempts || 0
            ]
        );
    } catch (err) {

        console.error('[forwardWorker] failed to persist dead-letter record:', err.message);
    }
}

async function processJob(job) {
    const channelMessage = await channelMessageService.getChannelMessageById(job.channelMessageId);
    if (!channelMessage || channelMessage.is_deleted) {
        return;
    }

    const link = await channelGroupLinkService.getActiveLinkByChannel(job.channelId);
    if (!link || link.group_id !== job.groupId) {
        return;
    }

    const forwardedMessage = await groupMessageService.createForwardedGroupMessage({
        groupId: link.group_id,
        sourceChannelId: job.channelId,
        sourceMessage: channelMessage
    });

    notifier.notifyGroupMessageForwarded(link.group_id, forwardedMessage, job.channelId);
    summaryService.touch('group', link.group_id);
}

async function runLoop() {
    while (running) {
        let job = null;
        try {
            job = await forwardQueue.dequeueForProcessing(POLL_TIMEOUT_SECONDS);
        } catch (err) {
            console.error('[forwardWorker] dequeue error:', err.message);
            await sleep(1000);
            continue;
        }

        if (!job) {
            continue;
        }

        try {
            await processJob(job);
            await forwardQueue.acknowledge(job);
        } catch (err) {
            console.error(
                `[forwardWorker] failed to forward channel message ${job.channelMessageId} ` +
                `(attempt ${job.attempts + 1}):`,
                err.message
            );
            const outcome = await forwardQueue.retryOrDeadLetter(job, err.message);
            if (outcome.deadLettered) {
                await persistDeadLetter(outcome.job, err.message);
            }
        }
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function start() {
    if (running) {
        return;
    }
    running = true;
    loopPromise = runLoop();
    promotionTimer = setInterval(() => {
        forwardQueue.promoteDueDelayedJobs().catch((err) => {
            console.error('[forwardWorker] failed to promote delayed jobs:', err.message);
        });
    }, DELAYED_PROMOTION_INTERVAL_MS);
}

async function stop() {
    running = false;
    if (promotionTimer) {
        clearInterval(promotionTimer);
        promotionTimer = null;
    }
    if (loopPromise) {
        await loopPromise;
        loopPromise = null;
    }
}

module.exports = {
    start,
    stop,
    processJob
};
