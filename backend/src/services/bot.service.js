const cron = require('node-cron');
const db = require('../config/database');
const channelService = require('./channel.service');
const messageService = require('./message.service');
const presenceService = require('./presence.service');
const activityLogService = require('./activityLog.service');
const botTargetService = require('./botTarget.service');
const botAttachmentService = require('./botAttachment.service');
const botReminderDeliveryService = require('./botReminderDelivery.service');
const { HIDDEN_ROLE } = require('../config/visibility');
const format = require('../utils/persianFormat.util');

const BOT_PHONE = 'system-bot';
const BOT_FULL_NAME = 'دستیار سیستم';
const SETTING_ENABLED = 'bot_daily_summary_enabled';
const SETTING_TIME = 'bot_daily_summary_time';
const SETTING_CONVERSATION = 'bot_target_conversation_id';
const DEFAULT_SUMMARY_TIME = '08:30';
const REMINDER_TIMEZONE = 'Asia/Tehran';
const REMINDER_CONCURRENCY = 4;
const WORK_WEEK = [0, 1, 2, 3, 6];
const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const PERSIAN_WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

const TARGET_MESSAGE_TABLE = {
    conversation: 'messages',
    channel: 'channel_messages',
    group: 'group_messages'
};

const timeLabelFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: REMINDER_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
});

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: REMINDER_TIMEZONE
});

let botUserId = null;
let lastSummaryDayKey = null;
let ioRef = null;

function bindIo(io) {
    ioRef = io;
}

function conversationRoom(conversationId) {
    return `conversation:${conversationId}`;
}

