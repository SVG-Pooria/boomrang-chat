const db = require('../config/database');
const redis = require('../config/redis');
const format = require('../utils/persianFormat.util');
const attachmentClassifier = require('../utils/attachmentClassifier');
const { HIDDEN_ROLE } = require('../config/visibility');
const summarizer = require('./summarizer.service');

const SOURCES = {
    conversation: { table: 'messages', column: 'conversation_id', hiddenTable: 'message_hidden_for_user' },
    channel: { table: 'channel_messages', column: 'channel_id', hiddenTable: null },
    group: { table: 'group_messages', column: 'group_id', hiddenTable: null }
};

const SETTINGS = {
    minNewMessages: { key: 'summary_min_new_messages', fallback: 10 },
    maxAgeMinutes: { key: 'summary_max_age_minutes', fallback: 60 },
    windowFloorMessages: { key: 'summary_window_floor_messages', fallback: 50 },
    followUpMinutes: { key: 'summary_followup_minutes', fallback: 30 }
};

const MAX_BULLETS = 5;
const PRIORITY = ['pinned', 'work', 'poll', 'files', 'question', 'activity'];
const PINNED_LIMIT = 2;
const POLL_LIMIT = 2;
const QUOTE_WORDS = 8;
const QUOTE_CHARS = 80;
const NAME_CHARS = 60;
const MODEL_CONTEXT_MESSAGES = 40;
const REFRESH_COOLDOWN_SECONDS = 30;

const FILE_CATEGORIES = [
    { category: 'media', label: 'رسانه' },
    { category: 'files', label: 'فایل' },
    { category: 'music', label: 'فایل صوتی' },
    { category: 'gifs', label: 'گیف' }
];

const WORK_LABELS = [
    { key: 'tasks', label: 'وظیفه' },
    { key: 'approvals', label: 'درخواست تأیید' },
    { key: 'meetings', label: 'جلسه' }
];

const fa = format.toPersianDigits;

function bullet(kind, text, refMessageId) {
    return { kind, text, ref_message_id: refMessageId || null };
}

function shorten(text, limit) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    return clean.length > limit ? `${clean.slice(0, limit).trim()}…` : clean;
}

function quote(text) {
    const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (words.length === 0) {
        return '';
    }
    let snippet = words.slice(0, QUOTE_WORDS).join(' ');
    let truncated = words.length > QUOTE_WORDS;
    if (snippet.length > QUOTE_CHARS) {
        snippet = snippet.slice(0, QUOTE_CHARS).trim();
        truncated = true;
    }
    return truncated ? `${snippet}…` : snippet;
}

function joinPersian(parts) {
    if (parts.length <= 1) {
        return parts.join('');
    }
    return `${parts.slice(0, -1).join('، ')} و ${parts[parts.length - 1]}`;
}

function describeMessage(row) {
    const text = quote(row.body);
    if (text) {
        return `«${text}»`;
    }
    if (row.original_name) {
        return `فایل «${shorten(row.original_name, NAME_CHARS)}»`;
    }
    return 'یک پیوست';
}

function pinnedBullets(pinned) {
    if (!pinned || pinned.rows.length === 0) {
        return [];
    }
    const shown = pinned.rows.slice(0, PINNED_LIMIT);
    const bullets = shown.map((row) => bullet('pinned', `سنجاق‌شده: ${describeMessage(row)}`, row.id));
    const remaining = pinned.total - shown.length;
    if (remaining > 0) {
        bullets[bullets.length - 1].text += ` (و ${fa(remaining)} پیام سنجاق‌شدهٔ دیگر)`;
    }
    return bullets;
}

function workBullets(work) {
    if (!work) {
        return [];
    }
    const parts = WORK_LABELS.filter(({ key }) => work[key] > 0).map(({ key, label }) => `${fa(work[key])} ${label}`);
    if (parts.length === 0) {
        return [];
    }
    return [bullet('work', `${joinPersian(parts)} از این گفتگو ساخته شده است.`, null)];
}

