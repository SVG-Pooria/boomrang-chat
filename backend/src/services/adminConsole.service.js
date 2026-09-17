const fs = require('fs/promises');
const db = require('../config/database');
const redis = require('../config/redis');
const uploadPaths = require('../config/uploadPaths');
const format = require('../utils/persianFormat.util');
const adminAudit = require('./adminAudit.service');
const approvalService = require('./approval.service');
const botService = require('./bot.service');
const capabilityService = require('./capability.service');
const channelCoreService = require('./channelCore.service');
const groupCoreService = require('./groupCore.service');
const channelMessageService = require('./channelMessage.service');
const groupMessageService = require('./groupMessage.service');
const messageService = require('./message.service');
const { HIDDEN_ROLE } = require('../config/visibility');

const ACCENTS = ['mint', 'sky', 'violet', 'rose', 'lemon'];
const ROLES = ['employee', 'manager', 'management', 'super_admin'];
const ASSIGNABLE_MEMBER_ROLES = ['admin', 'member'];
const HEALTH_TIMEOUT_MS = 1500;
const SECURITY_WINDOW_DAYS = 7;
const RECENT_EVENTS = 5;
const TRANSCRIPT_PAGE = 100;
const MEMBER_ROLE_LABELS = { owner: 'مالک', admin: 'مدیر', member: 'عضو' };

const SPACES = {
    channel: {
        table: 'channels',
        members: 'channel_members',
        messages: 'channel_messages',
        key: 'channel_id',
        create: (input) => channelCoreService.createChannel(input),
        archive: (id, actorId) => channelCoreService.archiveChannel(id, actorId),
        addMember: (id, userId) => channelCoreService.addChannelMember(id, userId, 'member'),
        removeMember: (id, userId) => channelCoreService.removeChannelMember(id, userId),
        setRole: (id, userId, role) => channelCoreService.setChannelMemberRole(id, userId, role),
        transfer: (id, userId) => channelCoreService.transferChannelOwnership(id, userId),
        transcript: (id, options) => channelMessageService.listChannelMessages(id, options)
    },
    group: {
        table: 'groups',
        members: 'group_members',
        messages: 'group_messages',
        key: 'group_id',
        create: (input) => groupCoreService.createGroup(input),
        archive: (id, actorId) => groupCoreService.archiveGroup(id, actorId),
        addMember: (id, userId) => groupCoreService.addGroupMember(id, userId, 'member'),
        removeMember: (id, userId) => groupCoreService.removeGroupMember(id, userId),
        setRole: (id, userId, role) => groupCoreService.setGroupMemberRole(id, userId, role),
        transfer: (id, userId) => groupCoreService.transferGroupOwnership(id, userId),
        transcript: (id, options) => groupMessageService.listGroupMessages(id, options)
    }
};

class AdminConsoleError extends Error {
    constructor(code, status) {
        super(code);
        this.code = code;
        this.status = status;
    }
}

function notifier() {
    return require('../socket/notifier');
}

function accentFor(id) {
    return ACCENTS[Math.abs(Number(id) || 0) % ACCENTS.length];
}

function latinDigits(value) {
    return String(value).replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function changeLabel(today, yesterday) {
    if (!yesterday) {
        return '—';
    }
    const change = Math.round(((today - yesterday) / yesterday) * 100);
    const sign = change > 0 ? '+' : change < 0 ? '−' : '';
    return `${sign}${format.toPersianDigits(Math.abs(change))}٪`;
}

async function overviewStats() {
    const [people, spaces, messages, alerts] = await Promise.all([
        db.query(
            `SELECT count(*) FILTER (WHERE is_active = true)::int AS active,
                    count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS joined
             FROM users
             WHERE is_bot = false`
        ),
        db.query(
            `SELECT count(*)::int AS total, count(*) FILTER (WHERE is_active = false)::int AS archived
             FROM (SELECT is_active FROM channels UNION ALL SELECT is_active FROM groups) spaces`
        ),
        db.query(
            `WITH bounds AS (
                 SELECT date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1 AS today
             )
             SELECT count(*) FILTER (WHERE m.created_at >= b.today)::int AS today,
                    count(*) FILTER (WHERE m.created_at < b.today
                                       AND m.created_at <= now() - interval '1 day')::int AS yesterday
             FROM bounds b
             CROSS JOIN (
                 SELECT created_at, sender_id FROM messages
                 UNION ALL SELECT created_at, sender_id FROM channel_messages
                 UNION ALL SELECT created_at, sender_id FROM group_messages
             ) m
             LEFT JOIN users u ON u.id = m.sender_id
             WHERE m.created_at >= b.today - interval '1 day' AND COALESCE(u.is_bot, false) = false`,
            [format.TIMEZONE]
        ),
        adminAudit.countSecurityAlerts(SECURITY_WINDOW_DAYS)
    ]);

    const { active, joined } = people.rows[0];
    const { total, archived } = spaces.rows[0];
    const { today, yesterday } = messages.rows[0];

    return [
        { key: 'users', label: 'کاربران فعال', value: format.groupDigits(active), delta: `+${format.toPersianDigits(joined)} این هفته` },
        { key: 'spaces', label: 'کانال و گروه', value: format.groupDigits(total), delta: `${format.toPersianDigits(archived)} آرشیو شده` },
        { key: 'messages', label: 'پیام امروز', value: format.groupDigits(today), delta: changeLabel(today, yesterday) },
        {
            key: 'alerts',
            label: 'هشدار امنیتی',
            value: format.toPersianDigits(alerts),
            delta: alerts > 0 ? 'نیاز به بررسی' : 'موردی ثبت نشده'
        }
    ];
}

function withTimeout(promise) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('TIMEOUT')), HEALTH_TIMEOUT_MS);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function ratio(used, total) {
    if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
        return null;
    }
    return Math.min(100, Math.max(0, Math.round((used / total) * 100)));
}

