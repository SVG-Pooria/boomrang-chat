const db = require('../config/database');
const format = require('../utils/persianFormat.util');
const { HIDDEN_ROLE } = require('../config/visibility');
const approvalService = require('./approval.service');
const taskService = require('./task.service');
const meetingService = require('./meeting.service');
const directoryService = require('./directory.service');
const complianceService = require('./compliance.service');
const fileUploadService = require('./fileUpload.service');
const capabilityService = require('./capability.service');
const userService = require('./user.service');

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const MIN_SAMPLE = 3;
const WEEK_DAYS = 7;
const TONES = ['violet', 'sky', 'mint', 'lemon', 'rose'];
const STATUS_KEYS = {
    'آنلاین': 'online',
    'در جلسه': 'meeting',
    'مرخصی': 'leave',
    'خارج از ساعت کاری': 'away'
};
const CAPACITY_KEY = 'team_task_capacity';
const DEFAULT_CAPACITY = 8;
const OVERDUE_WEIGHT = 2;
const LEAVE_TYPES = ['مرخصی', 'مرخصی ساعتی'];
const SPACE_TYPES = { channel: 'کانال', group: 'گروه' };
const TEHRAN_OFFSET = '+03:30';

const fa = format.toPersianDigits;

function toneFor(id) {
    return TONES[Math.abs(Number(id)) % TONES.length];
}

function startOfDay(date) {
    return new Date(`${format.dayKey(date)}T00:00:00${TEHRAN_OFFSET}`);
}

function dateFromKey(key) {
    return new Date(`${key}T12:00:00${TEHRAN_OFFSET}`);
}

function dayWord(date, now) {
    const diff = format.daysBetween(now, date);
    if (diff === 0) {
        return 'امروز';
    }
    if (diff === 1) {
        return 'فردا';
    }
    if (diff > 1 && diff < WEEK_DAYS) {
        return format.weekdayName(date);
    }
    const { jm, jd } = format.toJalali(date);
    return `${fa(jd)} ${format.JALALI_MONTHS[jm - 1]}`;
}

async function loadProfile(managerId) {
    const result = await db.query('SELECT id, full_name, unit, job_title FROM users WHERE id = $1', [managerId]);
    return result.rows[0];
}

async function listTeamMembers(managerId) {
    const result = await db.query(
        `SELECT id, full_name, job_title, unit
         FROM users
         WHERE manager_id = $1 AND is_active = true AND is_bot = false AND role <> $2
         ORDER BY full_name`,
        [managerId, HIDDEN_ROLE]
    );
    return result.rows;
}

function unitLabel(profile, members) {
    const counts = new Map();
    for (const member of members) {
        if (member.unit) {
            counts.set(member.unit, (counts.get(member.unit) || 0) + 1);
        }
    }
    const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (top) {
        return `واحد ${top[0]}`;
    }
    return profile && profile.unit ? `واحد ${profile.unit}` : 'تیم شما';
}

async function loadScope(viewer) {
    const [profile, members] = await Promise.all([loadProfile(viewer.sub), listTeamMembers(viewer.sub)]);
    const teamIds = members.map((member) => member.id);
    return { profile, members, teamIds, unitIds: [viewer.sub, ...teamIds], unit: unitLabel(profile, members) };
}

async function readCapacity() {
    const result = await db.query('SELECT value FROM system_settings WHERE key = $1', [CAPACITY_KEY]);
    const parsed = Number(result.rows[0] ? result.rows[0].value : NaN);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_CAPACITY;
}

async function buildRoster(members, now) {
    const ids = members.map((member) => member.id);
    const [statusOf, counts, capacity] = await Promise.all([
        directoryService.statusResolver(now),
        db.query(
            `SELECT owner_id,
                    count(*) FILTER (WHERE status <> $2)::int AS open,
                    count(*) FILTER (WHERE status <> $2 AND due_at < $3)::int AS overdue
             FROM tasks
             WHERE owner_id = ANY($1::int[])
             GROUP BY owner_id`,
            [ids, taskService.DONE_STATUS, now]
        ),
        readCapacity()
    ]);
    const byOwner = new Map(counts.rows.map((row) => [row.owner_id, row]));
    return members.map((member, index) => {
        const row = byOwner.get(member.id) || { open: 0, overdue: 0 };
        const weighted = row.open + row.overdue * (OVERDUE_WEIGHT - 1);
        return {
            userId: member.id,
            name: member.full_name,
            role: member.job_title || 'همکار',
            initials: format.initials(member.full_name),
            status: STATUS_KEYS[statusOf(member.id)] || 'away',
            load: Math.min(100, Math.round((weighted / capacity) * 100)),
            open: row.open,
            tone: TONES[index % TONES.length]
        };
    });
}

