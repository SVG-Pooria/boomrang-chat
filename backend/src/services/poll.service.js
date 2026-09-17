const db = require('../config/database');
const format = require('../utils/persianFormat.util');
const targetService = require('./workspaceTarget.service');

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

async function serialize(pollId, viewerUserId) {
    const pollResult = await db.query(
        `SELECT p.*, u.full_name AS creator_name
         FROM polls p
         LEFT JOIN users u ON u.id = p.created_by
         WHERE p.id = $1`,
        [pollId]
    );
    const poll = pollResult.rows[0];
    if (!poll) {
        return null;
    }
    const optionsResult = await db.query(
        `SELECT o.id, o.label, o.position,
                (SELECT count(*)::int FROM poll_votes v WHERE v.option_id = o.id) AS votes
         FROM poll_options o
         WHERE o.poll_id = $1
         ORDER BY o.position`,
        [pollId]
    );
    const mine = await db.query('SELECT option_id FROM poll_votes WHERE poll_id = $1 AND user_id = $2', [
        pollId,
        viewerUserId
    ]);
    const totalVotes = optionsResult.rows.reduce((sum, row) => sum + row.votes, 0);
    return {
        pollId: poll.id,
        messageId: poll.message_id,
        question: poll.question,
        isClosed: poll.is_closed,
        createdBy: poll.creator_name || 'همکار',
        totalVotes,
        totalVotesLabel: `${format.toPersianDigits(totalVotes)} رأی`,
        myOptionId: mine.rows[0] ? mine.rows[0].option_id : null,
        options: optionsResult.rows.map((row) => ({
            id: row.id,
            label: row.label,
            votes: row.votes,
            votesLabel: format.toPersianDigits(row.votes),
            percent: format.percent(row.votes, totalVotes)
        }))
    };
}

async function createPoll({ targetType, targetId, question, options, createdBy, messageId }) {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const inserted = await client.query(
            `INSERT INTO polls (target_type, target_id, question, created_by, message_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [targetType, targetId, question, createdBy, messageId || null]
        );
        const pollId = inserted.rows[0].id;
        for (let index = 0; index < options.length; index += 1) {
            await client.query(
                'INSERT INTO poll_options (poll_id, label, position) VALUES ($1, $2, $3)',
                [pollId, options[index], index]
            );
        }
        await client.query('COMMIT');
        return serialize(pollId, createdBy);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function vote(pollId, optionId, userId) {
    const poll = await db.query('SELECT * FROM polls WHERE id = $1', [pollId]);
    if (!poll.rows[0]) {
        return { error: 'NOT_FOUND' };
    }
    if (poll.rows[0].is_closed) {
        return { error: 'POLL_CLOSED' };
    }
    const option = await db.query('SELECT id FROM poll_options WHERE id = $1 AND poll_id = $2', [
        optionId,
        pollId
    ]);
    if (!option.rows[0]) {
        return { error: 'INVALID_OPTION' };
    }
    await db.query(
        `INSERT INTO poll_votes (poll_id, option_id, user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (poll_id, user_id) DO UPDATE SET option_id = $2, voted_at = now()`,
        [pollId, optionId, userId]
    );
    return { poll: await serialize(pollId, userId), targetType: poll.rows[0].target_type, targetId: poll.rows[0].target_id };
}

async function closePoll(pollId, viewer) {
    const poll = await db.query('SELECT * FROM polls WHERE id = $1', [pollId]);
    const row = poll.rows[0];
    if (!row) {
        return { error: 'NOT_FOUND' };
    }
    if (row.created_by !== viewer.sub && !(await targetService.canModerate(row.target_type, row.target_id, viewer))) {
        return { error: 'FORBIDDEN' };
    }
    await db.query('UPDATE polls SET is_closed = true, closed_at = now() WHERE id = $1', [pollId]);
    return { poll: await serialize(pollId, viewer.sub), targetType: row.target_type, targetId: row.target_id };
}

async function listForTarget(targetType, targetId, viewerUserId) {
    const result = await db.query(
        'SELECT id FROM polls WHERE target_type = $1 AND target_id = $2 ORDER BY created_at DESC LIMIT 20',
        [targetType, targetId]
    );
    return Promise.all(result.rows.map((row) => serialize(row.id, viewerUserId)));
}

async function getByMessageId(targetType, targetId, messageId, viewerUserId) {
    const result = await db.query(
        'SELECT id FROM polls WHERE target_type = $1 AND target_id = $2 AND message_id = $3',
        [targetType, targetId, messageId]
    );
    return result.rows[0] ? serialize(result.rows[0].id, viewerUserId) : null;
}

module.exports = {
    MIN_OPTIONS,
    MAX_OPTIONS,
    serialize,
    createPoll,
    vote,
    closePoll,
    listForTarget,
    getByMessageId
};