async function databaseLoad() {
    const result = await db.query(
        `SELECT (SELECT count(*) FROM pg_stat_activity)::int AS used,
                current_setting('max_connections')::int AS total`
    );
    return ratio(result.rows[0].used, result.rows[0].total);
}

async function storageLoad() {
    const stats = await fs.statfs(uploadPaths.ROOT);
    const used = stats.blocks - stats.bfree;
    return ratio(used, used + stats.bavail);
}

function infoField(info, name) {
    const match = info.match(new RegExp(`^${name}:(\\d+)`, 'm'));
    return match ? Number(match[1]) : null;
}

async function queueLoad() {
    const info = await redis.getClient().info('memory');
    const used = infoField(info, 'used_memory');
    const ceiling = infoField(info, 'maxmemory') || infoField(info, 'total_system_memory');
    return ratio(used, ceiling);
}

const HEALTH_PROBES = [
    { key: 'database', label: 'پایگاه‌داده', probe: databaseLoad },
    { key: 'storage', label: 'فضای ذخیره‌سازی', probe: storageLoad },
    { key: 'queue', label: 'صف پیام‌ها', probe: queueLoad }
];

async function health() {
    const values = await Promise.all(
        HEALTH_PROBES.map(({ probe }) => withTimeout(probe()).catch(() => null))
    );
    return HEALTH_PROBES.map(({ key, label }, index) => ({ key, label, value: values[index] }));
}

async function overview() {
    const [stats, events, gauges] = await Promise.all([
        overviewStats(),
        adminAudit.list({ limit: RECENT_EVENTS }),
        health()
    ]);
    return { stats, events, health: gauges };
}

async function badges(viewer) {
    const [setup, alerts, approvals] = await Promise.all([
        db.query(
            `SELECT count(*)::int AS count FROM users
             WHERE is_bot = false AND is_active = true AND password_encrypted IS NULL`
        ),
        adminAudit.countSecurityAlerts(SECURITY_WINDOW_DAYS),
        approvalService.countPendingFor(viewer)
    ]);
    return { overview: approvals, users: setup.rows[0].count, oversight: alerts };
}

function presenceOf(row, now) {
    if (!row.is_active || row.presence_status !== 'online') {
        return 'offline';
    }
    const dndActive = row.dnd_enabled && (!row.dnd_until || new Date(row.dnd_until) > now);
    return dndActive ? 'away' : 'online';
}

function lastSeenLabel(row, presence, now) {
    if (presence !== 'offline') {
        return 'هم‌اکنون';
    }
    if (!row.last_seen_at) {
        return 'هنوز وارد نشده';
    }
    const seenAt = new Date(row.last_seen_at);
    if (format.daysBetween(seenAt, now) === 1) {
        return `دیروز، ${format.clock(seenAt)}`;
    }
    return format.relativeTime(seenAt, now);
}