function toPersianDigits(value) {
    return String(value).replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

function currentTimeLabel(date) {
    return timeLabelFormatter.format(date);
}

function currentDateKey(date) {
    return dateKeyFormatter.format(date);
}

function formatDateLabel(date) {
    const weekday = PERSIAN_WEEKDAYS[date.getDay()];
    const day = toPersianDigits(date.getDate());
    const month = toPersianDigits(date.getMonth() + 1);
    const year = toPersianDigits(date.getFullYear());
    return `${weekday} ${year}/${month}/${day}`;
}

async function getSetting(key, fallback) {
    const result = await db.query('SELECT value FROM system_settings WHERE key = $1', [key]);
    return result.rows[0] ? result.rows[0].value : fallback;
}

async function setSetting(key, value) {
    await db.query(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [key, value]
    );
}

async function ensureBotUser() {
    if (botUserId) {
        return botUserId;
    }
    const existing = await db.query('SELECT id FROM users WHERE phone = $1', [BOT_PHONE]);
    if (existing.rows[0]) {
        botUserId = existing.rows[0].id;
        return botUserId;
    }
    const inserted = await db.query(
        `INSERT INTO users (full_name, phone, role, is_active, is_bot)
         VALUES ($1, $2, 'management', true, true) RETURNING id`,
        [BOT_FULL_NAME, BOT_PHONE]
    );
    botUserId = inserted.rows[0].id;
    return botUserId;
}

async function ensureBotChannelMembership() {
    const userId = await ensureBotUser();
    await channelService.ensureSystemChannelMembership(userId, 'management');
    return userId;
}

async function resolveTargetConversation(conversationOverride) {
    if (conversationOverride) {
        return conversationOverride;
    }
    const configuredId = await getSetting(SETTING_CONVERSATION, '');
    if (configuredId) {
        const result = await db.query('SELECT * FROM conversations WHERE id = $1', [Number(configuredId)]);
        if (result.rows[0]) {
            return result.rows[0];
        }
    }
    return channelService.getOrCreateSystemChannel();
}

function deliver(conversationId, message) {
    if (!ioRef) {
        return;
    }
    ioRef.to(conversationRoom(conversationId)).emit('message:new', { conversationId, message });
}

async function sendBotMessage(body, conversationOverride) {
    const userId = await ensureBotUser();
    const target = await resolveTargetConversation(conversationOverride);
    await db.query(
        `INSERT INTO conversation_members (conversation_id, user_id, role_in_conv)
         VALUES ($1, $2, 'can_post')
         ON CONFLICT (conversation_id, user_id) DO NOTHING`,
        [target.id, userId]
    );
    const message = await messageService.createMessage({
        conversationId: target.id,
        senderId: userId,
        body,
        type: 'text'
    });
    deliver(target.id, message);
    await activityLogService.log(userId, 'bot.message.sent', { conversationId: target.id });
    return message;
}

async function buildDailySummaryText() {
    const usersResult = await db.query(
        `SELECT id, full_name FROM users
         WHERE is_active = true AND is_bot = false AND role != $1`,
        [HIDDEN_ROLE]
    );
    const online = await presenceService.listOnline();
    const onlineIds = new Set(online.map((row) => row.user_id));
    const totalCount = usersResult.rows.length;
    const offlineUsers = usersResult.rows.filter((row) => !onlineIds.has(row.id));
    const onlineCount = totalCount - offlineUsers.length;

    const now = new Date();
    const lines = [
        `خلاصه‌ی حضور امروز — ${formatDateLabel(now)}`,
        `آنلاین: ${toPersianDigits(onlineCount)} از ${toPersianDigits(totalCount)} نفر`
    ];
    if (offlineUsers.length > 0 && offlineUsers.length <= 15) {
        lines.push(`هنوز آنلاین نشده‌اند: ${offlineUsers.map((row) => row.full_name).join('، ')}`);
    }
    return lines.join('\n');
}

async function runDailySummaryIfDue() {
    const enabled = await getSetting(SETTING_ENABLED, 'true');
    if (enabled !== 'true') {
        return;
    }
    const configuredTime = await getSetting(SETTING_TIME, DEFAULT_SUMMARY_TIME);
    const now = new Date();
    if (currentTimeLabel(now) !== configuredTime) {
        return;
    }
    const todayKey = currentDateKey(now);
    if (lastSummaryDayKey === todayKey) {
        return;
    }
    lastSummaryDayKey = todayKey;
    const body = await buildDailySummaryText();
    await sendBotMessage(body);
}

async function resolveReminderTarget(reminder) {
    const targetType = reminder.target_type || 'conversation';
    if (reminder.target_id) {
        return { targetType, targetId: reminder.target_id };
    }
    if (targetType !== 'conversation') {
        return { targetType, targetId: null };
    }
    const fallback = await resolveTargetConversation(
        reminder.conversation_id ? { id: reminder.conversation_id } : null
    );
    return { targetType: 'conversation', targetId: fallback.id };
}

async function attachClonedFileToMessage(targetType, message, fileId) {
    if (targetType === 'conversation') {
        return messageService.attachFile(message.id, fileId);
    }
    const table = TARGET_MESSAGE_TABLE[targetType];
    await db.query(`UPDATE ${table} SET file_id = $1 WHERE id = $2`, [fileId, message.id]);
    return { ...message, file_id: fileId };
}

async function sendReminderMessage(reminder) {
    const { targetType, targetId } = await resolveReminderTarget(reminder);
    if (!targetId) {
        throw new botTargetService.TargetUnavailableError(targetType, targetId);
    }
    const userId = await ensureBotUser();
    const body = reminder.message
        ? `یادآوری: ${reminder.title}\n${reminder.message}`
        : `یادآوری: ${reminder.title}`;
    const messageType = reminder.message_type || 'text';

    if (!reminder.attachment_file_id) {
        const { message } = await botTargetService.sendToTarget({
            targetType,
            targetId,
            senderId: userId,
            body,
            type: messageType
        });
        await activityLogService.log(userId, 'bot.reminder.sent', { reminderId: reminder.id, targetType, targetId });
        await botReminderDeliveryService.recordDelivery({
            reminderId: reminder.id,
            targetType,
            targetId,
            messageIdRef: message.id
        });
        return message;
    }

    await botTargetService.resolveTarget(targetType, targetId);
    await botTargetService.ensureBotMembership(targetType, targetId, userId);
    let message = await botTargetService.createMessageForTarget(targetType, targetId, {
        senderId: userId,
        body,
        type: messageType,
        fileId: null
    });

    const fileRecord = await botAttachmentService.cloneForDelivery({
        attachmentFileId: reminder.attachment_file_id,
        targetType,
        messageId: message.id
    });
    if (fileRecord) {
        message = (await attachClonedFileToMessage(targetType, message, fileRecord.id)) || message;
    }

    botTargetService.deliverMessage(targetType, targetId, fileRecord ? { ...message, file: fileRecord } : message);
    await activityLogService.log(userId, 'bot.reminder.sent', {
        reminderId: reminder.id,
        targetType,
        targetId,
        hasAttachment: Boolean(fileRecord)
    });
    await botReminderDeliveryService.recordDelivery({
        reminderId: reminder.id,
        targetType,
        targetId,
        messageIdRef: message.id
    });
    return message;
}

async function withReminderLock(reminderId, handler) {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const locked = await client.query(
            'SELECT * FROM bot_reminders WHERE id = $1 FOR NO KEY UPDATE SKIP LOCKED',
            [reminderId]
        );
        const row = locked.rows[0];
        if (!row) {
            await client.query('ROLLBACK');
            return;
        }
        await handler(client, row);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function deactivateUnavailableTarget(client, reminder, err) {
    await client.query('UPDATE bot_reminders SET is_active = false WHERE id = $1', [reminder.id]);
    await activityLogService.log(reminder.created_by, 'bot.reminder.target_unavailable', {
        reminderId: reminder.id,
        targetType: err.targetType,
        targetId: err.targetId
    });
}

async function processOnceReminder(reminderId) {
    await withReminderLock(reminderId, async (client, row) => {
        if (!row.is_active || !row.scheduled_at || new Date(row.scheduled_at) > new Date()) {
            return;
        }
        try {
            await sendReminderMessage(row);
            await client.query(
                'UPDATE bot_reminders SET is_active = false, last_sent_at = now() WHERE id = $1',
                [row.id]
            );
        } catch (err) {
            if (err instanceof botTargetService.TargetUnavailableError) {
                await deactivateUnavailableTarget(client, row, err);
                return;
            }
            throw err;
        }
    });
}

async function processDailyReminder(reminderId, currentTime) {
    await withReminderLock(reminderId, async (client, row) => {
        const alreadySentToday = row.last_sent_at && currentDateKey(new Date(row.last_sent_at)) === currentDateKey(new Date());
        if (!row.is_active || row.repeat_daily_at !== currentTime || alreadySentToday || !runsOn(row.repeat_days, new Date())) {
            return;
        }
        try {
            await sendReminderMessage(row);
            await client.query('UPDATE bot_reminders SET last_sent_at = now() WHERE id = $1', [row.id]);
        } catch (err) {
            if (err instanceof botTargetService.TargetUnavailableError) {
                await deactivateUnavailableTarget(client, row, err);
                return;
            }
            throw err;
        }
    });
}

async function runWithConcurrency(items, limit, worker) {
    const queue = items.slice();
    const workerCount = Math.max(1, Math.min(limit, queue.length));
    const runners = new Array(workerCount).fill(null).map(async () => {
        while (queue.length > 0) {
            const item = queue.shift();
            await worker(item);
        }
    });
    await Promise.all(runners);
}

async function runDueReminders() {
    const dueOnce = await db.query(
        `SELECT id FROM bot_reminders
         WHERE is_active = true AND scheduled_at IS NOT NULL AND scheduled_at <= now()`
    );
    await runWithConcurrency(dueOnce.rows, REMINDER_CONCURRENCY, async ({ id }) => {
        try {
            await processOnceReminder(id);
        } catch (err) {
            console.error(`Bot reminder #${id} (once) failed:`, err.message);
        }
    });

    const currentTime = currentTimeLabel(new Date());
    const dueDaily = await db.query(
        `SELECT id FROM bot_reminders WHERE is_active = true AND repeat_daily_at = $1`,
        [currentTime]
    );
    await runWithConcurrency(dueDaily.rows, REMINDER_CONCURRENCY, async ({ id }) => {
        try {
            await processDailyReminder(id, currentTime);
        } catch (err) {
            console.error(`Bot reminder #${id} (daily) failed:`, err.message);
        }
    });
}

async function tick() {
    try {
        await runDailySummaryIfDue();
        await runDueReminders();
    } catch (err) {
        console.error('Bot service tick failed:', err.message);
    }
}

function start(io) {
    if (io) {
        bindIo(io);
    }
    cron.schedule('* * * * *', tick);
}

async function getSettings() {
    const enabled = await getSetting(SETTING_ENABLED, 'true');
    const time = await getSetting(SETTING_TIME, DEFAULT_SUMMARY_TIME);
    const conversationId = await getSetting(SETTING_CONVERSATION, '');
    return {
        dailySummaryEnabled: enabled === 'true',
        dailySummaryTime: time,
        targetConversationId: conversationId ? Number(conversationId) : null
    };
}

async function updateSettings({ dailySummaryEnabled, dailySummaryTime, targetConversationId }) {
    if (typeof dailySummaryEnabled === 'boolean') {
        await setSetting(SETTING_ENABLED, dailySummaryEnabled ? 'true' : 'false');
    }
    if (dailySummaryTime) {
        await setSetting(SETTING_TIME, dailySummaryTime);
    }
    if (targetConversationId !== undefined) {
        await setSetting(SETTING_CONVERSATION, targetConversationId ? String(targetConversationId) : '');
    }
    return getSettings();
}

function normalizeDays(days) {
    if (!Array.isArray(days) || days.length === 0 || days.length === 7) {
        return null;
    }
    return [...new Set(days.map(Number))].sort((a, b) => a - b);
}

function runsOn(days, date) {
    const normalized = normalizeDays(days);
    return !normalized || normalized.includes(format.weekdayIndex(date));
}

function repeatLabel(days) {
    const normalized = normalizeDays(days);
    if (!normalized) {
        return 'هر روز';
    }
    if (normalized.length === WORK_WEEK.length && normalized.every((day, index) => day === WORK_WEEK[index])) {
        return 'هر روز کاری';
    }
    const fromSaturday = [...normalized].sort((a, b) => ((a + 1) % 7) - ((b + 1) % 7));
    if (fromSaturday.length === 1) {
        return `${format.WEEKDAYS[fromSaturday[0]]}‌ها`;
    }
    return fromSaturday.map((day) => format.WEEKDAYS[day]).join('، ');
}

function scheduleLabel(reminder) {
    if (!reminder.repeat_daily_at && reminder.scheduled_at) {
        const at = new Date(reminder.scheduled_at);
        return `یک‌بار، ${format.monthDay(at)} ${format.clock(at)}`;
    }
    return `${repeatLabel(reminder.repeat_days)}، ${format.toPersianDigits(reminder.repeat_daily_at || '')}`;
}

async function createReminder({
    title,
    message,
    conversationId,
    targetType,
    targetId,
    scheduledAt,
    repeatDailyAt,
    repeatDays,
    createdBy,
    messageType,
    attachmentFileId
}) {
    const resolvedTargetType = targetType || 'conversation';
    const resolvedTargetId = targetId !== undefined && targetId !== null ? targetId : (conversationId || null);
    const legacyConversationId = resolvedTargetType === 'conversation' ? resolvedTargetId : null;
    const result = await db.query(
        `INSERT INTO bot_reminders
            (title, message, conversation_id, target_type, target_id, scheduled_at, repeat_daily_at,
             created_by, message_type, attachment_file_id, repeat_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
            title,
            message || '',
            legacyConversationId,
            resolvedTargetType,
            resolvedTargetId,
            scheduledAt || null,
            repeatDailyAt || null,
            createdBy,
            messageType || 'text',
            attachmentFileId || null,
            normalizeDays(repeatDays)
        ]
    );
    return result.rows[0];
}

async function listReminders() {
    const result = await db.query(
        `SELECT id, title, message, conversation_id, target_type, target_id, message_type,
                attachment_file_id, scheduled_at, repeat_daily_at, repeat_days, is_active, last_sent_at, created_by, created_at
         FROM bot_reminders ORDER BY created_at DESC`
    );
    return result.rows;
}

async function getReminderById(id) {
    const result = await db.query('SELECT * FROM bot_reminders WHERE id = $1', [id]);
    return result.rows[0] || null;
}

async function updateReminder(id, {
    title,
    message,
    targetType,
    targetId,
    scheduledAt,
    repeatDailyAt,
    repeatDays
}) {
    const resolvedTargetType = targetType || 'conversation';
    const resolvedTargetId = targetId !== undefined && targetId !== null ? targetId : null;
    const legacyConversationId = resolvedTargetType === 'conversation' ? resolvedTargetId : null;
    const result = await db.query(
        `UPDATE bot_reminders
         SET title = $1, message = $2, conversation_id = $3, target_type = $4, target_id = $5,
             scheduled_at = $6, repeat_daily_at = $7, repeat_days = $8
         WHERE id = $9 RETURNING *`,
        [
            title,
            message || '',
            legacyConversationId,
            resolvedTargetType,
            resolvedTargetId,
            scheduledAt || null,
            repeatDailyAt || null,
            normalizeDays(repeatDays),
            id
        ]
    );
    return result.rows[0] || null;
}

async function updateReminderAttachment(id, { attachmentFileId, messageType }) {
    const result = await db.query(
        `UPDATE bot_reminders SET attachment_file_id = $1, message_type = $2 WHERE id = $3 RETURNING *`,
        [attachmentFileId || null, messageType || 'text', id]
    );
    return result.rows[0] || null;
}

async function setReminderActive(id, isActive) {
    const result = await db.query(
        'UPDATE bot_reminders SET is_active = $1 WHERE id = $2 RETURNING *',
        [isActive, id]
    );
    return result.rows[0] || null;
}

async function deleteReminder(id) {
    const result = await db.query('DELETE FROM bot_reminders WHERE id = $1 RETURNING id', [id]);
    return result.rows.length > 0;
}

async function listReminderDeliveries(id, limit) {
    return botReminderDeliveryService.listDeliveries(id, limit);
}

module.exports = {
    BOT_PHONE,
    bindIo,
    start,
    tick,
    ensureBotUser,
    ensureBotChannelMembership,
    sendBotMessage,
    buildDailySummaryText,
    getSettings,
    updateSettings,
    createReminder,
    listReminders,
    getReminderById,
    updateReminder,
    updateReminderAttachment,
    setReminderActive,
    deleteReminder,
    listReminderDeliveries,
    scheduleLabel,
    runsOn
};