function describePoll(poll) {
    const total = poll.options.reduce((sum, option) => sum + option.votes, 0);
    const [first, second] = poll.options;
    const leader = first && first.votes > 0 && (!second || second.votes < first.votes) ? first : null;
    const title = `«${quote(poll.question)}»`;
    if (!poll.isClosed) {
        if (total === 0) {
            return `نظرسنجی ${title} باز است و هنوز رأیی ثبت نشده است.`;
        }
        if (!leader) {
            return `نظرسنجی ${title} باز است؛ ${fa(total)} رأی با نتیجهٔ برابر.`;
        }
        return `نظرسنجی ${title} باز است؛ ${fa(total)} رأی و پیشتاز «${leader.label}» با ${fa(leader.votes)} رأی.`;
    }
    if (total === 0) {
        return `نظرسنجی ${title} بدون رأی بسته شد.`;
    }
    if (!leader) {
        return `نظرسنجی ${title} با آرای برابر بسته شد.`;
    }
    return `نظرسنجی ${title} بسته شد؛ گزینهٔ برنده «${leader.label}» با ${fa(leader.votes)} از ${fa(total)} رأی.`;
}

function pollBullets(polls) {
    if (!polls || polls.length === 0) {
        return [];
    }
    return polls.slice(0, POLL_LIMIT).map((poll) => bullet('poll', describePoll(poll), poll.messageId));
}

function fileBullets(files) {
    if (!files) {
        return [];
    }
    const parts = FILE_CATEGORIES.filter(({ category }) => files.counts[category] > 0).map(
        ({ category, label }) => `${fa(files.counts[category])} ${label}`
    );
    if (parts.length === 0) {
        return [];
    }
    const total = FILE_CATEGORIES.reduce((sum, { category }) => sum + (files.counts[category] || 0), 0);
    const name = files.latestName ? `«${shorten(files.latestName, NAME_CHARS)}»` : null;
    if (total === 1 && name) {
        return [bullet('files', `${name} در گاوصندوق بارگذاری شد.`, files.latestId)];
    }
    const latest = name ? `؛ تازه‌ترین: ${name}` : '';
    return [bullet('files', `${joinPersian(parts)} در گاوصندوق بارگذاری شد${latest}.`, files.latestId)];
}

function questionBullets(questions) {
    if (!questions || questions.rows.length === 0) {
        return [];
    }
    const [latest] = questions.rows;
    const remaining = questions.total - 1;
    const suffix = remaining > 0 ? ` (و ${fa(remaining)} پرسش بی‌پاسخ دیگر)` : '';
    return [bullet('question', `پرسش بی‌پاسخ: «${quote(latest.body)}»${suffix}`, latest.id)];
}

function activityBullets(activity) {
    if (!activity || activity.messageCount === 0) {
        return [];
    }
    const count = `${fa(activity.messageCount)} پیام`;
    const [top, runnerUp] = activity.busiest;
    if (activity.participants === 1 && top) {
        return [bullet('activity', `در این بازه ${count} از ${top.name} ثبت شد.`, null)];
    }
    const base = `در این بازه ${count} از ${fa(activity.participants)} نفر ثبت شد`;
    if (top && (!runnerUp || runnerUp.messages < top.messages)) {
        return [bullet('activity', `${base}؛ بیشترین مشارکت با ${top.name}.`, null)];
    }
    return [bullet('activity', `${base}.`, null)];
}

function composeBullets(facts) {
    const families = {
        pinned: pinnedBullets(facts.pinned),
        work: workBullets(facts.work),
        poll: pollBullets(facts.polls),
        files: fileBullets(facts.files),
        question: questionBullets(facts.questions),
        activity: activityBullets(facts.activity)
    };
    return PRIORITY.flatMap((kind) => families[kind]).slice(0, MAX_BULLETS);
}

function sourceFor(targetType) {
    const source = SOURCES[targetType];
    if (!source) {
        throw new Error(`Unknown summary target type: ${targetType}`);
    }
    return source;
}

function visibleFrom(targetType, m = 'm', u = 'u') {
    return `${sourceFor(targetType).table} ${m} JOIN users ${u} ON ${u}.id = ${m}.sender_id`;
}

function visibleWhere(targetType, m = 'm', u = 'u') {
    const source = sourceFor(targetType);
    const hidden = source.hiddenTable
        ? ` AND NOT EXISTS (SELECT 1 FROM ${source.hiddenTable} h WHERE h.message_id = ${m}.id)`
        : '';
    return `${m}.${source.column} = $1
             AND ${m}.is_deleted = false
             AND ${m}.is_confidential = false
             AND ${u}.is_bot = false
             AND ${u}.role <> $2${hidden}`;
}