function serializeUser(row, now, permissions) {
    const presence = presenceOf(row, now);
    return {
        id: row.id,
        fullName: row.full_name,
        phone: row.phone,
        role: row.role,
        jobTitle: row.job_title || '',
        unit: row.unit || '',
        tagId: row.tag_id,
        tag: row.tag_name || '',
        isActive: row.is_active,
        hasPassword: row.has_password,
        neverSignedIn: !row.last_seen_at,
        presence,
        lastSeen: lastSeenLabel(row, presence, now),
        permissions: permissions || [],
        initials: format.initials(row.full_name),
        accent: accentFor(row.id)
    };
}

async function userCounts() {
    const result = await db.query(
        `SELECT u.role, count(*)::int AS total,
                count(*) FILTER (WHERE p.last_seen_at IS NULL)::int AS never_signed_in
         FROM users u
         LEFT JOIN presence p ON p.user_id = u.id
         WHERE u.is_bot = false
         GROUP BY u.role`
    );
    const counts = { all: 0, neverSignedIn: 0 };
    for (const role of ROLES) {
        counts[role] = 0;
    }
    for (const row of result.rows) {
        counts.all += row.total;
        counts.neverSignedIn += row.never_signed_in;
        if (counts[row.role] !== undefined) {
            counts[row.role] = row.total;
        }
    }
    return counts;
}

async function listUsers({ search, role } = {}) {
    const params = [];
    const conditions = ['u.is_bot = false'];
    if (ROLES.includes(role)) {
        params.push(role);
        conditions.push(`u.role = $${params.length}`);
    } else if (role === 'never') {
        conditions.push('p.last_seen_at IS NULL');
    }
    const term = latinDigits(String(search || '').trim());
    if (term) {
        params.push(`%${term}%`);
        const index = params.length;
        conditions.push(`(u.full_name ILIKE $${index} OR u.phone ILIKE $${index} OR t.name ILIKE $${index})`);
    }
    const result = await db.query(
        `SELECT u.id, u.full_name, u.phone, u.role, u.job_title, u.unit, u.tag_id, t.name AS tag_name, u.is_active,
                (u.password_encrypted IS NOT NULL) AS has_password, u.dnd_enabled, u.dnd_until,
                p.status AS presence_status, p.last_seen_at
         FROM users u
         LEFT JOIN tags t ON t.id = u.tag_id
         LEFT JOIN presence p ON p.user_id = u.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY u.full_name`,
        params
    );
    const now = new Date();
    const grants = await capabilityService.grantedMap(result.rows.map((row) => row.id));
    return {
        users: result.rows.map((row) => serializeUser(row, now, grants.get(row.id))),
        counts: await userCounts()
    };
}

async function listTags() {
    const result = await db.query(
        `SELECT t.id, t.name,
                count(u.id) FILTER (WHERE u.is_active = true AND u.is_bot = false)::int AS members
         FROM tags t
         LEFT JOIN users u ON u.tag_id = t.id
         GROUP BY t.id
         ORDER BY t.name`
    );
    return result.rows;
}

async function deleteTag(tagId) {
    const result = await db.query(
        `WITH affected AS (SELECT count(*)::int AS members FROM users WHERE tag_id = $1)
         DELETE FROM tags WHERE id = $1
         RETURNING id, name, (SELECT members FROM affected) AS members`,
        [tagId]
    );
    return result.rows[0] || null;
}

function spaceQuery(kind) {
    const space = SPACES[kind];
    return `SELECT '${kind}' AS kind, x.id, x.title, x.is_active, x.owner_id, x.created_at,
                   owner.full_name AS owner_name,
                   (SELECT count(*)::int FROM ${space.members} m
                    JOIN users mu ON mu.id = m.user_id
                    WHERE m.${space.key} = x.id AND mu.is_bot = false) AS members,
                   (SELECT count(*)::int FROM ${space.messages} msg
                    WHERE msg.${space.key} = x.id AND msg.is_deleted = false) AS messages
            FROM ${space.table} x
            LEFT JOIN users owner ON owner.id = x.owner_id`;
}

function serializeSpace(row) {
    return {
        kind: row.kind,
        id: row.id,
        name: row.title,
        owner: row.owner_name || 'بدون مالک',
        ownerId: row.owner_id,
        members: row.members,
        messages: row.messages,
        archived: !row.is_active
    };
}

async function listSpaces(kind = null) {
    const kinds = SPACES[kind] ? [kind] : Object.keys(SPACES);
    const result = await db.query(
        `SELECT * FROM (${kinds.map(spaceQuery).join(' UNION ALL ')}) spaces
         ORDER BY is_active DESC, created_at DESC`
    );
    return result.rows.map(serializeSpace);
}

