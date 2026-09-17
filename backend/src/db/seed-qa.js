require('dotenv').config();
const { pool } = require('../config/database');
const cryptoUtil = require('../utils/crypto.util');
const conversationService = require('../services/conversation.service');
const messageService = require('../services/message.service');
const channelCoreService = require('../services/channelCore.service');
const channelMessageService = require('../services/channelMessage.service');
const groupCoreService = require('../services/groupCore.service');
const groupMessageService = require('../services/groupMessage.service');

const DEFAULT_PASSWORD = process.env.SEED_QA_PASSWORD || 'Boomrang!2024';

const QA_USERS = [
    { fullName: 'کاربر آزمایشی — کارمند', phone: '09120000001', role: 'employee' },
    { fullName: 'کاربر آزمایشی — مدیریت', phone: '09120000002', role: 'management' },
    { fullName: 'کاربر آزمایشی — ادمین کل', phone: '09120000003', role: 'super_admin' },
    { fullName: 'کاربر آزمایشی — همکار', phone: '09120000004', role: 'employee' },
    { fullName: 'کاربر آزمایشی — تحلیلگر', phone: '09120000005', role: 'employee' },
    { fullName: 'کاربر آزمایشی — پشتیبانی', phone: '09120000006', role: 'employee' },
    { fullName: 'کاربر آزمایشی — مدیر', phone: '09120000007', role: 'manager' }
];

const TEAM_OF_MANAGER = { manager: '09120000007', members: ['09120000005', '09120000006'] };

const CHANNEL_TITLE = 'لانچ-محصول';
const GROUP_TITLE = 'تیم دیزاین';

async function upsertUser(qaUser, encrypted) {
    const existing = await pool.query('SELECT id FROM users WHERE phone = $1', [qaUser.phone]);
    if (existing.rows.length > 0) {
        await pool.query(
            `UPDATE users
             SET full_name = $1, role = $2, is_active = true, password_encrypted = $3,
                 password_set_at = now(), password_must_change = false
             WHERE phone = $4`,
            [qaUser.fullName, qaUser.role, encrypted, qaUser.phone]
        );
        return existing.rows[0].id;
    }
    const inserted = await pool.query(
        `INSERT INTO users (full_name, phone, role, password_encrypted, password_set_at, password_must_change)
         VALUES ($1, $2, $3, $4, now(), false)
         RETURNING id`,
        [qaUser.fullName, qaUser.phone, qaUser.role, encrypted]
    );
    return inserted.rows[0].id;
}

async function seedDirectHistory(firstId, secondId) {
    const conversation = await conversationService.getOrCreateDirect(firstId, secondId, firstId);
    const existing = await pool.query(
        'SELECT count(*)::int AS count FROM messages WHERE conversation_id = $1',
        [conversation.id]
    );
    if (existing.rows[0].count > 0) {
        return conversation;
    }
    await messageService.createMessage({
        conversationId: conversation.id,
        senderId: secondId,
        body: 'رندرهای ۴کی برای بیلبورد رو آپلود کردم. تب رسانه رو چک کن.',
        type: 'text'
    });
    await messageService.createMessage({
        conversationId: conversation.id,
        senderId: firstId,
        body: 'الان چک می‌کنم. این‌ها خروجی نهایی برای وب هم هستن یا فقط چاپ؟',
        type: 'text'
    });
    return conversation;
}

async function seedChannelHistory(ownerId, memberIds) {
    const existing = await pool.query('SELECT id FROM channels WHERE title = $1', [CHANNEL_TITLE]);
    if (existing.rows.length > 0) {
        return existing.rows[0];
    }
    const channel = await channelCoreService.createChannel({
        title: CHANNEL_TITLE,
        description: 'نقاط عطف فصل سوم',
        visibility: 'public',
        ownerId
    });
    for (const memberId of memberIds) {
        await channelCoreService.addChannelMember(channel.id, memberId, 'member');
    }
    await channelMessageService.createChannelMessage({
        channelId: channel.id,
        senderId: ownerId,
        body: 'زمان‌بندی لانچ نهایی شد؛ جزئیات را در همین کانال دنبال کنید.',
        type: 'text'
    });
    return channel;
}

async function seedGroupHistory(ownerId, memberIds) {
    const existing = await pool.query('SELECT id FROM groups WHERE title = $1', [GROUP_TITLE]);
    if (existing.rows.length > 0) {
        return existing.rows[0];
    }
    const group = await groupCoreService.createGroup({
        title: GROUP_TITLE,
        description: 'هماهنگی روزانه تیم دیزاین',
        visibility: 'public',
        ownerId
    });
    for (const memberId of memberIds) {
        await groupCoreService.addGroupMember(group.id, memberId, 'member');
    }
    await groupMessageService.createGroupMessage({
        groupId: group.id,
        senderId: ownerId,
        body: 'نسخهٔ جدید پکیج آیکون‌ها آماده است.',
        type: 'text'
    });
    return group;
}

async function seedQa() {
    if (process.env.NODE_ENV === 'production') {
        console.log('NODE_ENV=production: refusing to insert QA accounts.');
        await pool.end();
        return;
    }

    const encrypted = cryptoUtil.encrypt(DEFAULT_PASSWORD);
    const ids = {};

    for (const qaUser of QA_USERS) {
        ids[qaUser.phone] = await upsertUser(qaUser, encrypted);
        console.log(`${qaUser.role.padEnd(11)} ${qaUser.phone}`);
    }

    await pool.query('UPDATE users SET manager_id = $1 WHERE id = ANY($2::int[])', [
        ids[TEAM_OF_MANAGER.manager],
        TEAM_OF_MANAGER.members.map((phone) => ids[phone])
    ]);

    const employeeOne = ids['09120000001'];
    const employeeTwo = ids['09120000004'];

    const conversation = await seedDirectHistory(employeeOne, employeeTwo);
    const channel = await seedChannelHistory(employeeOne, [employeeTwo]);
    const group = await seedGroupHistory(employeeOne, [employeeTwo]);

    console.log(`direct conversation #${conversation.id}, channel #${channel.id}, group #${group.id}`);
    console.log(`Password for all QA accounts: ${DEFAULT_PASSWORD}`);
    await pool.end();
}

seedQa()
    .then(() => {
        console.log('QA seed completed');
        process.exit(0);
    })
    .catch((err) => {
        console.error('QA seed failed:', err.message);
        process.exit(1);
    });