async function readSettings() {
    const keys = Object.values(SETTINGS).map((setting) => setting.key);
    const result = await db.query('SELECT key, value FROM system_settings WHERE key = ANY($1::text[])', [keys]);
    const stored = new Map(result.rows.map((row) => [row.key, Number(row.value)]));
    const settings = {};
    for (const [name, { key, fallback }] of Object.entries(SETTINGS)) {
        const value = stored.get(key);
        settings[name] = Number.isInteger(value) && value > 0 ? value : fallback;
    }
    return settings;
}

async function resolveWindow(targetType, targetId, previousToId, floor) {
    const from = visibleFrom(targetType);
    const where = visibleWhere(targetType);
    const result = await db.query(
        `SELECT
            (SELECT m.id FROM ${from} WHERE ${where} ORDER BY m.id DESC LIMIT 1) AS newest_id,
            (SELECT min(recent.id) FROM (
                SELECT m.id FROM ${from} WHERE ${where} ORDER BY m.id DESC LIMIT $3
            ) recent) AS floor_id,
            (SELECT min(m.id) FROM ${from} WHERE ${where} AND m.id > $4) AS first_new_id`,
        [targetId, HIDDEN_ROLE, floor, previousToId || null]
    );
    const row = result.rows[0];
    if (!row || !row.newest_id) {
        return null;
    }
    const fromId = row.first_new_id ? Math.min(row.floor_id, row.first_new_id) : row.floor_id;
    return { fromId, toId: row.newest_id };
}

async function loadActivity(targetType, targetId, window) {
    const from = visibleFrom(targetType);
    const where = visibleWhere(targetType);
    const params = [targetId, HIDDEN_ROLE, window.fromId, window.toId];
    const [totals, leaders] = await Promise.all([
        db.query(
            `SELECT count(*)::int AS message_count,
                    count(DISTINCT m.sender_id)::int AS participants,
                    min(m.created_at) AS window_start
             FROM ${from}
             WHERE ${where} AND m.id BETWEEN $3 AND $4`,
            params
        ),
        db.query(
            `SELECT m.sender_id, u.full_name, count(*)::int AS messages
             FROM ${from}
             WHERE ${where} AND m.id BETWEEN $3 AND $4
             GROUP BY m.sender_id, u.full_name
             ORDER BY messages DESC, m.sender_id
             LIMIT 2`,
            params
        )
    ]);
    const row = totals.rows[0] || {};
    return {
        messageCount: row.message_count || 0,
        participants: row.participants || 0,
        windowStart: row.window_start || null,
        busiest: leaders.rows.map((leader) => ({ name: leader.full_name, messages: leader.messages }))
    };
}

async function loadPinned(targetType, targetId, window) {
    const result = await db.query(
        `SELECT m.id, m.body, f.original_name, count(*) OVER ()::int AS total
         FROM ${visibleFrom(targetType)}
         LEFT JOIN message_files f ON f.id = m.file_id
         WHERE ${visibleWhere(targetType)} AND m.is_pinned = true AND m.id BETWEEN $3 AND $4
         ORDER BY m.id DESC
         LIMIT $5`,
        [targetId, HIDDEN_ROLE, window.fromId, window.toId, PINNED_LIMIT]
    );
    return { rows: result.rows, total: result.rows[0] ? result.rows[0].total : 0 };
}

async function loadFiles(targetType, targetId, window) {
    const conditions = FILE_CATEGORIES.map(
        ({ category }) => `(${attachmentClassifier.buildCategoryCondition(category, 'm', 'f')})`
    );
    const counts = FILE_CATEGORIES.map(
        ({ category }, index) => `count(*) FILTER (WHERE ${conditions[index]})::int AS ${category}`
    ).join(',\n                ');
    const result = await db.query(
        `SELECT ${counts},
                (array_agg(m.id ORDER BY m.id DESC))[1] AS latest_id,
                (array_agg(f.original_name ORDER BY m.id DESC))[1] AS latest_name
         FROM ${visibleFrom(targetType)}
         JOIN message_files f ON f.id = m.file_id
         WHERE ${visibleWhere(targetType)}
           AND m.id BETWEEN $3 AND $4
           AND f.av_scan_status <> 'infected'
           AND (${conditions.join(' OR ')})`,
        [targetId, HIDDEN_ROLE, window.fromId, window.toId]
    );
    const row = result.rows[0] || {};
    const fileCounts = {};
    for (const { category } of FILE_CATEGORIES) {
        fileCounts[category] = row[category] || 0;
    }
    return { counts: fileCounts, latestId: row.latest_id || null, latestName: row.latest_name || null };
}