async function findSpace(kind, id) {
    const result = await db.query(
        `SELECT id, title, is_active, owner_id FROM ${SPACES[kind].table} WHERE id = $1`,
        [id]
    );
    return result.rows[0] || null;
}

async function listMemberIds(kind, id) {
    const space = SPACES[kind];
    const result = await db.query(`SELECT user_id FROM ${space.members} WHERE ${space.key} = $1`, [id]);
    return result.rows.map((row) => row.user_id);
}

async function eligibleUser(userId) {
    const result = await db.query(
        'SELECT id, full_name, role, is_active, is_bot FROM users WHERE id = $1',
        [userId]
    );
    const row = result.rows[0];
    if (!row || !row.is_active || row.is_bot || row.role === HIDDEN_ROLE) {
        return null;
    }
    return row;
}

async function createSpace(kind, { title, ownerId, actorId }) {
    const owner = await eligibleUser(ownerId);
    if (!owner) {
        throw new AdminConsoleError('OWNER_NOT_ELIGIBLE', 400);
    }
    const created = await SPACES[kind].create({ title, ownerId, createdBy: actorId });
    await notifier().joinUserToSpaceRoom(kind, created.id, ownerId);
    notifier().notifySidebarChanged([ownerId]);
    return { id: created.id, name: created.title, owner: owner.full_name };
}

async function setSpaceArchived(kind, id, archived, actorId) {
    const current = await findSpace(kind, id);
    if (!current) {
        return null;
    }
    if (current.is_active === !archived) {
        return { space: current, changed: false };
    }
    if (archived) {
        const { removedLink } = await SPACES[kind].archive(id, actorId);
        if (removedLink) {
            if (kind === 'channel') {
                notifier().notifyChannelGroupUnlinked(id, removedLink.group_id);
            } else {
                notifier().notifyChannelGroupUnlinked(removedLink.channel_id, id);
            }
        }
    } else {
        await db.query(`UPDATE ${SPACES[kind].table} SET is_active = true, updated_at = now() WHERE id = $1`, [id]);
    }
    const memberIds = await listMemberIds(kind, id);
    if (!archived) {
        await Promise.all(memberIds.map((userId) => notifier().joinUserToSpaceRoom(kind, id, userId)));
    }
    notifier().notifySidebarChanged(memberIds);
    return { space: current, changed: true };
}

async function spaceMembers(kind, id) {
    const space = SPACES[kind];
    const [members, candidates] = await Promise.all([
        db.query(
            `SELECT m.user_id, m.role, m.permissions, u.full_name
             FROM ${space.members} m
             JOIN users u ON u.id = m.user_id
             WHERE m.${space.key} = $1 AND u.is_bot = false
             ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.full_name`,
            [id]
        ),
        db.query(
            `SELECT u.id, u.full_name
             FROM users u
             WHERE u.is_active = true AND u.is_bot = false AND u.role <> $2
               AND NOT EXISTS (
                   SELECT 1 FROM ${space.members} m WHERE m.${space.key} = $1 AND m.user_id = u.id
               )
             ORDER BY u.full_name`,
            [id, HIDDEN_ROLE]
        )
    ]);
    return {
        members: members.rows.map((row) => ({
            userId: row.user_id,
            name: row.full_name,
            role: row.role,
            roleLabel: MEMBER_ROLE_LABELS[row.role] || row.role,
            permissions: row.permissions || {},
            initials: format.initials(row.full_name),
            accent: accentFor(row.user_id)
        })),
        candidates: candidates.rows.map((row) => ({ userId: row.id, name: row.full_name }))
    };
}

async function membershipOf(kind, id, userId) {
    const space = SPACES[kind];
    const result = await db.query(
        `SELECT role FROM ${space.members} WHERE ${space.key} = $1 AND user_id = $2`,
        [id, userId]
    );
    return result.rows[0] || null;
}

async function addSpaceMember(kind, id, userId) {
    const space = await findSpace(kind, id);
    if (!space) {
        throw new AdminConsoleError('SPACE_NOT_FOUND', 404);
    }
    if (!space.is_active) {
        throw new AdminConsoleError('SPACE_ARCHIVED', 409);
    }
    const user = await eligibleUser(userId);
    if (!user) {
        throw new AdminConsoleError('MEMBER_NOT_ELIGIBLE', 400);
    }
    if (await membershipOf(kind, id, userId)) {
        throw new AdminConsoleError('ALREADY_A_MEMBER', 409);
    }
    await SPACES[kind].addMember(id, userId);
    await notifier().joinUserToSpaceRoom(kind, id, userId);
    notifier().notifySidebarChanged([userId]);
    return { space, user };
}