async function teamTaskCounts(teamIds, now) {
    const result = await db.query(
        `SELECT count(*) FILTER (WHERE status <> $2)::int AS active,
                count(*) FILTER (
                    WHERE status <> $2 AND to_char(due_at AT TIME ZONE $3, 'YYYY-MM-DD') = $4
                )::int AS due_today
         FROM tasks
         WHERE owner_id = ANY($1::int[])`,
        [teamIds, taskService.DONE_STATUS, format.TIMEZONE, format.dayKey(now)]
    );
    return { active: result.rows[0].active, dueToday: result.rows[0].due_today };
}

function averageLabel(stats) {
    return stats.decisions >= MIN_SAMPLE ? format.durationLabel(stats.averageMs) : null;
}

function compactRequest(request) {
    return {
        id: request.id,
        requestId: request.requestId,
        title: request.title,
        person: request.person,
        unit: request.unit,
        time: request.time,
        stage: request.stage,
        priority: request.priority,
        tone: request.tone
    };
}

function presenceSummary(roster) {
    return {
        total: roster.length,
        present: roster.filter((person) => person.status === 'online' || person.status === 'meeting').length,
        available: roster.filter((person) => person.status === 'online').length,
        onLeave: roster.filter((person) => person.status === 'leave').length
    };
}

async function listMeetings(unitIds, now) {
    const rows = await meetingService.listUpcomingForAttendees(unitIds, 3, now);
    return rows.map((row, index) => {
        const startsAt = new Date(row.starts_at);
        const isVideoRoom = !row.room || row.room === meetingService.DEFAULT_ROOM;
        return {
            meetingId: row.id,
            title: row.title,
            time: `${dayWord(startsAt, now)} • ${format.timeRange(startsAt, new Date(row.ends_at))}`,
            people: `${fa(row.people)} نفر`,
            tone: isVideoRoom ? 'sky' : index % 2 === 0 ? 'violet' : 'mint'
        };
    });
}

async function profile(viewer) {
    const now = new Date();
    const scope = await loadScope(viewer);
    const [pending, counts] = await Promise.all([
        approvalService.countPendingFor(viewer),
        teamTaskCounts(scope.teamIds, now)
    ]);
    return {
        manager: {
            name: scope.profile.full_name,
            initials: format.initials(scope.profile.full_name),
            unit: scope.profile.unit || null,
            jobTitle: scope.profile.job_title || null,
            role: viewer.role,
            roleLabel: userService.ROLE_LABELS[viewer.role] || viewer.role
        },
        badges: { inbox: pending, tasks: counts.dueToday }
    };
}

async function overview(viewer) {
    const now = new Date();
    const scope = await loadScope(viewer);
    const [requests, roster, counts, stats, timeline, meetings] = await Promise.all([
        approvalService.listForManager(viewer, scope.teamIds),
        buildRoster(scope.members, now),
        teamTaskCounts(scope.teamIds, now),
        approvalService.decisionStats(viewer.sub, new Date(now.getTime() - WINDOW_DAYS * DAY_MS), now),
        complianceService.teamTimeline(scope.unitIds, 5),
        listMeetings(scope.unitIds, now)
    ]);
    const open = requests.filter((request) => request.status === 'pending');
    const mine = requests.filter((request) => request.canDecide);
    const presence = presenceSummary(roster);
    const average = averageLabel(stats);

    return {
        kpis: [
            {
                key: 'inbox',
                label: 'کارتابل باز',
                value: fa(open.length),
                hint: `${fa(open.filter((request) => request.priority === 'فوری').length)} مورد فوری`,
                tone: 'rose',
                icon: 'inbox'
            },
            {
                key: 'approvals',
                label: 'در انتظار تأیید شما',
                value: fa(mine.length),
                hint: average ? `میانگین پاسخ ${average}` : 'میانگین پاسخ: دادهٔ کافی نیست',
                tone: 'violet',
                icon: 'stamp'
            },
            {
                key: 'tasks',
                label: 'وظایف جاری تیم',
                value: fa(counts.active),
                hint: `${fa(counts.dueToday)} سررسید امروز`,
                tone: 'sky',
                icon: 'tasks'
            },
            {
                key: 'team',
                label: 'حاضرین تیم',
                value: `${fa(presence.present)}/${fa(presence.total)}`,
                hint: `${fa(presence.onLeave)} نفر مرخصی`,
                tone: 'mint',
                icon: 'team'
            }
        ],
        requests: mine.slice(0, 4).map(compactRequest),
        timeline,
        meetings,
        team: roster.slice(0, 6)
    };
}

