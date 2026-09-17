const db = require('../config/database');

async function recordDelivery({ reminderId, targetType, targetId, messageIdRef }) {
    const result = await db.query(
        `INSERT INTO bot_reminder_deliveries (reminder_id, target_type, target_id, message_id_ref)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [reminderId, targetType, targetId, messageIdRef || null]
    );
    require('../socket/notifier').notifyAdmins('admin:reminders', { reminderId });
    return result.rows[0];
}

async function listDeliveries(reminderId, limit) {
    const result = await db.query(
        `SELECT * FROM bot_reminder_deliveries
         WHERE reminder_id = $1
         ORDER BY delivered_at DESC
         LIMIT $2`,
        [reminderId, limit || 100]
    );
    return result.rows;
}

module.exports = { recordDelivery, listDeliveries };
