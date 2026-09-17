const db = require('../config/database');
const cryptoUtil = require('../utils/crypto.util');

async function setInitialPassword(userId, plainPassword) {
    const encrypted = cryptoUtil.encrypt(plainPassword);
    await db.query(
        'UPDATE users SET password_encrypted = $1, password_set_at = now(), password_must_change = false WHERE id = $2',
        [encrypted, userId]
    );
}

async function verifyPassword(userId, plainPassword) {
    const result = await db.query('SELECT password_encrypted FROM users WHERE id = $1', [userId]);
    const row = result.rows[0];
    if (!row || !row.password_encrypted) {
        return false;
    }
    let decrypted;
    try {
        decrypted = cryptoUtil.decrypt(row.password_encrypted);
    } catch (err) {

        console.error(
            `[password.service] Could not decrypt stored password for user ${userId} - ` +
            'most likely PASSWORD_ENCRYPTION_KEY in backend/.env changed since this password was last set. ' +
            `Fix: super_admin -> Users -> reset this user's password (this re-encrypts it with the current key). ` +
            `Underlying error: ${err.message}`
        );
        return false;
    }
    return decrypted === plainPassword;
}

async function changePassword(userId, currentPassword, newPassword) {
    const isValid = await verifyPassword(userId, currentPassword);
    if (!isValid) {
        throw new Error('CURRENT_PASSWORD_INVALID');
    }
    await setInitialPassword(userId, newPassword);
}

async function adminViewPassword(adminId, targetUserId) {
    const result = await db.query('SELECT password_encrypted FROM users WHERE id = $1', [targetUserId]);
    const row = result.rows[0];
    if (!row || !row.password_encrypted) {
        return null;
    }
    let plainPassword;
    try {
        plainPassword = cryptoUtil.decrypt(row.password_encrypted);
    } catch (err) {

        console.error(
            `[password.service] super_admin ${adminId} tried to view the password of user ${targetUserId}, ` +
            `but it could not be decrypted with the current PASSWORD_ENCRYPTION_KEY. Underlying error: ${err.message}`
        );
        throw new Error('PASSWORD_UNDECRYPTABLE');
    }
    await db.query(
        'INSERT INTO password_view_log (viewed_by, target_user_id, action) VALUES ($1, $2, $3)',
        [adminId, targetUserId, 'view']
    );
    return plainPassword;
}

async function adminResetPassword(adminId, targetUserId, newPassword) {
    const encrypted = cryptoUtil.encrypt(newPassword);
    await db.query(
        'UPDATE users SET password_encrypted = $1, password_set_at = now(), password_must_change = false WHERE id = $2',
        [encrypted, targetUserId]
    );
    await db.query(
        'INSERT INTO password_view_log (viewed_by, target_user_id, action) VALUES ($1, $2, $3)',
        [adminId, targetUserId, 'reset']
    );
}

module.exports = {
    setInitialPassword,
    verifyPassword,
    changePassword,
    adminViewPassword,
    adminResetPassword
};
