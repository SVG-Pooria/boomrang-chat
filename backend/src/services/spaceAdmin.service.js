const db = require('../config/database');
const backupMirror = require('../config/backupMirror');
const avatarUploadService = require('./avatarUpload.service');
const fileUploadService = require('./fileUpload.service');
const channelGroupLinkService = require('./channelGroupLink.service');
const { AdminConsoleError, SPACES } = require('./adminConsole.service');

const VISIBILITIES = ['public', 'private'];
const TITLE_LIMIT = 255;
const DESCRIPTION_LIMIT = 1000;
const LINKED_KIND = { channel: 'group', group: 'channel' };
const FILE_OWNER_COLUMNS = { channel: 'channel_message_id', group: 'group_message_id' };
const TARGET_TABLES = ['bot_reminders', 'polls', 'related_links', 'conversation_summaries', 'manager_space_pins'];
const SOURCE_TABLES = ['tasks', 'meetings', 'approval_requests'];

const PERMISSION_LABELS = {
    channel: {
        post: 'ارسال پست',
        edit_info: 'ویرایش اطلاعات',
        delete_messages: 'حذف پست دیگران',
        pin_messages: 'سنجاق پست',
        manage_members: 'مدیریت اعضا',
        manage_admins: 'مدیریت مدیران فضا',
        manage_link: 'مدیریت پیوند'
    },
    group: {
        send_messages: 'ارسال پیام',
        edit_info: 'ویرایش اطلاعات',
        delete_messages: 'حذف پیام دیگران',
        pin_messages: 'سنجاق پیام',
        manage_members: 'مدیریت اعضا',
        manage_admins: 'مدیریت مدیران فضا',
        manage_link: 'مدیریت پیوند'
    }
};

function notifier() {
    return require('../socket/notifier');
}

function avatarUrl(kind, row) {
    if (!row.avatar) {
        return null;
    }
    const version = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    return `/api/avatars/${kind}/${row.id}?v=${version}`;
}

async function requireSpace(kind, id, { allowArchived = false } = {}) {
    const result = await db.query(`SELECT * FROM ${SPACES[kind].table} WHERE id = $1`, [id]);
    const space = result.rows[0];
    if (!space) {
        throw new AdminConsoleError('SPACE_NOT_FOUND', 404);
    }
    if (!allowArchived && !space.is_active) {
        throw new AdminConsoleError('SPACE_ARCHIVED', 409);
    }
    return space;
}

async function memberIds(kind, id) {
    const { members, key } = SPACES[kind];
    const result = await db.query(`SELECT user_id FROM ${members} WHERE ${key} = $1`, [id]);
    return result.rows.map((row) => row.user_id);
}

async function discardUpload(file) {
    if (file && file.path) {
        await avatarUploadService.removeLocalFile(file.path);
    }
}

async function linkedSpace(kind, id) {
    const other = SPACES[LINKED_KIND[kind]];
    const result = await db.query(
        `SELECT x.id, x.title
         FROM channel_group_links l
         JOIN ${other.table} x ON x.id = l.${other.key}
         WHERE l.${SPACES[kind].key} = $1 AND l.is_active = true AND x.is_active = true`,
        [id]
    );
    return result.rows[0] || null;
}

async function linkCandidates(kind) {
    const other = SPACES[LINKED_KIND[kind]];
    const result = await db.query(
        `SELECT x.id, x.title
         FROM ${other.table} x
         WHERE x.is_active = true
           AND NOT EXISTS (
               SELECT 1 FROM channel_group_links l WHERE l.${other.key} = x.id AND l.is_active = true
           )
         ORDER BY x.title`
    );
    return result.rows.map((row) => ({ id: row.id, title: row.title }));
}

async function details(kind, id) {
    const space = await requireSpace(kind, id, { allowArchived: true });
    const link = space.is_active ? await linkedSpace(kind, id) : null;
    return {
        kind,
        id: space.id,
        title: space.title,
        description: space.description || '',
        visibility: space.visibility,
        avatarUrl: avatarUrl(kind, space),
        archived: !space.is_active,
        link,
        linkOptions: link || !space.is_active ? [] : await linkCandidates(kind)
    };
}

