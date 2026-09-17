require('dotenv').config();
const crypto = require('crypto');
const { pool } = require('../config/database');
const cryptoUtil = require('../utils/crypto.util');
const channelService = require('../services/channel.service');
const botService = require('../services/bot.service');

function resolvePassword(envVar) {
    if (process.env[envVar]) {
        return { password: process.env[envVar], generated: false };
    }
    return { password: crypto.randomBytes(9).toString('base64url'), generated: true };
}

const superAdmin1 = resolvePassword('SEED_SUPER_ADMIN_1_PASSWORD');
const superAdmin2 = resolvePassword('SEED_SUPER_ADMIN_2_PASSWORD');

const SEED_USERS = [
    { fullName: 'مدیریت', phone: '09120000012', role: 'management', password: null, mustChange: false },
    { fullName: 'ادمین کل - حساب ۱', phone: '09120000016', role: 'super_admin', password: superAdmin1.password, mustChange: true, generated: superAdmin1.generated },
    { fullName: 'ادمین کل - حساب ۲', phone: '09120000017', role: 'super_admin', password: superAdmin2.password, mustChange: true, generated: superAdmin2.generated }
];

async function seed() {
    for (const seedUser of SEED_USERS) {
        const existing = await pool.query('SELECT id FROM users WHERE phone = $1', [seedUser.phone]);
        if (existing.rows.length > 0) {
            continue;
        }
        const encrypted = seedUser.password ? cryptoUtil.encrypt(seedUser.password) : null;
        await pool.query(
            'INSERT INTO users (full_name, phone, role, password_encrypted, password_set_at, password_must_change, is_lock_enabled) VALUES ($1, $2, $3, $4, $5, $6, true)',
            [seedUser.fullName, seedUser.phone, seedUser.role, encrypted, encrypted ? new Date() : null, seedUser.mustChange]
        );
        if (seedUser.password && seedUser.generated) {
            console.log(`Generated one-time password for ${seedUser.phone}: ${seedUser.password}`);
        }
    }

    await pool.query(
        "INSERT INTO system_settings (key, value) VALUES ('max_file_size_bytes', '41943040') ON CONFLICT (key) DO NOTHING"
    );
    await pool.query(
        "INSERT INTO system_settings (key, value) VALUES ('message_cooldown_seconds', '3') ON CONFLICT (key) DO NOTHING"
    );
    await pool.query(
        `INSERT INTO system_settings (key, value) VALUES
            ('read_receipts_enabled', 'true'),
            ('file_scan_enabled', 'true')
         ON CONFLICT (key) DO NOTHING`
    );

    await channelService.ensureAllActiveUsersJoined();
    await botService.ensureBotChannelMembership();

    await pool.query(
        "INSERT INTO system_settings (key, value) VALUES ('bot_daily_summary_enabled', 'true') ON CONFLICT (key) DO NOTHING"
    );
    await pool.query(
        "INSERT INTO system_settings (key, value) VALUES ('bot_daily_summary_time', '08:30') ON CONFLICT (key) DO NOTHING"
    );
    await pool.query(
        `INSERT INTO system_settings (key, value) VALUES
            ('summary_min_new_messages', '10'),
            ('summary_max_age_minutes', '60'),
            ('summary_window_floor_messages', '50'),
            ('summary_followup_minutes', '30'),
            ('team_task_capacity', '8')
         ON CONFLICT (key) DO NOTHING`
    );

    await pool.end();
}

seed()
    .then(() => {
        console.log('Seed completed');
        process.exit(0);
    })
    .catch((err) => {
        console.error('Seed failed:', err.message);
        process.exit(1);
    });
