require('dotenv').config();
const { pool } = require('../config/database');
const approvalService = require('../services/approval.service');
const taskService = require('../services/task.service');
const meetingService = require('../services/meeting.service');
const announcementService = require('../services/announcement.service');
const complianceService = require('../services/compliance.service');
const channelCoreService = require('../services/channelCore.service');
const channelMessageService = require('../services/channelMessage.service');
const format = require('../utils/persianFormat.util');

const PROFILES = {
    '09120000001': { unit: 'محصول', jobTitle: 'کارشناس محصول', extension: '214' },
    '09120000002': { unit: 'هیئت مدیره', jobTitle: 'مدیر واحد', extension: '100' },
    '09120000004': { unit: 'محصول', jobTitle: 'سرپرست دیزاین', extension: '227' },
    '09120000005': { unit: 'محصول', jobTitle: 'تحلیلگر داده', extension: '231' },
    '09120000006': { unit: 'پشتیبانی', jobTitle: 'کارشناس پشتیبانی', extension: '245' }
};

const MANAGED_BY_MANAGEMENT = ['09120000001', '09120000005', '09120000006'];

const TASK_TAGS = {
    'آماده‌سازی خروجی ۴کی بیلبورد برای چاپخانه': 'رسانه',
    'بازبینی متن‌های فارسی صفحه فرود': 'محتوا',
    'تنظیم سطح دسترسی کانال مالی': 'امنیت'
};

const DAY = 24 * 60 * 60 * 1000;

async function userIdByPhone(phone) {
    const result = await pool.query('SELECT id FROM users WHERE phone = $1', [phone]);
    return result.rows[0] ? result.rows[0].id : null;
}

async function applyProfiles(ids) {
    for (const [phone, profile] of Object.entries(PROFILES)) {
        const id = ids[phone];
        if (!id) {
            continue;
        }
        await pool.query(
            'UPDATE users SET unit = $1, job_title = $2, phone_extension = $3 WHERE id = $4',
            [profile.unit, profile.jobTitle, profile.extension, id]
        );
    }
    for (const phone of MANAGED_BY_MANAGEMENT) {
        if (ids[phone] && ids['09120000002']) {
            await pool.query('UPDATE users SET manager_id = $1 WHERE id = $2', [ids['09120000002'], ids[phone]]);
        }
    }
    if (ids['09120000004'] && ids['09120000001']) {
        await pool.query('UPDATE users SET manager_id = $1 WHERE id = $2', [
            ids['09120000001'],
            ids['09120000004']
        ]);
    }
}

async function seedApprovals(ids, channelId) {
    const existing = await pool.query('SELECT count(*)::int AS count FROM approval_requests');
    if (existing.rows[0].count > 0) {
        return;
    }
    await approvalService.createRequest({
        title: 'درخواست خرید ۱۲ لایسنس نرم‌افزار طراحی',
        requesterId: ids['09120000004'],
        type: 'خرید',
        priority: 'بالا',
        amountRials: 48000000,
        deadlineAt: new Date(Date.now() + 2 * DAY),
        sourceTargetType: 'channel',
        sourceTargetId: channelId
    });
    await approvalService.createRequest({
        title: 'مرخصی استحقاقی ۳ روزه',
        requesterId: ids['09120000001'],
        type: 'مرخصی',
        priority: 'فوری',
        periodStart: new Date(Date.now() + 6 * DAY),
        periodEnd: new Date(Date.now() + 8 * DAY),
        deadlineAt: new Date()
    });
}

