function parseOrigins(raw) {
    return String(raw || '')
        .split(',')
        .map((origin) => origin.trim().replace(/\/+$/, ''))
        .filter(Boolean);
}

const ALLOWED_ORIGINS = parseOrigins(process.env.CORS_ORIGINS);

function corsOrigin() {
    return ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : false;
}

module.exports = { ALLOWED_ORIGINS, corsOrigin, parseOrigins };