async function removeSpaceMember(kind, id, userId) {
    const space = await findSpace(kind, id);
    if (!space) {
        throw new AdminConsoleError('SPACE_NOT_FOUND', 404);
    }
    const membership = await membershipOf(kind, id, userId);
    if (!membership) {
        throw new AdminConsoleError('NOT_A_MEMBER', 404);
    }
    if (membership.role === 'owner') {
        throw new AdminConsoleError('OWNER_CANNOT_BE_REMOVED', 409);
    }
    const userResult = await db.query('SELECT full_name FROM users WHERE id = $1', [userId]);
    await SPACES[kind].removeMember(id, userId);
    await notifier().removeUserFromSpaceRoom(kind, id, userId);
    notifier().notifySidebarChanged([userId]);
    return { space, name: userResult.rows[0] ? userResult.rows[0].full_name : '' };
}

async function transferSpaceOwner(kind, id, userId) {
    const space = await findSpace(kind, id);
    if (!space) {
        throw new AdminConsoleError('SPACE_NOT_FOUND', 404);
    }
    if (!space.is_active) {
        throw new AdminConsoleError('SPACE_ARCHIVED', 409);
    }
    if (space.owner_id === userId) {
        throw new AdminConsoleError('ALREADY_OWNER', 409);
    }
    const user = await eligibleUser(userId);
    if (!user) {
        throw new AdminConsoleError('OWNER_NOT_ELIGIBLE', 400);
    }
    await SPACES[kind].transfer(id, userId);
    await notifier().joinUserToSpaceRoom(kind, id, userId);
    notifier().notifySidebarChanged([userId, space.owner_id].filter(Boolean));
    return { space, user };
}

async function setSpaceMemberRole(kind, id, userId, role) {
    if (!ASSIGNABLE_MEMBER_ROLES.includes(role)) {
        throw new AdminConsoleError('INVALID_ROLE', 400);
    }
    const space = await findSpace(kind, id);
    if (!space) {
        throw new AdminConsoleError('SPACE_NOT_FOUND', 404);
    }
    const membership = await membershipOf(kind, id, userId);
    if (!membership) {
        throw new AdminConsoleError('NOT_A_MEMBER', 404);
    }
    if (membership.role === 'owner') {
        throw new AdminConsoleError('OWNER_ROLE_LOCKED', 409);
    }
    if (membership.role === role) {
        return { space, name: null, changed: false };
    }
    const updated = await SPACES[kind].setRole(id, userId, role);
    notifier().notifySidebarChanged([userId]);
    return { space, name: updated ? updated.full_name : '', changed: true };
}

function serializeTranscript(rows) {
    const now = new Date();
    return rows.map((row) => ({
        id: row.id,
        sender: row.sender_name,
        senderId: row.sender_id,
        body: row.body || '',
        at: format.dayStamp(new Date(row.created_at), now),
        clock: format.clock(new Date(row.created_at)),
        createdAt: row.created_at,
        type: row.type || 'text',
        attachment: row.file_original_name || null,
        fileId: row.file_row_id || null,
        fileMode: row.file_mode || null,
        fileMimeType: row.file_mime_type || null,
        confidential: Boolean(row.is_confidential),
        edited: Boolean(row.is_edited),
        pinned: Boolean(row.is_pinned)
    }));
}

async function transcript(kind, id, { before } = {}) {
    return serializeTranscript(await SPACES[kind].transcript(id, { before, limit: TRANSCRIPT_PAGE }));
}

const CONVERSATION_SELECT = `
    SELECT c.id, c.type, c.title, c.is_system_channel, c.origin, c.closed_at,
           ua.full_name AS user_a_name, ub.full_name AS user_b_name
    FROM conversations c
    LEFT JOIN users ua ON ua.id = c.direct_user_a
    LEFT JOIN users ub ON ub.id = c.direct_user_b`;

function conversationName(row) {
    if (row.type === 'direct') {
        return `${row.user_a_name || 'کاربر حذف‌شده'} و ${row.user_b_name || 'کاربر حذف‌شده'}`;
    }
    return row.title || (row.is_system_channel ? 'اطلاعیه‌ها' : 'گفتگوی سازمانی');
}

