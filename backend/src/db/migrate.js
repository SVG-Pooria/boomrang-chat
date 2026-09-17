require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function migrate() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schema);
    await pool.end();
}

migrate()
    .then(() => {
        console.log('Migration completed');
        process.exit(0);
    })
    .catch((err) => {
        console.error('Migration failed:', err.message);
        process.exit(1);
    });
