const db = require('../config/database');
const format = require('../utils/persianFormat.util');

const LEVELS = ['info', 'warn', 'danger'];
const LEVEL_LABELS = { info: 'عادی', warn: 'هشدار', danger: 'بحرانی' };
const SECURITY_ACTIONS = ['auth.login_blocked', 'upload.infected_blocked'];
const EXPORT_LIMIT = 10000;

const ACTIONS = {
    'user.created': { label: 'ساخت کاربر جدید', level: 'info' },
    'user.role_changed': { label: 'تغییر نقش کاربر', level: 'warn' },
    'user.tag_changed': { label: 'تغییر تگ کاربر', level: 'info' },
    'user.disabled': { label: 'غیرفعال‌سازی حساب', level: 'warn' },
    'user.enabled': { label: 'فعال‌سازی دوباره حساب', level: 'info' },
    'user.deleted': { label: 'حذف کاربر', level: 'danger' },
    'user.archived': { label: 'تهیه آرشیو داده‌های کاربر', level: 'warn' },
    'password.reset': { label: 'بازنشانی رمز عبور', level: 'warn' },
    'password.viewed': { label: 'مشاهده رمز عبور', level: 'danger' },
    'message.deleted': { label: 'حذف پیام', level: 'danger' },
    'channel.created': { label: 'ساخت کانال', level: 'info' },
    'group.created': { label: 'ساخت گروه', level: 'info' },
    'channel.archived': { label: 'آرشیو کانال', level: 'warn' },
    'group.archived': { label: 'آرشیو گروه', level: 'warn' },
    'channel.restored': { label: 'بازگردانی کانال', level: 'info' },
    'group.restored': { label: 'بازگردانی گروه', level: 'info' },
    'channel.member_added': { label: 'افزودن عضو به کانال', level: 'info' },
    'group.member_added': { label: 'افزودن عضو به گروه', level: 'info' },
    'channel.member_removed': { label: 'حذف عضو از کانال', level: 'warn' },
    'group.member_removed': { label: 'حذف عضو از گروه', level: 'warn' },
    'channel.member_role_changed': { label: 'تغییر نقش عضو کانال', level: 'info' },
    'group.member_role_changed': { label: 'تغییر نقش عضو گروه', level: 'info' },
    'channel.owner_transferred': { label: 'واگذاری مالکیت کانال', level: 'warn' },
    'group.owner_transferred': { label: 'واگذاری مالکیت گروه', level: 'warn' },
    'oversight.file_downloaded': { label: 'دانلود فایل تحت نظارت', level: 'warn' },
    'channel.updated': { label: 'ویرایش اطلاعات کانال', level: 'info' },
    'group.updated': { label: 'ویرایش اطلاعات گروه', level: 'info' },
    'channel.avatar_changed': { label: 'تغییر عکس کانال', level: 'info' },
    'group.avatar_changed': { label: 'تغییر عکس گروه', level: 'info' },
    'channel.member_permissions_changed': { label: 'تغییر دسترسی عضو کانال', level: 'warn' },
    'group.member_permissions_changed': { label: 'تغییر دسترسی عضو گروه', level: 'warn' },
    'channel.deleted': { label: 'حذف دائمی کانال', level: 'danger' },
    'group.deleted': { label: 'حذف دائمی گروه', level: 'danger' },
    'space.linked': { label: 'پیوند کانال و گروه', level: 'warn' },
    'space.unlinked': { label: 'قطع پیوند کانال و گروه', level: 'warn' },
    'file.deleted': { label: 'حذف کامل فایل', level: 'danger' },
    'forward.retried': { label: 'ارسال دوباره پیام ناموفق صف انتقال', level: 'info' },
    'forward.discarded': { label: 'کنار گذاشتن پیام ناموفق صف انتقال', level: 'warn' },
    'tag.created': { label: 'ساخت تگ', level: 'info' },
    'tag.deleted': { label: 'حذف تگ', level: 'warn' },
    'settings.max_file_size': { label: 'تغییر سقف حجم فایل', level: 'warn' },
    'settings.message_cooldown': { label: 'تغییر فاصله بین پیام‌ها', level: 'warn' },
    'settings.policy': { label: 'تغییر سیاست سامانه', level: 'warn' },
    'session.revoked': { label: 'پایان دادن به نشست', level: 'warn' },
    'oversight.viewed': { label: 'مشاهده گفتگوی تحت نظارت', level: 'warn' },
    'activity.exported': { label: 'دریافت خروجی لاگ فعالیت', level: 'info' },
    'backup.schedule': { label: 'اجرای بکاپ خودکار', level: 'info' },
    'backup.manual': { label: 'اجرای بکاپ دستی', level: 'info' },
    'backup.failed': { label: 'شکست بکاپ', level: 'danger' },
    'backup.downloaded': { label: 'دانلود فایل بکاپ', level: 'warn' },
    'archive.downloaded': { label: 'دانلود آرشیو کاربر', level: 'warn' },
    'archive.purged': { label: 'پاک‌سازی آرشیو منقضی', level: 'info' },
    'reminder.created': { label: 'ساخت یادآوری بات', level: 'info' },
    'reminder.updated': { label: 'ویرایش یادآوری بات', level: 'info' },
    'reminder.paused': { label: 'توقف یادآوری بات', level: 'info' },
    'reminder.resumed': { label: 'فعال‌سازی یادآوری بات', level: 'info' },
    'reminder.deleted': { label: 'حذف یادآوری بات', level: 'warn' },
    'auth.login_blocked': { label: 'ورود ناموفق', level: 'danger' },
    'upload.infected_blocked': { label: 'مسدودسازی فایل آلوده', level: 'danger' }
};