async function seedTasks(ids, channelId) {
    const existing = await pool.query('SELECT count(*)::int AS count FROM tasks');
    if (existing.rows[0].count > 0) {
        return;
    }
    await taskService.createTask({
        title: 'آماده‌سازی خروجی ۴کی بیلبورد برای چاپخانه',
        ownerId: ids['09120000004'],
        dueAt: new Date(Date.now() + DAY),
        status: 'در حال انجام',
        priority: 'بالا',
        sourceDescription: 'از پیام همکار در #لانچ-محصول',
        progress: 65,
        sourceTargetType: 'channel',
        sourceTargetId: channelId,
        createdBy: ids['09120000001']
    });
    await taskService.createTask({
        title: 'بازبینی متن‌های فارسی صفحه فرود',
        ownerId: ids['09120000001'],
        dueAt: new Date(Date.now() + 4 * DAY),
        status: 'بررسی',
        priority: 'عادی',
        sourceDescription: 'از صورتجلسه هماهنگی محصول',
        progress: 90,
        createdBy: ids['09120000001']
    });
    await taskService.createTask({
        title: 'تنظیم سطح دسترسی کانال مالی',
        ownerId: ids['09120000002'],
        dueAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
        status: 'در انتظار',
        priority: 'فوری',
        sourceDescription: 'از کارتابل امنیت',
        progress: 10,
        createdBy: ids['09120000002']
    });
}

async function seedManagerTeam(ids, channelId) {
    for (const [title, tag] of Object.entries(TASK_TAGS)) {
        await pool.query('UPDATE tasks SET tag = $1 WHERE title = $2 AND tag IS NULL', [tag, title]);
    }
    const analyst = ids['09120000005'];
    const support = ids['09120000006'];
    const manager = ids['09120000002'];
    if (!analyst || !support || !manager) {
        return;
    }
    const marker = await pool.query('SELECT 1 FROM tasks WHERE owner_id = $1 LIMIT 1', [analyst]);
    if (marker.rows.length > 0) {
        return;
    }

    await taskService.createTask({
        title: 'تدوین سند فرایند کارتابل',
        ownerId: analyst,
        dueAt: new Date(Date.now() + 3 * DAY),
        status: 'در حال انجام',
        priority: 'عادی',
        progress: 40,
        tag: 'فرایند',
        createdBy: manager
    });
    await taskService.createTask({
        title: 'چک‌لیست امنیتی انتشار نسخه ۲.۴',
        ownerId: analyst,
        dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: 'بررسی',
        priority: 'بالا',
        progress: 85,
        tag: 'امنیت',
        createdBy: manager
    });
    await taskService.createTask({
        title: 'پاسخ به تیکت‌های معوق مشتریان',
        ownerId: support,
        dueAt: new Date(Date.now() - DAY),
        status: 'در انتظار',
        priority: 'فوری',
        tag: 'پشتیبانی',
        createdBy: manager
    });
    const closed = await taskService.createTask({
        title: 'جمع‌بندی بازخورد مشتریان کلیدی',
        ownerId: support,
        dueAt: new Date(Date.now() - DAY),
        status: 'انجام شد',
        priority: 'عادی',
        progress: 100,
        tag: 'پشتیبانی',
        createdBy: manager
    });
    await pool.query('UPDATE tasks SET completed_at = $1 WHERE id = $2', [
        new Date(Date.now() - 2 * DAY),
        closed.taskId
    ]);

    await pool.query(
        `INSERT INTO leave_periods (user_id, start_date, end_date, set_by)
         VALUES ($1, $2::date, $3::date, $4)`,
        [support, format.dayKey(new Date()), format.dayKey(new Date(Date.now() + 2 * DAY)), manager]
    );

    await approvalService.createRequest({
        title: 'مرخصی ساعتی برای مراجعه به پزشک',
        requesterId: analyst,
        type: 'مرخصی ساعتی',
        priority: 'عادی',
        periodStart: new Date(Date.now() + DAY),
        periodEnd: new Date(Date.now() + DAY)
    });
    await approvalService.createRequest({
        title: 'خرید هارد اکسترنال برای آرشیو پشتیبانی',
        requesterId: support,
        type: 'خرید',
        priority: 'فوری',
        amountRials: 12000000,
        deadlineAt: new Date(Date.now() + DAY)
    });

    if (channelId) {
        for (const memberId of [analyst, support, manager]) {
            const existing = await pool.query(
                'SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2',
                [channelId, memberId]
            );
            if (existing.rows.length === 0) {
                await channelCoreService.addChannelMember(channelId, memberId, 'member');
            }
        }
        await channelMessageService.createChannelMessage({
            channelId,
            senderId: analyst,
            body: 'داشبورد گزارش فصلی به‌روز شد.',
            type: 'text'
        });
    }
}