async function loadLinkedWork(targetType, targetId, since) {
    const scope = 'source_target_type = $1 AND source_target_id = $2 AND ($3::timestamptz IS NULL OR created_at >= $3)';
    const result = await db.query(
        `SELECT
            (SELECT count(*)::int FROM tasks WHERE ${scope}) AS tasks,
            (SELECT count(*)::int FROM approval_requests WHERE ${scope}) AS approvals,
            (SELECT count(*)::int FROM meetings WHERE ${scope}) AS meetings`,
        [targetType, targetId, since]
    );
    const row = result.rows[0] || {};
    return { tasks: row.tasks || 0, approvals: row.approvals || 0, meetings: row.meetings || 0 };
}

async function loadPolls(targetType, targetId, since) {
    const source = sourceFor(targetType);
    const polls = await db.query(
        `SELECT p.id, p.question, p.is_closed, p.message_id
         FROM polls p
         JOIN ${source.table} m ON m.id = p.message_id
         JOIN users u ON u.id = m.sender_id
         WHERE p.target_type = $3
           AND p.target_id = $1
           AND ${visibleWhere(targetType)}
           AND (p.is_closed = false OR ($4::timestamptz IS NOT NULL AND p.closed_at >= $4))
         ORDER BY p.is_closed, p.id DESC
         LIMIT $5`,
        [targetId, HIDDEN_ROLE, targetType, since, POLL_LIMIT]
    );
    if (polls.rows.length === 0) {
        return [];
    }
    const options = await db.query(
        `SELECT o.poll_id, o.label, count(v.user_id)::int AS votes
         FROM poll_options o
         LEFT JOIN poll_votes v ON v.option_id = o.id
         WHERE o.poll_id = ANY($1::int[])
         GROUP BY o.id, o.poll_id, o.label, o.position
         ORDER BY o.poll_id, votes DESC, o.position`,
        [polls.rows.map((row) => row.id)]
    );
    return polls.rows.map((row) => ({
        messageId: row.message_id,
        question: row.question,
        isClosed: row.is_closed,
        options: options.rows
            .filter((option) => option.poll_id === row.id)
            .map((option) => ({ label: option.label, votes: option.votes }))
    }));
}

async function loadQuestions(targetType, targetId, window, followUpMinutes) {
    const result = await db.query(
        `SELECT q.id, q.body, count(*) OVER ()::int AS total
         FROM ${visibleFrom(targetType, 'q', 'qu')}
         WHERE ${visibleWhere(targetType, 'q', 'qu')}
           AND q.type = 'text'
           AND q.id BETWEEN $3 AND $4
           AND btrim(q.body) ~ '[?؟]$'
           AND q.created_at <= now() - make_interval(mins => $5::int)
           AND NOT EXISTS (
               SELECT 1
               FROM ${visibleFrom(targetType, 'r', 'ru')}
               WHERE ${visibleWhere(targetType, 'r', 'ru')}
                 AND r.id > q.id
                 AND r.sender_id <> q.sender_id
                 AND r.created_at <= q.created_at + make_interval(mins => $5::int)
           )
         ORDER BY q.id DESC
         LIMIT 1`,
        [targetId, HIDDEN_ROLE, window.fromId, window.toId, followUpMinutes]
    );
    return { rows: result.rows, total: result.rows[0] ? result.rows[0].total : 0 };
}

async function loadInsights(targetType, targetId, window, bullets) {
    const result = await db.query(
        `SELECT u.full_name, m.body
         FROM ${visibleFrom(targetType)}
         WHERE ${visibleWhere(targetType)}
           AND m.id BETWEEN $3 AND $4
           AND m.body IS NOT NULL
           AND btrim(m.body) <> ''
         ORDER BY m.id DESC
         LIMIT $5`,
        [targetId, HIDDEN_ROLE, window.fromId, window.toId, MODEL_CONTEXT_MESSAGES]
    );
    const insights = await summarizer.interpret({
        facts: bullets.map((item) => item.text),
        messages: result.rows.reverse().map((row) => ({ sender: row.full_name, text: row.body }))
    });
    return insights.slice(0, summarizer.MAX_INSIGHTS).map((text) => bullet('insight', text, null));
}

