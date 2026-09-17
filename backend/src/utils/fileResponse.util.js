const INLINE_PREFIXES = ['image/', 'video/', 'audio/'];

function applySafeFileHeaders(res, mimeType) {
    const inline = INLINE_PREFIXES.some((prefix) => String(mimeType || '').startsWith(prefix));
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
    res.set('Content-Disposition', inline ? 'inline' : 'attachment');
}

module.exports = { applySafeFileHeaders };