async function updateInfo(kind, id, { title, description, visibility } = {}) {
    const nextTitle = String(title || '').trim();
    if (!nextTitle) {
        throw new AdminConsoleError('TITLE_REQUIRED', 400);
    }
    if (nextTitle.length > TITLE_LIMIT) {
        throw new AdminConsoleError('TITLE_TOO_LONG', 400);
    }
    const nextDescription = String(description || '').trim();
    if (nextDescription.length > DESCRIPTION_LIMIT) {
        throw new AdminConsoleError('DESCRIPTION_TOO_LONG', 400);
    }
    if (!VISIBILITIES.includes(visibility)) {
        throw new AdminConsoleError('INVALID_VISIBILITY', 400);
    }
    const before = await requireSpace(kind, id);
    const result = await db.query(
        `UPDATE ${SPACES[kind].table}
         SET title = $1, description = $2, visibility = $3, updated_at = now()
         WHERE id = $4 RETURNING *`,
        [nextTitle, nextDescription || null, visibility, id]
    );
    notifier().notifySidebarChanged(await memberIds(kind, id));
    return { before, after: result.rows[0] };
}

async function replaceAvatar(kind, id, file, actorId) {
    let space;
    try {
        space = await requireSpace(kind, id);
    } catch (err) {
        await discardUpload(file);
        throw err;
    }
    const stored = await avatarUploadService.processAvatarUpload({
        tempPath: file.path,
        mimeType: file.mimetype,
        actorId
    });
    if (stored.status === 'infected') {
        throw new AdminConsoleError('INFECTED_FILE', 422);
    }
    if (stored.status === 'scan_error') {
        throw new AdminConsoleError('SCAN_UNAVAILABLE', 503);
    }
    if (stored.status === 'invalid_image') {
        throw new AdminConsoleError('INVALID_IMAGE', 400);
    }
    const row = await avatarUploadService.setEntityAvatar(kind, id, stored.avatarPath);
    notifier().notifySidebarChanged(await memberIds(kind, id));
    return { space, avatarUrl: avatarUrl(kind, { id, avatar: row.avatar, updated_at: row.updated_at }) };
}

async function removeAvatar(kind, id) {
    const space = await requireSpace(kind, id);
    if (!space.avatar) {
        throw new AdminConsoleError('AVATAR_NOT_FOUND', 404);
    }
    await avatarUploadService.clearEntityAvatar(kind, id);
    notifier().notifySidebarChanged(await memberIds(kind, id));
    return space;
}

async function linkTitles(channelId, groupId) {
    const result = await db.query(
        `SELECT (SELECT title FROM channels WHERE id = $1) AS channel_title,
                (SELECT title FROM groups WHERE id = $2) AS group_title`,
        [channelId, groupId]
    );
    return result.rows[0];
}

async function link(kind, id, targetId, actorId) {
    await requireSpace(kind, id);
    const channelId = kind === 'channel' ? id : targetId;
    const groupId = kind === 'channel' ? targetId : id;
    let created;
    try {
        created = await channelGroupLinkService.linkChannelToGroup(channelId, groupId, actorId);
    } catch (err) {
        if (err instanceof channelGroupLinkService.LinkError) {
            throw new AdminConsoleError(err.code, err.code.endsWith('_NOT_FOUND') ? 404 : 409);
        }
        throw err;
    }
    notifier().notifyChannelGroupLinked(channelId, groupId, created);
    return { channelId, groupId, ...(await linkTitles(channelId, groupId)) };
}

async function unlink(kind, id, actorId) {
    await requireSpace(kind, id);
    const removed = kind === 'channel'
        ? await channelGroupLinkService.unlinkChannel(id, actorId)
        : await channelGroupLinkService.unlinkGroup(id, actorId);
    if (!removed) {
        throw new AdminConsoleError('LINK_NOT_FOUND', 404);
    }
    notifier().notifyChannelGroupUnlinked(removed.channel_id, removed.group_id);
    return {
        channelId: removed.channel_id,
        groupId: removed.group_id,
        ...(await linkTitles(removed.channel_id, removed.group_id))
    };
}

