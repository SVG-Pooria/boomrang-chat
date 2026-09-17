require('dotenv').config();
const crypto = require('crypto');
const { pool } = require('../config/database');
const cryptoUtil = require('../utils/crypto.util');

const SUPER_ADMINS = [
    { phone: '09120000016', envKey: 'SEED_SUPER_ADMIN_1_PASSWORD' },
    { phone: '09120000017', envKey: 'SEED_SUPER_ADMIN_2_PASSWORD' }
];

const MIN_LENGTH = 8;

function generatePassword() {
    return `Bmr-${crypto.randomBytes(9).toString('base64url')}`;
}

function resolvePassword(envKey) {
    const configured = (process.env[envKey] || '').trim();
    if (!configured) {
        return { password: generatePassword(), generated: true };
    }
    if (configured.length < MIN_LENGTH) {
        return { error: `${envKey} is shorter than ${MIN_LENGTH} characters` };
    }
    return { password: configured, generated: false };
}

async function run() {
    for (const admin of SUPER_ADMINS) {
        const resolved = resolvePassword(admin.envKey);
        if (resolved.error) {
            console.error(`Skipped ${admin.phone}: ${resolved.error}`);
            continue;
        }

        const { rows } = await pool.query(
            'SELECT id, full_name FROM users WHERE phone = $1 AND role = $2',
            [admin.phone, 'super_admin']
        );

        if (rows.length === 0) {
            console.log(`No super_admin user found with phone ${admin.phone} - skipping.`);
            continue;
        }

        await pool.query(
            'UPDATE users SET password_encrypted = $1, password_set_at = NOW(), password_must_change = $2 WHERE id = $3',
            [cryptoUtil.encrypt(resolved.password), resolved.generated, rows[0].id]
        );

        if (resolved.generated) {
            console.log(`Password for ${rows[0].full_name} (${admin.phone}): ${resolved.password}`);
            console.log('  ^ one-time password, it must be changed at first sign-in.');
        } else {
            console.log(`Password updated for ${rows[0].full_name} (${admin.phone}) from ${admin.envKey}.`);
        }
    }

    await pool.end();
}

run()
    .then(() => {
        console.log('Done.');
        process.exit(0);
    })
    .catch((err) => {
        console.error('Failed to update passwords:', err.message);
        process.exit(1);
    });
