const db = require('../config/database');
const redis = require('../config/redis');
const forwardQueue = require('../queue/forwardQueue');
const format = require('../utils/persianFormat.util');

const DEAD_LETTER_LIMIT = 50;
const EMPTY_DEPTHS = { pending: 0, processing: 0, delayed: 0, dead: 0 };

const DEAD_LETTER_SELECT = `
    SELECT d.id, d.channel_id, d.group_id, d.channel_message_id, d.error_message, d.attempts, d.failed_at,
           c.title AS channel_title, g.title AS group_title
    FROM channel_forward_dead_letters d
    LEFT JOIN channels c ON c.id = d.channel_id
    LEFT JOIN groups g ON g.id = d.group_id`;

function serialize(row, now) {
    return {
        id: row.id,
        channel: row.channel_title || 'کانال حذف‌شده',
        group: row.group_title || 'گروه حذف‌شده',
        error: row.error_message || 'خطای نامشخص',
        attempts: row.attempts,
        at: format.dayStamp(new Date(row.failed_at), now)
    };
}

async function overview() {
    const [depths, rows] = await Promise.all([
        forwardQueue.getQueueDepths().catch(() => null),
        db.query(`${DEAD_LETTER_SELECT} ORDER BY d.failed_at DESC LIMIT $1`, [DEAD_LETTER_LIMIT])
    ]);
    const now = new Date();
    return {
        available: depths !== null,
        depths: depths || EMPTY_DEPTHS,
        deadLetters: rows.rows.map((row) => serialize(row, now))
    };
}

async function dropFromDeadList(row) {
    const client = redis.getClient();
    const entries = await client.lrange(forwardQueue.DEAD_KEY, 0, -1);
    const match = entries.find((raw) => {
        const job = forwardQueue.parseJob(raw);
        return job && job.channelMessageId === row.channel_message_id && job.groupId === row.group_id;
    });
    if (match) {
        await client.lrem(forwardQueue.DEAD_KEY, 1, match);
    }
}

async function takeDeadLetter(id) {
    const found = await db.query(`${DEAD_LETTER_SELECT} WHERE d.id = $1`, [id]);
    const row = found.rows[0];
    if (!row) {
        return null;
    }
    const deleted = await db.query('DELETE FROM channel_forward_dead_letters WHERE id = $1 RETURNING id', [id]);
    if (!deleted.rows[0]) {
        return null;
    }
    await dropFromDeadList(row);
    return row;
}

async function retry(id) {
    const row = await takeDeadLetter(id);
    if (!row) {
        return null;
    }
    if (row.channel_id && row.group_id && row.channel_message_id) {
        await forwardQueue.enqueueForward({
            channelId: row.channel_id,
            channelMessageId: row.channel_message_id,
            groupId: row.group_id
        });
    }
    return serialize(row, new Date());
}

async function discard(id) {
    const row = await takeDeadLetter(id);
    return row ? serialize(row, new Date()) : null;
}

module.exports = { overview, retry, discard };