async function setMemberPermissions(kind, id, userId, permissions) {
    const allowed = Object.keys(PERMISSION_LABELS[kind]);
    if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
        throw new AdminConsoleError('INVALID_PERMISSION', 400);
    }
    const keys = Object.keys(permissions);
    if (keys.length === 0 || keys.some((name) => !allowed.includes(name) || typeof permissions[name] !== 'boolean')) {
        throw new AdminConsoleError('INVALID_PERMISSION', 400);
    }
    const space = await requireSpace(kind, id);
    const { members, key } = SPACES[kind];
    const result = await db.query(
        `SELECT m.role, m.permissions, u.full_name
         FROM ${members} m
         JOIN users u ON u.id = m.user_id
         WHERE m.${key} = $1 AND m.user_id = $2`,
        [id, userId]
    );
    const current = result.rows[0];
    if (!current) {
        throw new AdminConsoleError('NOT_A_MEMBER', 404);
    }
    if (current.role === 'owner') {
        throw new AdminConsoleError('OWNER_ROLE_LOCKED', 409);
    }
    const previous = current.permissions || {};
    const changed = keys.filter((name) => Boolean(previous[name]) !== permissions[name]);
    const merged = { ...previous, ...permissions };
    if (changed.length) {
        await db.query(
            `UPDATE ${members} SET permissions = $1::jsonb WHERE ${key} = $2 AND user_id = $3`,
            [JSON.stringify(merged), id, userId]
        );
        notifier().notifySidebarChanged([userId]);
    }
    return {
        space,
        name: current.full_name,
        permissions: merged,
        changes: changed.map((name) => `${PERMISSION_LABELS[kind][name]} ${permissions[name] ? 'روشن' : 'خاموش'}`)
    };
}

async function removePermanently(kind, id, confirmTitle, actorId) {
    const space = await requireSpace(kind, id, { allowArchived: true });
    if (String(confirmTitle || '').trim() !== String(space.title || '').trim()) {
        throw new AdminConsoleError('CONFIRM_TITLE_MISMATCH', 400);
    }
    const { table, members, messages, key } = SPACES[kind];
    const fileOwner = FILE_OWNER_COLUMNS[kind];
    const client = await db.pool.connect();
    let removedFiles = [];
    let affectedMembers = [];
    let activeLink = null;
    let messageCount = 0;
    try {
        await client.query('BEGIN');
        await client.query(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
        affectedMembers = (await client.query(`SELECT user_id FROM ${members} WHERE ${key} = $1`, [id])).rows
            .map((row) => row.user_id);
        activeLink = (await client.query(
            `SELECT channel_id, group_id FROM channel_group_links WHERE ${key} = $1 AND is_active = true`,
            [id]
        )).rows[0] || null;
        messageCount = (await client.query(
            `SELECT count(*)::int AS count FROM ${messages} WHERE ${key} = $1`,
            [id]
        )).rows[0].count;
        const reminders = await client.query(
            'SELECT id FROM bot_reminders WHERE target_type = $1 AND target_id = $2',
            [kind, id]
        );
        removedFiles = (await client.query(
            `DELETE FROM message_files
             WHERE ${fileOwner} IN (SELECT id FROM ${messages} WHERE ${key} = $1)
                OR id IN (SELECT file_id FROM ${messages} WHERE ${key} = $1 AND file_id IS NOT NULL)
                OR reminder_id = ANY($2::int[])
             RETURNING original_path, compressed_path, thumbnail_path`,
            [id, reminders.rows.map((row) => row.id)]
        )).rows;
        for (const target of TARGET_TABLES) {
            await client.query(`DELETE FROM ${target} WHERE target_type = $1 AND target_id = $2`, [kind, id]);
        }
        for (const source of SOURCE_TABLES) {
            await client.query(
                `UPDATE ${source} SET source_target_type = NULL, source_target_id = NULL
                 WHERE source_target_type = $1 AND source_target_id = $2`,
                [kind, id]
            );
        }
        await client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    const paths = removedFiles
        .flatMap((row) => [row.original_path, row.compressed_path, row.thumbnail_path])
        .filter(Boolean);
    for (const filePath of paths) {
        await fileUploadService.removeLocalFile(filePath);
        await backupMirror.removeMirroredCopy(filePath);
    }
    if (space.avatar) {
        await avatarUploadService.removeLocalFile(space.avatar);
    }
    if (activeLink) {
        notifier().notifyChannelGroupUnlinked(activeLink.channel_id, activeLink.group_id);
    }
    await Promise.all(affectedMembers.map((userId) => notifier().removeUserFromSpaceRoom(kind, id, userId)));
    notifier().notifySidebarChanged(affectedMembers);
    notifier().notifyWorkspaceChanged('tasks');
    return {
        space,
        actorId,
        messages: messageCount,
        files: removedFiles.length,
        members: affectedMembers.length
    };
}

module.exports = {
    PERMISSION_LABELS,
    details,
    updateInfo,
    replaceAvatar,
    removeAvatar,
    discardUpload,
    link,
    unlink,
    setMemberPermissions,
    removePermanently
};
