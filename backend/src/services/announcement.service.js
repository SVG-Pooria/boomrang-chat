const db = require('../config/database');
const format = require('../utils/persianFormat.util');
const { HIDDEN_ROLE } = require('../config/visibility');

const TONES = ['هشدار', 'رسمی', 'عادی'];

function isValidTone(value) {
    return TONES.includes(value);
}

async function activeAudienceCount() {
    const result = await db.query(
        'SELECT count(*)::int AS count FROM users WHERE is_active = true AND is_bot = false AND role <> $1',
        [HIDDEN_ROLE]
    );
    return result.rows[0].count;
}

function serialize(row, audienceCount, now = new Date()) {
    return {
        id: format.referenceId('A', row.id),
        announcementId: row.id,
        title: row.title,
        body: row.body,
        author: row.author_display || row.author_name || 'سازمان',
        time: format.relativeTime(new Date(row.created_at), now),
        tone: row.tone,
        seen: `${format.percent(row.seen_count, audienceCount)} کارکنان دیده‌اند`,
        mustAck: row.must_ack,
        acked: Boolean(row.acked_at)
    };
}

async function listForUser(viewer) {
    const audienceCount = await activeAudienceCount();
    const result = await db.query(
        `SELECT a.*, u.full_name AS author_name,
                (SELECT count(*)::int FROM announcement_reads r WHERE r.announcement_id = a.id) AS seen_count,
                mine.acked_at
         FROM announcements a
         LEFT JOIN users u ON u.id = a.author_id
         LEFT JOIN announcement_reads mine ON mine.announcement_id = a.id AND mine.user_id = $1
         ORDER BY a.created_at DESC
         LIMIT 50`,
        [viewer.sub]
    );
    return result.rows.map((row) => serialize(row, audienceCount));
}

async function markSeen(announcementId, userId) {
    await db.query(
        `INSERT INTO announcement_reads (announcement_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (announcement_id, user_id) DO NOTHING`,
        [announcementId, userId]
    );
}

async function markSeenAll(userId) {
    await db.query(
        `INSERT INTO announcement_reads (announcement_id, user_id)
         SELECT a.id, $1 FROM announcements a
         ON CONFLICT (announcement_id, user_id) DO NOTHING`,
        [userId]
    );
}

async function acknowledge(announcementId, userId) {
    const exists = await db.query('SELECT must_ack FROM announcements WHERE id = $1', [announcementId]);
    if (!exists.rows[0]) {
        return { error: 'NOT_FOUND' };
    }
    await db.query(
        `INSERT INTO announcement_reads (announcement_id, user_id, acked_at)
         VALUES ($1, $2, now())
         ON CONFLICT (announcement_id, user_id)
         DO UPDATE SET acked_at = COALESCE(announcement_reads.acked_at, now())`,
        [announcementId, userId]
    );
    return { success: true };
}

async function countPendingAck(viewer) {
    const result = await db.query(
        `SELECT count(*)::int AS count
         FROM announcements a
         LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.user_id = $1
         WHERE a.must_ack = true AND r.acked_at IS NULL`,
        [viewer.sub]
    );
    return result.rows[0].count;
}

async function createAnnouncement(input) {
    const result = await db.query(
        `INSERT INTO announcements (title, body, author_id, author_display, tone, must_ack)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [input.title, input.body, input.authorId, input.authorDisplay || null, input.tone, input.mustAck]
    );
    return result.rows[0].id;
}

module.exports = {
    TONES,
    isValidTone,
    listForUser,
    markSeen,
    markSeenAll,
    acknowledge,
    countPendingAck,
    createAnnouncement,
    activeAudienceCount
};