async function inbox(viewer) {
    const now = new Date();
    const scope = await loadScope(viewer);
    const [requests, stats] = await Promise.all([
        approvalService.listForManager(viewer, scope.teamIds),
        approvalService.decisionStats(viewer.sub, new Date(now.getTime() - WINDOW_DAYS * DAY_MS), now)
    ]);
    return {
        requests,
        openCount: requests.filter((request) => request.status === 'pending').length,
        metrics: [
            { label: 'میانگین پاسخ', value: averageLabel(stats) || '—', tone: 'mint' },
            { label: 'تأییدشده', value: fa(stats.approved), tone: 'sky' },
            { label: 'برگشتی', value: fa(stats.referred), tone: 'rose' }
        ]
    };
}

async function board(viewer) {
    const now = new Date();
    const scope = await loadScope(viewer);
    const [tasks, counts] = await Promise.all([
        taskService.listForOwners(scope.teamIds, new Date(now.getTime() - WINDOW_DAYS * DAY_MS)),
        teamTaskCounts(scope.teamIds, now)
    ]);
    return {
        unit: scope.unit,
        activeCount: counts.active,
        dueToday: counts.dueToday,
        columns: taskService.BOARD.map((column) => ({
            column: column.managerColumn,
            status: column.status,
            tone: column.tone,
            items: tasks
                .filter((task) => task.status === column.status)
                .map((task) => ({
                    taskId: task.taskId,
                    title: task.title,
                    owner: task.owner,
                    due: task.due,
                    tag: task.tag
                }))
        })),
        assignees: scope.members.map((member) => ({ userId: member.id, name: member.full_name }))
    };
}

async function listLeaves(scope, requests, now) {
    const weekEnd = format.dayKey(new Date(now.getTime() + (WEEK_DAYS - 1) * DAY_MS));
    const periods = await db.query(
        `SELECT p.id, p.user_id, u.full_name,
                to_char(p.start_date, 'YYYY-MM-DD') AS start_key,
                to_char(p.end_date, 'YYYY-MM-DD') AS end_key
         FROM leave_periods p
         JOIN users u ON u.id = p.user_id
         WHERE p.user_id = ANY($1::int[]) AND p.end_date >= $2::date AND p.start_date <= $3::date
         ORDER BY p.start_date`,
        [scope.teamIds, format.dayKey(now), weekEnd]
    );
    const today = format.dayKey(now);
    const recorded = periods.rows.map((row) => {
        const end = dayWord(dateFromKey(row.end_key), now);
        const note =
            row.start_key <= today
                ? `مرخصی — تا ${end}`
                : `مرخصی — ${dayWord(dateFromKey(row.start_key), now)} تا ${end}`;
        return { key: `leave-${row.id}`, name: row.full_name, note, tone: 'rose', label: 'ثبت‌شده در چارت سازمانی' };
    });
    const pending = requests
        .filter(
            (request) =>
                request.status === 'pending' &&
                LEAVE_TYPES.includes(request.type) &&
                scope.teamIds.includes(request.requesterId)
        )
        .map((request) => ({
            key: `request-${request.requestId}`,
            name: request.person,
            note: `${request.title} — ${request.canDecide ? 'در انتظار شما' : 'در انتظار تأیید'}`,
            tone: 'lemon',
            label: 'ثبت‌شده در کارتابل'
        }));
    return [...recorded, ...pending];
}