async function computeDigest(targetType, targetId, previous, settings) {
    const window = await resolveWindow(
        targetType,
        targetId,
        previous ? previous.covered_to_message_id : null,
        settings.windowFloorMessages
    );
    const activity = window ? await loadActivity(targetType, targetId, window) : null;
    const since = activity ? activity.windowStart : null;
    const [pinned, work, polls, files, questions] = await Promise.all([
        window ? loadPinned(targetType, targetId, window) : null,
        loadLinkedWork(targetType, targetId, since),
        window ? loadPolls(targetType, targetId, since) : [],
        window ? loadFiles(targetType, targetId, window) : null,
        window ? loadQuestions(targetType, targetId, window, settings.followUpMinutes) : null
    ]);
    const bullets = composeBullets({ pinned, work, polls, files, questions, activity });
    if (bullets.length === 0) {
        return null;
    }
    const insights = window && summarizer.isEnabled() ? await loadInsights(targetType, targetId, window, bullets) : [];
    return {
        bullets: bullets.concat(insights),
        coveredFromMessageId: window ? window.fromId : null,
        coveredToMessageId: window ? window.toId : null,
        messageCount: activity ? activity.messageCount : 0
    };
}

async function readStored(targetType, targetId) {
    const result = await db.query(
        'SELECT * FROM conversation_summaries WHERE target_type = $1 AND target_id = $2',
        [targetType, targetId]
    );
    return result.rows[0] || null;
}

async function countNewMessages(targetType, targetId, afterId, limit) {
    const result = await db.query(
        `SELECT count(*)::int AS fresh FROM (
            SELECT 1 FROM ${visibleFrom(targetType)}
            WHERE ${visibleWhere(targetType)} AND m.id > $3
            LIMIT $4
         ) recent`,
        [targetId, HIDDEN_ROLE, afterId || 0, limit]
    );
    return result.rows[0] ? result.rows[0].fresh : 0;
}

async function isStale(targetType, targetId, stored, settings) {
    const age = Date.now() - new Date(stored.generated_at).getTime();
    if (age >= settings.maxAgeMinutes * 60 * 1000) {
        return true;
    }
    const fresh = await countNewMessages(targetType, targetId, stored.covered_to_message_id, settings.minNewMessages);
    return fresh >= settings.minNewMessages;
}

async function saveDigest(targetType, targetId, digest) {
    const result = await db.query(
        `INSERT INTO conversation_summaries
            (target_type, target_id, bullets, covered_from_message_id, covered_to_message_id,
             message_count, is_manual, published_by, generated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, false, NULL, now())
         ON CONFLICT (target_type, target_id) DO UPDATE SET
            bullets = EXCLUDED.bullets,
            covered_from_message_id = EXCLUDED.covered_from_message_id,
            covered_to_message_id = EXCLUDED.covered_to_message_id,
            message_count = EXCLUDED.message_count,
            generated_at = now()
         WHERE conversation_summaries.is_manual = false
         RETURNING *`,
        [
            targetType,
            targetId,
            JSON.stringify(digest.bullets),
            digest.coveredFromMessageId,
            digest.coveredToMessageId,
            digest.messageCount
        ]
    );
    return result.rows[0] || null;
}

async function dropDigest(targetType, targetId) {
    await db.query(
        'DELETE FROM conversation_summaries WHERE target_type = $1 AND target_id = $2 AND is_manual = false',
        [targetType, targetId]
    );
}

function serialize(row) {
    if (!row) {
        return null;
    }
    return {
        bullets: (row.bullets || []).map((item) => ({
            kind: item.kind,
            text: item.text,
            refMessageId: item.ref_message_id || null
        })),
        generatedAt: row.generated_at,
        coveredFromMessageId: row.covered_from_message_id,
        coveredToMessageId: row.covered_to_message_id,
        messageCount: row.message_count,
        isManual: row.is_manual
    };
}

function fingerprint(row) {
    return row ? JSON.stringify([row.is_manual, row.bullets]) : null;
}

function broadcast(targetType, targetId, row) {
    const notifier = require('../socket/notifier');
    notifier.notifySummaryUpdated(targetType, targetId, serialize(row));
}

async function refresh(targetType, targetId, { force = false } = {}) {
    const stored = await readStored(targetType, targetId);
    if (stored && stored.is_manual) {
        return stored;
    }
    const settings = await readSettings();
    if (!force && stored && !(await isStale(targetType, targetId, stored, settings))) {
        return stored;
    }
    const digest = await computeDigest(targetType, targetId, stored, settings);
    let row = null;
    if (digest) {
        row = await saveDigest(targetType, targetId, digest);
        if (!row) {
            return readStored(targetType, targetId);
        }
    } else if (stored) {
        await dropDigest(targetType, targetId);
    }
    if (fingerprint(stored) !== fingerprint(row)) {
        broadcast(targetType, targetId, row);
    }
    return row;
}