async function listConversations() {
    const result = await db.query(
        `SELECT x.*,
                (SELECT count(*)::int FROM conversation_members cm WHERE cm.conversation_id = x.id) AS members,
                (SELECT count(*)::int FROM messages m
                 WHERE m.conversation_id = x.id AND m.is_deleted = false) AS messages,
                (SELECT max(m.id) FROM messages m WHERE m.conversation_id = x.id) AS last_message_id
         FROM (${CONVERSATION_SELECT}) x
         ORDER BY last_message_id DESC NULLS LAST, x.id DESC`
    );
    return result.rows.map((row) => ({
        kind: 'conversation',
        id: row.id,
        name: conversationName(row),
        direct: row.type === 'direct',
        ticket: row.origin === 'management_approved',
        closed: Boolean(row.closed_at),
        members: row.members,
        messages: row.messages
    }));
}

async function findConversation(id) {
    const result = await db.query(`${CONVERSATION_SELECT} WHERE c.id = $1`, [id]);
    const row = result.rows[0];
    return row ? { id: row.id, name: conversationName(row), direct: row.type === 'direct' } : null;
}

async function conversationTranscript(id, { before } = {}) {
    return serializeTranscript(await messageService.listMessages(id, { before, limit: TRANSCRIPT_PAGE }));
}

async function listApprovals(viewer) {
    const items = await approvalService.listForManager(viewer, []);
    return items.filter((item) => item.canDecide);
}

async function listArchives() {
    const result = await db.query(
        `SELECT id, target_full_name_snapshot, deleted_at, size_bytes, file_count, purge_after
         FROM user_export_archives
         WHERE deleted_at IS NOT NULL AND purged_at IS NULL
         ORDER BY deleted_at DESC`
    );
    return result.rows.map((row) => ({
        id: row.id,
        name: row.target_full_name_snapshot,
        deletedAt: format.monthDay(new Date(row.deleted_at)),
        size: format.fileSize(row.size_bytes),
        files: row.file_count
    }));
}

function reminderTarget(row) {
    if (row.target_type === 'channel') {
        return row.target_title ? `#${row.target_title}` : 'کانال حذف‌شده';
    }
    if (row.target_type === 'group') {
        return row.target_title || 'گروه حذف‌شده';
    }
    return row.target_title || 'اطلاعیه‌ها';
}

async function listReminders() {
    const result = await db.query(
        `SELECT r.id, r.title, r.message, r.conversation_id, r.target_type, r.target_id, r.scheduled_at,
                r.repeat_daily_at, r.repeat_days, r.is_active, r.attachment_file_id,
                rf.original_name AS attachment_name, rf.mode AS attachment_mode,
                rf.mime_type AS attachment_mime_type, rf.size_bytes AS attachment_size,
                CASE r.target_type
                    WHEN 'channel' THEN c.title
                    WHEN 'group' THEN g.title
                    ELSE conv.title
                END AS target_title,
                (SELECT count(*)::int FROM bot_reminder_deliveries d WHERE d.reminder_id = r.id) AS delivered
         FROM bot_reminders r
         LEFT JOIN message_files rf ON rf.id = r.attachment_file_id
         LEFT JOIN channels c ON r.target_type = 'channel' AND c.id = r.target_id
         LEFT JOIN groups g ON r.target_type = 'group' AND g.id = r.target_id
         LEFT JOIN conversations conv ON r.target_type = 'conversation' AND conv.id = COALESCE(r.target_id, r.conversation_id)
         ORDER BY r.created_at DESC`
    );
    return result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        target: reminderTarget(row),
        targetType: row.target_type || 'conversation',
        targetId: row.target_id || row.conversation_id || null,
        message: row.message || '',
        schedule: botService.scheduleLabel(row),
        time: row.repeat_daily_at || null,
        repeatDays: row.repeat_days,
        active: row.is_active,
        delivered: row.delivered,
        attachment: row.attachment_file_id
            ? {
                  fileId: row.attachment_file_id,
                  name: row.attachment_name || 'پیوست',
                  mode: row.attachment_mode || 'file',
                  mimeType: row.attachment_mime_type || null,
                  sizeBytes: row.attachment_size || null
              }
            : null
    }));
}

module.exports = {
    AdminConsoleError,
    ROLES,
    SPACES,
    MEMBER_ROLE_LABELS,
    overview,
    health,
    badges,
    listUsers,
    listTags,
    deleteTag,
    listSpaces,
    findSpace,
    createSpace,
    setSpaceArchived,
    spaceMembers,
    addSpaceMember,
    removeSpaceMember,
    setSpaceMemberRole,
    transferSpaceOwner,
    transcript,
    listConversations,
    findConversation,
    conversationTranscript,
    listApprovals,
    listArchives,
    listReminders
};