async function team(viewer) {
    const now = new Date();
    const scope = await loadScope(viewer);
    const [roster, requests] = await Promise.all([
        buildRoster(scope.members, now),
        approvalService.listForManager(viewer, scope.teamIds)
    ]);
    const presence = presenceSummary(roster);
    return {
        unit: scope.unit,
        team: roster,
        total: presence.total,
        available: presence.available,
        leaves: await listLeaves(scope, requests, now)
    };
}

function spaceScopeSql() {
    return `
        SELECT 'channel' AS kind, c.id, c.title,
               (SELECT count(*)::int FROM channel_members cm JOIN users mu ON mu.id = cm.user_id
                 WHERE cm.channel_id = c.id AND mu.is_bot = false AND mu.role <> $3) AS members,
               (SELECT count(*)::int FROM channel_messages m JOIN users su ON su.id = m.sender_id
                 WHERE m.channel_id = c.id AND m.is_deleted = false AND su.is_bot = false
                   AND m.created_at >= $4) AS weekly,
               EXISTS (SELECT 1 FROM manager_space_pins p
                       WHERE p.manager_id = $2 AND p.target_type = 'channel' AND p.target_id = c.id) AS pinned
        FROM channels c
        WHERE c.is_active = true
          AND EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = ANY($1::int[]))
        UNION ALL
        SELECT 'group' AS kind, g.id, g.title,
               (SELECT count(*)::int FROM group_members gm JOIN users mu ON mu.id = gm.user_id
                 WHERE gm.group_id = g.id AND mu.is_bot = false AND mu.role <> $3) AS members,
               (SELECT count(*)::int FROM group_messages m JOIN users su ON su.id = m.sender_id
                 WHERE m.group_id = g.id AND m.is_deleted = false AND su.is_bot = false
                   AND m.created_at >= $4) AS weekly,
               EXISTS (SELECT 1 FROM manager_space_pins p
                       WHERE p.manager_id = $2 AND p.target_type = 'group' AND p.target_id = g.id) AS pinned
        FROM groups g
        WHERE g.is_active = true
          AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = ANY($1::int[]))
    `;
}

async function listSpaceRows(viewer, unitIds, now) {
    const result = await db.query(
        `SELECT * FROM (${spaceScopeSql()}) spaces ORDER BY pinned DESC, weekly DESC, title`,
        [unitIds, viewer.sub, HIDDEN_ROLE, new Date(now.getTime() - WEEK_DAYS * DAY_MS)]
    );
    return result.rows;
}

async function spaces(viewer) {
    const now = new Date();
    const scope = await loadScope(viewer);
    const [rows, maxBytes, retention] = await Promise.all([
        listSpaceRows(viewer, scope.unitIds, now),
        fileUploadService.getMaxFileSizeBytes(),
        complianceService.retentionYears()
    ]);
    return {
        spaces: rows.map((row) => ({
            targetType: row.kind,
            targetId: row.id,
            name: row.title,
            type: SPACE_TYPES[row.kind],
            members: fa(row.members),
            activity: `${fa(row.weekly)} پیام این هفته`,
            tone: toneFor(row.id + (row.kind === 'group' ? 2 : 0)),
            pinned: row.pinned
        })),
        joinRequests: [],
        rules: [
            {
                label: 'سقف حجم فایل',
                value: maxBytes ? `${fa(Math.round(maxBytes / (1024 * 1024)))} مگابایت` : 'نامحدود'
            },
            { label: 'نگهداری پیام', value: `${fa(retention)} سال` }
        ]
    };
}

