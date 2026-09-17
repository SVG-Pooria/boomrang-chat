const db = require('../config/database');

const POLICY_FLAGS = {
    readReceiptsEnabled: { key: 'read_receipts_enabled', fallback: true, label: 'نمایش تیک خوانده‌شدن' },
    fileScanEnabled: { key: 'file_scan_enabled', fallback: true, label: 'اسکن فایل‌های ارسالی' }
};

const FLAG_NAMES = Object.keys(POLICY_FLAGS);

const LANGUAGE_KEY = 'system_language';
const LANGUAGES = ['fa', 'en'];
const DEFAULT_LANGUAGE = 'fa';
const LANGUAGE_CACHE_MS = 5000;

let cachedLanguage = null;
let cachedAt = 0;

function parseFlag(raw, fallback) {
    if (raw === 'true') {
        return true;
    }
    if (raw === 'false') {
        return false;
    }
    return fallback;
}

async function getFlags() {
    const keys = FLAG_NAMES.map((name) => POLICY_FLAGS[name].key);
    const result = await db.query('SELECT key, value FROM system_settings WHERE key = ANY($1::varchar[])', [keys]);
    const stored = new Map(result.rows.map((row) => [row.key, row.value]));
    return Object.fromEntries(
        FLAG_NAMES.map((name) => [name, parseFlag(stored.get(POLICY_FLAGS[name].key), POLICY_FLAGS[name].fallback)])
    );
}

async function getFlag(name) {
    const definition = POLICY_FLAGS[name];
    const result = await db.query('SELECT value FROM system_settings WHERE key = $1', [definition.key]);
    return parseFlag(result.rows[0] ? result.rows[0].value : undefined, definition.fallback);
}

async function setFlag(name, value) {
    await db.query(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [POLICY_FLAGS[name].key, value ? 'true' : 'false']
    );
}

async function getLanguage() {
    if (cachedLanguage && Date.now() - cachedAt < LANGUAGE_CACHE_MS) {
        return cachedLanguage;
    }
    const result = await db.query('SELECT value FROM system_settings WHERE key = $1', [LANGUAGE_KEY]);
    const stored = result.rows[0] ? result.rows[0].value : null;
    cachedLanguage = LANGUAGES.includes(stored) ? stored : DEFAULT_LANGUAGE;
    cachedAt = Date.now();
    return cachedLanguage;
}

function cachedLanguageOrDefault() {
    return cachedLanguage || DEFAULT_LANGUAGE;
}

async function setLanguage(language) {
    await db.query(
        `INSERT INTO system_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [LANGUAGE_KEY, language]
    );
    cachedLanguage = language;
    cachedAt = Date.now();
    return language;
}

async function applyReadReceiptPolicy(messages) {
    if (await getFlag('readReceiptsEnabled')) {
        return messages;
    }
    return messages.map((message) => ({ ...message, seen_by_count: null, audience_count: null }));
}

module.exports = {
    POLICY_FLAGS,
    FLAG_NAMES,
    LANGUAGES,
    DEFAULT_LANGUAGE,
    getFlags,
    getFlag,
    setFlag,
    getLanguage,
    setLanguage,
    cachedLanguageOrDefault,
    applyReadReceiptPolicy
};
