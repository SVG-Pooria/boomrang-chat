const db = require('../config/database');

const NAME_MAX = 60;
const DESCRIPTION_MAX = 255;

function serialize(row) {
    return {
        typeId: row.id,
        name: row.name,
        description: row.description || null,
        needsAmount: row.needs_amount,
        needsPeriod: row.needs_period,
        isActive: row.is_active,
        usageCount: row.usage_count === undefined ? undefined : row.usage_count
    };
}

async function listTypes({ includeInactive = false } = {}) {
    const result = await db.query(
        `SELECT t.*, (SELECT count(*)::int FROM approval_requests r WHERE r.type = t.name) AS usage_count
         FROM approval_request_types t
         ${includeInactive ? '' : 'WHERE t.is_active = true'}
         ORDER BY t.is_active DESC, t.name`
    );
    return result.rows.map(serialize);
}

async function exists(name) {
    if (typeof name !== 'string' || !name.trim()) {
        return false;
    }
    const result = await db.query(
        'SELECT 1 FROM approval_request_types WHERE name = $1 AND is_active = true',
        [name.trim()]
    );
    return result.rows.length > 0;
}

async function getByName(name) {
    const result = await db.query('SELECT * FROM approval_request_types WHERE name = $1', [name]);
    return result.rows[0] ? serialize(result.rows[0]) : null;
}

async function createType(input, actorId) {
    const name = String(input.name || '').trim().slice(0, NAME_MAX);
    if (!name) {
        return { error: 'INVALID_NAME' };
    }
    const duplicate = await db.query('SELECT 1 FROM approval_request_types WHERE name = $1', [name]);
    if (duplicate.rows[0]) {
        return { error: 'TYPE_EXISTS' };
    }
    const result = await db.query(
        `INSERT INTO approval_request_types (name, description, needs_amount, needs_period, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
            name,
            String(input.description || '').trim().slice(0, DESCRIPTION_MAX) || null,
            Boolean(input.needsAmount),
            Boolean(input.needsPeriod),
            actorId
        ]
    );
    return { type: serialize(result.rows[0]) };
}

async function updateType(typeId, patch) {
    const result = await db.query(
        `UPDATE approval_request_types
         SET description = CASE WHEN $2::boolean THEN $3::varchar ELSE description END,
             needs_amount = COALESCE($4::boolean, needs_amount),
             needs_period = COALESCE($5::boolean, needs_period),
             is_active = COALESCE($6::boolean, is_active)
         WHERE id = $1
         RETURNING *`,
        [
            typeId,
            patch.description !== undefined,
            patch.description === undefined
                ? null
                : String(patch.description).trim().slice(0, DESCRIPTION_MAX) || null,
            patch.needsAmount === undefined ? null : Boolean(patch.needsAmount),
            patch.needsPeriod === undefined ? null : Boolean(patch.needsPeriod),
            patch.isActive === undefined ? null : Boolean(patch.isActive)
        ]
    );
    if (!result.rows[0]) {
        return { error: 'NOT_FOUND' };
    }
    return { type: serialize(result.rows[0]) };
}

async function deleteType(typeId) {
    const used = await db.query(
        `SELECT count(*)::int AS count FROM approval_requests r
         JOIN approval_request_types t ON t.name = r.type
         WHERE t.id = $1`,
        [typeId]
    );
    if (used.rows[0].count > 0) {
        return updateType(typeId, { isActive: false });
    }
    const result = await db.query('DELETE FROM approval_request_types WHERE id = $1 RETURNING id', [
        typeId
    ]);
    if (!result.rows[0]) {
        return { error: 'NOT_FOUND' };
    }
    return { deleted: true };
}

module.exports = {
    listTypes,
    exists,
    getByName,
    createType,
    updateType,
    deleteType
};