async function setSpacePinned(viewer, targetType, targetId, pinned) {
    if (!SPACE_TYPES[targetType]) {
        return { error: 'INVALID_TARGET' };
    }
    const scope = await loadScope(viewer);
    const rows = await listSpaceRows(viewer, scope.unitIds, new Date());
    if (!rows.some((row) => row.kind === targetType && row.id === targetId)) {
        return { error: 'NOT_IN_SCOPE' };
    }
    if (pinned) {
        await db.query(
            `INSERT INTO manager_space_pins (manager_id, target_type, target_id) VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [viewer.sub, targetType, targetId]
        );
    } else {
        await db.query(
            'DELETE FROM manager_space_pins WHERE manager_id = $1 AND target_type = $2 AND target_id = $3',
            [viewer.sub, targetType, targetId]
        );
    }
    return { pinned: Boolean(pinned) };
}

async function messagesPerDay(actorIds, from) {
    const result = await db.query(
        `SELECT day, sum(count)::int AS count FROM (
            SELECT to_char(created_at AT TIME ZONE $3, 'YYYY-MM-DD') AS day, count(*) AS count
            FROM messages WHERE sender_id = ANY($1::int[]) AND is_deleted = false AND created_at >= $2 GROUP BY 1
            UNION ALL
            SELECT to_char(created_at AT TIME ZONE $3, 'YYYY-MM-DD'), count(*)
            FROM channel_messages WHERE sender_id = ANY($1::int[]) AND is_deleted = false AND created_at >= $2 GROUP BY 1
            UNION ALL
            SELECT to_char(created_at AT TIME ZONE $3, 'YYYY-MM-DD'), count(*)
            FROM group_messages WHERE sender_id = ANY($1::int[]) AND is_deleted = false AND created_at >= $2 GROUP BY 1
         ) daily
         GROUP BY day`,
        [actorIds, from, format.TIMEZONE]
    );
    return Object.fromEntries(result.rows.map((row) => [row.day, row.count]));
}

async function weeklyActivity(unitIds, now) {
    const days = [];
    for (let offset = WEEK_DAYS - 1; offset >= 0; offset -= 1) {
        days.push(new Date(now.getTime() - offset * DAY_MS));
    }
    const from = startOfDay(days[0]);
    const [messages, actions] = await Promise.all([
        messagesPerDay(unitIds, from),
        complianceService.teamActionsPerDay(unitIds, from)
    ]);
    return days.map((day) => {
        const key = format.dayKey(day);
        return { label: format.weekdayName(day), value: (messages[key] || 0) + (actions[key] || 0) };
    });
}

async function onTimeStats(teamIds, from, to) {
    const result = await db.query(
        `SELECT count(*)::int AS closed,
                count(*) FILTER (WHERE completed_at <= due_at)::int AS on_time
         FROM tasks
         WHERE owner_id = ANY($1::int[]) AND due_at IS NOT NULL
           AND completed_at >= $2 AND completed_at < $3`,
        [teamIds, from, to]
    );
    return result.rows[0];
}

const COMPARISON_MISSING = 'بدون داده مقایسه‌ای';
const INSUFFICIENT = 'دادهٔ کافی نیست';
const VERSUS = 'نسبت به ۳۰ روز قبل';

function responseMetric(current, previous) {
    const metric = { label: 'میانگین زمان پاسخ به کارتابل', tone: 'mint' };
    if (current.decisions < MIN_SAMPLE) {
        return { ...metric, value: '—', delta: INSUFFICIENT };
    }
    const value = format.durationLabel(current.averageMs);
    if (previous.decisions < MIN_SAMPLE || !previous.averageMs) {
        return { ...metric, value, delta: COMPARISON_MISSING };
    }
    const change = Math.round(((previous.averageMs - current.averageMs) / previous.averageMs) * 100);
    if (change === 0) {
        return { ...metric, value, delta: `بدون تغییر ${VERSUS}` };
    }
    const direction = change > 0 ? 'سریع‌تر' : 'کندتر';
    return { ...metric, value, delta: `${fa(Math.abs(change))}٪ ${direction} ${VERSUS}` };
}

function onTimeMetric(current, previous) {
    const metric = { label: 'نرخ بستن وظایف در موعد', tone: 'sky' };
    if (current.closed < MIN_SAMPLE) {
        return { ...metric, value: '—', delta: INSUFFICIENT };
    }
    const rate = Math.round((current.on_time / current.closed) * 100);
    const value = `${fa(rate)}٪`;
    if (previous.closed < MIN_SAMPLE) {
        return { ...metric, value, delta: COMPARISON_MISSING };
    }
    const change = rate - Math.round((previous.on_time / previous.closed) * 100);
    if (change === 0) {
        return { ...metric, value, delta: `بدون تغییر ${VERSUS}` };
    }
    return { ...metric, value, delta: `${change > 0 ? '+' : '−'}${fa(Math.abs(change))} واحد ${VERSUS}` };
}

function referredMetric(current, previous, hasHistory) {
    const metric = { label: 'درخواست‌های برگشت‌خورده', tone: 'violet', value: fa(current) };
    if (!hasHistory) {
        return { ...metric, delta: COMPARISON_MISSING };
    }
    const change = current - previous;
    if (change === 0) {
        return { ...metric, delta: `بدون تغییر ${VERSUS}` };
    }
    return { ...metric, delta: `${fa(Math.abs(change))} مورد ${change < 0 ? 'کمتر' : 'بیشتر'} ${VERSUS}` };
}

async function contributions(members, from) {
    const result = await db.query(
        `SELECT owner_id, count(*)::int AS closed
         FROM tasks
         WHERE owner_id = ANY($1::int[]) AND completed_at >= $2
         GROUP BY owner_id`,
        [members.map((member) => member.id), from]
    );
    const byOwner = new Map(result.rows.map((row) => [row.owner_id, row.closed]));
    const total = result.rows.reduce((sum, row) => sum + row.closed, 0);
    return members.map((member, index) => ({
        userId: member.id,
        name: member.full_name,
        value: total ? Math.round(((byOwner.get(member.id) || 0) / total) * 100) : 0,
        tone: TONES[index % TONES.length]
    }));
}

const SUMMARY_TARGET_LABELS = { channel: 'کانال', group: 'گروه', conversation: 'گفتگوی' };

async function summaryReports(viewer, scope) {
    const executive = capabilityService.isExecutive(viewer.role);
    const result = await db.query(
        `SELECT s.*, u.full_name AS sender_name
         FROM summary_reports s
         LEFT JOIN users u ON u.id = s.sender_id
         ${executive ? '' : 'WHERE s.sender_id = ANY($1::int[])'}
         ORDER BY s.created_at DESC
         LIMIT 40`,
        executive ? [] : [scope.unitIds]
    );
    return result.rows.map((row) => ({
        reportId: row.id,
        title: `گزارش ${SUMMARY_TARGET_LABELS[row.target_type] || ''} ${row.target_name} — ${row.sender_name || 'کاربر حذف‌شده'}`.trim(),
        targetType: row.target_type,
        targetId: row.target_id,
        targetName: row.target_name,
        sender: row.sender_name || 'کاربر حذف‌شده',
        senderId: row.sender_id,
        bullets: (row.bullets || []).map((item) => item.text),
        messageCount: row.message_count,
        time: format.dayClock(new Date(row.created_at), new Date()),
        createdAt: row.created_at
    }));
}

async function reports(viewer) {
    const now = new Date();
    const currentFrom = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
    const previousFrom = new Date(now.getTime() - 2 * WINDOW_DAYS * DAY_MS);
    const scope = await loadScope(viewer);
    const [
        weekly,
        currentDecisions,
        previousDecisions,
        currentOnTime,
        previousOnTime,
        currentReferred,
        previousReferred,
        hasHistory,
        shares,
        summaries
    ] = await Promise.all([
        weeklyActivity(scope.unitIds, now),
        approvalService.decisionStats(viewer.sub, currentFrom, now),
        approvalService.decisionStats(viewer.sub, previousFrom, currentFrom),
        onTimeStats(scope.teamIds, currentFrom, now),
        onTimeStats(scope.teamIds, previousFrom, currentFrom),
        approvalService.countReferredForRequesters(scope.teamIds, currentFrom, now),
        approvalService.countReferredForRequesters(scope.teamIds, previousFrom, currentFrom),
        approvalService.hasRequestsBefore(scope.teamIds, currentFrom),
        contributions(scope.members, currentFrom),
        summaryReports(viewer, scope)
    ]);
    return {
        unit: scope.unit,
        summaries,
        weekly,
        metrics: [
            responseMetric(currentDecisions, previousDecisions),
            onTimeMetric(currentOnTime, previousOnTime),
            referredMetric(currentReferred, previousReferred, hasHistory)
        ],
        contributions: shares
    };
}

module.exports = {
    MIN_SAMPLE,
    OVERDUE_WEIGHT,
    DEFAULT_CAPACITY,
    CAPACITY_KEY,
    listTeamMembers,
    buildRoster,
    responseMetric,
    onTimeMetric,
    referredMetric,
    profile,
    overview,
    inbox,
    board,
    team,
    spaces,
    setSpacePinned,
    summaryReports,
    reports
};