async function seedMeetings(ids, channelId) {
    const existing = await pool.query('SELECT count(*)::int AS count FROM meetings');
    if (existing.rows[0].count > 0) {
        return;
    }
    const attendees = Object.values(ids).filter(Boolean);
    const today = new Date();
    today.setHours(15, 0, 0, 0);
    await meetingService.createMeeting({
        title: 'جلسه هماهنگی لانچ محصول',
        startsAt: today,
        endsAt: new Date(today.getTime() + 45 * 60 * 1000),
        attendeeIds: attendees,
        sourceTargetType: 'channel',
        sourceTargetId: channelId,
        createdBy: ids['09120000001']
    });

    const past = new Date(Date.now() - 3 * DAY);
    past.setHours(9, 0, 0, 0);
    const held = await meetingService.createMeeting({
        title: 'کمیته امنیت اطلاعات',
        startsAt: past,
        endsAt: new Date(past.getTime() + 75 * 60 * 1000),
        attendeeIds: [ids['09120000002'], ids['09120000004']].filter(Boolean),
        createdBy: ids['09120000002']
    });
    await pool.query(
        'UPDATE meetings SET minutes = $1::jsonb, decisions_count = $2, actions_count = $3 WHERE id = $4',
        [
            JSON.stringify([
                'تصویب رمزنگاری سرتاسری برای کانال‌های طبقه‌بندی‌شده',
                'نگهداشت ۳ ساله آرشیو گفتگوها روی سرور داخلی',
                'الزام ورود دومرحله‌ای برای مدیران'
            ]),
            3,
            6,
            held.meetingId
        ]
    );
}

async function seedAnnouncements(ids) {
    const existing = await pool.query('SELECT count(*)::int AS count FROM announcements');
    if (existing.rows[0].count > 0) {
        return;
    }
    await announcementService.createAnnouncement({
        title: 'قطعی برنامه‌ریزی‌شده سرویس‌های داخلی',
        body: 'پنجشنبه از ساعت ۲۲:۰۰ تا ۲۳:۳۰ سرویس‌های داخلی به‌دلیل ارتقای سرور در دسترس نخواهند بود.',
        authorId: ids['09120000002'],
        authorDisplay: 'مدیریت — زیرساخت',
        tone: 'هشدار',
        mustAck: true
    });
    await announcementService.createAnnouncement({
        title: 'ابلاغ سیاست جدید طبقه‌بندی اطلاعات',
        body: 'از ابتدای مهر، همه گفتگوهای مالی و حقوقی باید در کانال‌های «محرمانه» انجام شوند.',
        authorId: ids['09120000002'],
        authorDisplay: 'مدیریت — هیئت مدیره',
        tone: 'رسمی',
        mustAck: true
    });
}

async function seedWorkspace() {
    if (process.env.NODE_ENV === 'production') {
        console.log('NODE_ENV=production: refusing to insert workspace sample data.');
        await pool.end();
        return;
    }

    const ids = {};
    for (const phone of Object.keys(PROFILES)) {
        ids[phone] = await userIdByPhone(phone);
    }
    if (!ids['09120000001']) {
        console.log('QA users are missing; run `npm run seed:qa` first.');
        await pool.end();
        return;
    }

    const channel = await pool.query('SELECT id FROM channels ORDER BY id ASC LIMIT 1');
    const channelId = channel.rows[0] ? channel.rows[0].id : null;

    await applyProfiles(ids);
    await seedApprovals(ids, channelId);
    await seedTasks(ids, channelId);
    await seedMeetings(ids, channelId);
    await seedManagerTeam(ids, channelId);
    await seedAnnouncements(ids);
    await complianceService.record(
        ids['09120000002'],
        'channel.member.added',
        'افزودن همکار به کانال لانچ محصول',
        { channelId }
    );

    console.log('workspace fixtures ready');
    await pool.end();
}

seedWorkspace()
    .then(() => {
        console.log('Workspace seed completed');
        process.exit(0);
    })
    .catch((err) => {
        console.error('Workspace seed failed:', err.message);
        process.exit(1);
    });
