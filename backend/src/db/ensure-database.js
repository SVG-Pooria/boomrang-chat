require('dotenv').config();
const { Client } = require('pg');

async function ensureDatabase() {
    const raw = process.env.DATABASE_URL;
    if (!raw) {
        console.error('DATABASE_URL is not set in backend\\.env');
        process.exit(1);
    }

    let target;
    try {
        target = new URL(raw);
    } catch (e) {
        console.error('DATABASE_URL is not a valid URL:', e.message);
        process.exit(1);
    }

    const dbName = decodeURIComponent(target.pathname.replace(/^\//, ''));
    if (!dbName) {
        console.error('DATABASE_URL has no database name at the end (e.g. .../boomrang)');
        process.exit(1);
    }

    const adminUrl = new URL(target.toString());
    adminUrl.pathname = '/postgres';

    const client = new Client({ connectionString: adminUrl.toString() });

    try {
        await client.connect();
    } catch (e) {
        console.error('Could not connect to PostgreSQL server:', e.message);
        console.error('Check that PostgreSQL is running and that the host/port/user/password in DATABASE_URL are correct.');
        process.exit(1);
    }

    try {
        const { rows } = await client.query(
            'SELECT 1 FROM pg_database WHERE datname = $1',
            [dbName]
        );

        if (rows.length > 0) {
            console.log(`Database "${dbName}" already exists.`);
        } else {
            console.log(`Database "${dbName}" does not exist yet - creating it...`);

            const safeName = dbName.replace(/"/g, '""');
            await client.query(`CREATE DATABASE "${safeName}"`);
            console.log(`Database "${dbName}" created.`);
        }
    } catch (e) {
        console.error('Failed to check/create database:', e.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

ensureDatabase().catch((e) => {
    console.error('Unexpected error in ensure-database.js:', e.message);
    process.exit(1);
});
