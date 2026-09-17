require('dotenv').config();
const { pool } = require('../config/database');
const channelCoreService = require('../services/channelCore.service');
const groupCoreService = require('../services/groupCore.service');
const channelGroupLinkService = require('../services/channelGroupLink.service');
const channelMessageService = require('../services/channelMessage.service');

const SAMPLE_CHANNEL_TITLE = 'کانال نمونه توسعه';
const SAMPLE_GROUP_TITLE = 'گروه نمونه توسعه';

async function pickOwner() {
    const nonAdmin = await pool.query(
        `SELECT id FROM users WHERE role != 'super_admin' AND is_active = true ORDER BY id ASC LIMIT 1`
    );
    if (nonAdmin.rows.length > 0) {
        return nonAdmin.rows[0].id;
    }
    const anyUser = await pool.query('SELECT id FROM users WHERE is_active = true ORDER BY id ASC LIMIT 1');
    return anyUser.rows[0] ? anyUser.rows[0].id : null;
}

async function seedDev() {
    if (process.env.NODE_ENV === 'production') {
        console.log('NODE_ENV=production: refusing to insert development sample data.');
        await pool.end();
        return;
    }

    const existing = await pool.query('SELECT id FROM channels WHERE title = $1', [SAMPLE_CHANNEL_TITLE]);
    if (existing.rows.length > 0) {
        console.log('Sample channel already exists, nothing to do.');
        await pool.end();
        return;
    }

    const ownerId = await pickOwner();
    if (!ownerId) {
        console.log('No active user found to own the sample channel/group; run the main seed first.');
        await pool.end();
        return;
    }

    const channel = await channelCoreService.createChannel({
        title: SAMPLE_CHANNEL_TITLE,
        description: 'برای آزمایش فید کانال و پیوند خودکار به گروه در محیط توسعه.',
        visibility: 'public',
        ownerId
    });

    const group = await groupCoreService.createGroup({
        title: SAMPLE_GROUP_TITLE,
        description: 'گروه چت آزاد نمونه، پیوندشده به کانال نمونه توسعه.',
        visibility: 'public',
        ownerId
    });

    await channelGroupLinkService.linkChannelToGroup(channel.id, group.id, ownerId);

    await channelMessageService.createChannelMessage({
        channelId: channel.id,
        senderId: ownerId,
        body: 'این یک پست نمونه است؛ پس از راه‌اندازی صف فوروارد، نسخه‌ای از آن باید در گروه پیوندشده هم ظاهر شود.',
        type: 'text'
    });

    console.log(`Sample channel #${channel.id} and group #${group.id} created and linked.`);
    await pool.end();
}

seedDev()
    .then(() => {
        console.log('Dev seed completed');
        process.exit(0);
    })
    .catch((err) => {
        console.error('Dev seed failed:', err.message);
        process.exit(1);
    });
