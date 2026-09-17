const db = require('../config/database');

async function listTags() {
    const result = await db.query('SELECT * FROM tags ORDER BY name');
    return result.rows;
}

async function createTag(name) {
    const result = await db.query(
        'INSERT INTO tags (name) VALUES ($1) RETURNING *',
        [name]
    );
    return result.rows[0];
}

module.exports = { listTags, createTag };