async function record(actorId, action, target, meta) {
    const definition = ACTIONS[action];
    const level = definition ? definition.level : 'info';
    const result = await db.query(
        `INSERT INTO admin_audit_log (actor_user_id, actor_name, action, target_description, level, meta)
         VALUES ($1, (SELECT full_name FROM users WHERE id = $1), $2, $3, $4, $5)
         RETURNING id`,
        [actorId || null, action, target || null, level, meta ? JSON.stringify(meta) : null]
    );
    require('../socket/notifier').notifyAdmins('admin:audit', { id: result.rows[0].id, level });
    return result.rows[0];
}

async function recordMessageDeletion(actorId, targetType, targetId, messageId) {
    let target;
    if (targetType === 'channel' || targetType === 'group') {
        const table = targetType === 'channel' ? 'channels' : 'groups';
        const result = await db.query(`SELECT title FROM ${table} WHERE id = $1`, [targetId]);
        const title = result.rows[0] ? result.rows[0].title : '';
        target = targetType === 'channel' ? `کانال #${title}` : `گروه ${title}`;
    } else {
        const result = await db.query('SELECT type, title, is_system_channel FROM conversations WHERE id = $1', [targetId]);
        const conversation = result.rows[0];
        target = !conversation || conversation.type === 'direct'
            ? 'گفتگوی خصوصی'
            : conversation.title || (conversation.is_system_channel ? 'اطلاعیه‌ها' : 'گفتگوی سازمانی');
    }
    return record(actorId, 'message.deleted', target, { targetType, targetId, messageId });
}

async function fetchRows(level, limit) {
    const params = [];
    let condition = '';
    if (level) {
        params.push(level);
        condition = 'WHERE l.level = $1';
    }
    params.push(limit);
    const result = await db.query(
        `SELECT l.id, l.action, l.target_description, l.level, l.created_at,
                COALESCE(u.full_name, l.actor_name, 'سیستم') AS actor
         FROM admin_audit_log l
         LEFT JOIN users u ON u.id = l.actor_user_id
         ${condition}
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT $${params.length}`,
        params
    );
    return result.rows;
}

function actionLabel(action) {
    return ACTIONS[action] ? ACTIONS[action].label : action;
}

function serialize(row, now = new Date()) {
    return {
        id: row.id,
        actor: row.actor,
        action: actionLabel(row.action),
        target: row.target_description || '—',
        at: format.dayStamp(new Date(row.created_at), now),
        level: row.level
    };
}

async function list({ level = null, limit = 100 } = {}) {
    const rows = await fetchRows(level, limit);
    const now = new Date();
    return rows.map((row) => serialize(row, now));
}

function csvCell(value) {
    let text = String(value === null || value === undefined ? '' : value);
    if (/^[=+\-@]/.test(text)) {
        text = `'${text}`;
    }
    return `"${text.replace(/"/g, '""')}"`;
}

async function exportCsv(level = null) {
    const rows = await fetchRows(level, EXPORT_LIMIT);
    const lines = [['زمان', 'انجام‌دهنده', 'اقدام', 'هدف', 'شدت'].map(csvCell).join(',')];
    for (const row of rows) {
        const createdAt = new Date(row.created_at);
        lines.push([
            `${format.jalaliDate(createdAt)} ${format.clock(createdAt)}`,
            row.actor,
            actionLabel(row.action),
            row.target_description || '',
            LEVEL_LABELS[row.level]
        ].map(csvCell).join(','));
    }
    return `﻿${lines.join('\r\n')}\r\n`;
}

async function countSecurityAlerts(days) {
    const result = await db.query(
        `SELECT count(*)::int AS count
         FROM admin_audit_log
         WHERE action = ANY($1::varchar[]) AND created_at >= now() - make_interval(days => $2)`,
        [SECURITY_ACTIONS, days]
    );
    return result.rows[0].count;
}

module.exports = {
    ACTIONS,
    LEVELS,
    LEVEL_LABELS,
    SECURITY_ACTIONS,
    record,
    recordMessageDeletion,
    list,
    exportCsv,
    countSecurityAlerts,
    serialize
};