const running = new Map();

function refreshTarget(targetType, targetId, { force = false } = {}) {
    const key = `${targetType}:${targetId}`;
    const current = running.get(key);
    if (current) {
        current.pending = true;
        current.force = current.force || force;
        return current.promise;
    }
    const job = { pending: false, force };
    job.promise = (async () => {
        try {
            let row;
            do {
                const runForce = job.force;
                job.pending = false;
                job.force = false;
                row = await refresh(targetType, targetId, { force: runForce });
            } while (job.pending);
            return row;
        } finally {
            running.delete(key);
        }
    })();
    running.set(key, job);
    return job.promise;
}

function touch(targetType, targetId, { force = false } = {}) {
    if (!SOURCES[targetType] || !targetId) {
        return;
    }
    refreshTarget(targetType, Number(targetId), { force }).catch((err) => {
        console.error(`[summary.service] refresh failed for ${targetType}:${targetId}:`, err.message);
    });
}

async function getSummary(targetType, targetId) {
    return serialize(await refreshTarget(targetType, targetId));
}

async function readSummary(targetType, targetId) {
    return serialize(await readStored(targetType, targetId));
}

async function forceRefresh(targetType, targetId) {
    return serialize(await refreshTarget(targetType, targetId, { force: true }));
}

async function claimRefreshSlot(targetType, targetId) {
    const claimed = await redis
        .getClient()
        .set(`summary:refresh:${targetType}:${targetId}`, '1', 'EX', REFRESH_COOLDOWN_SECONDS, 'NX');
    return claimed === 'OK';
}

async function publishManual(targetType, targetId, userId, texts) {
    const bullets = texts.map((text) => bullet('manual', text, null));
    const result = await db.query(
        `INSERT INTO conversation_summaries (target_type, target_id, bullets, is_manual, published_by, generated_at)
         VALUES ($1, $2, $3::jsonb, true, $4, now())
         ON CONFLICT (target_type, target_id) DO UPDATE SET
            bullets = EXCLUDED.bullets,
            is_manual = true,
            published_by = EXCLUDED.published_by,
            generated_at = now()
         RETURNING *`,
        [targetType, targetId, JSON.stringify(bullets), userId]
    );
    const row = result.rows[0];
    broadcast(targetType, targetId, row);
    return serialize(row);
}

async function sendReport(targetType, targetId, userId, targetName) {
    const summary = await getSummary(targetType, targetId);
    if (!summary || summary.bullets.length === 0) {
        return null;
    }
    const bullets = summary.bullets.map((item) => ({
        kind: item.kind,
        text: item.text,
        ref_message_id: item.refMessageId
    }));
    const payload = JSON.stringify(bullets);
    const existing = await db.query(
        `SELECT id FROM summary_reports
         WHERE target_type = $1 AND target_id = $2 AND sender_id = $3 AND bullets = $4::jsonb
           AND created_at > now() - interval '10 minutes'
         ORDER BY id DESC
         LIMIT 1`,
        [targetType, targetId, userId, payload]
    );
    if (existing.rows[0]) {
        return { reportId: existing.rows[0].id, repeated: true };
    }
    const inserted = await db.query(
        `INSERT INTO summary_reports (target_type, target_id, target_name, sender_id, bullets, message_count)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING id`,
        [targetType, targetId, targetName, userId, payload, summary.messageCount || 0]
    );
    return { reportId: inserted.rows[0].id, repeated: false };
}

async function clearManual(targetType, targetId) {
    const result = await db.query(
        `UPDATE conversation_summaries SET is_manual = false, published_by = NULL
         WHERE target_type = $1 AND target_id = $2 AND is_manual = true
         RETURNING id`,
        [targetType, targetId]
    );
    if (!result.rows[0]) {
        return { cleared: false, summary: await readSummary(targetType, targetId) };
    }
    return { cleared: true, summary: await forceRefresh(targetType, targetId) };
}

module.exports = {
    SETTINGS,
    MAX_BULLETS,
    PRIORITY,
    REFRESH_COOLDOWN_SECONDS,
    quote,
    composeBullets,
    readSettings,
    resolveWindow,
    computeDigest,
    refresh,
    refreshTarget,
    touch,
    getSummary,
    readSummary,
    forceRefresh,
    claimRefreshSlot,
    publishManual,
    sendReport,
    clearManual,
    serialize
};
