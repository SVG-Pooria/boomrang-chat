const CATEGORIES = ['media', 'files', 'music', 'gifs', 'links'];

const IMAGE_PREFIX = 'image/';
const VIDEO_PREFIX = 'video/';
const AUDIO_PREFIX = 'audio/';
const GIF_MIME = 'image/gif';
const URL_REGEX = '(https?://|www\\.)\\S+';

function isValidCategory(value) {
    return CATEGORIES.includes(value);
}

function resolveMessageType(mimeType) {
    const mime = mimeType || '';
    if (mime.startsWith(IMAGE_PREFIX)) {
        return 'image';
    }
    if (mime.startsWith(VIDEO_PREFIX)) {
        return 'video';
    }
    return 'file';
}

function requiresFileJoin(category) {
    return category !== 'links';
}

function buildCategoryCondition(category, messageAlias, fileAlias) {
    const m = messageAlias;
    const f = fileAlias;

    if (category === 'media') {
        return `${f}.mode = 'compressed' AND ${f}.mime_type IS NOT NULL AND ${f}.mime_type <> '${GIF_MIME}' AND (${f}.mime_type LIKE '${IMAGE_PREFIX}%' OR ${f}.mime_type LIKE '${VIDEO_PREFIX}%')`;
    }
    if (category === 'files') {
        return `${f}.mode = 'file' AND (${f}.mime_type IS NULL OR ${f}.mime_type NOT LIKE '${AUDIO_PREFIX}%')`;
    }
    if (category === 'music') {
        return `${f}.mode = 'file' AND ${f}.mime_type LIKE '${AUDIO_PREFIX}%'`;
    }
    if (category === 'gifs') {
        return `${f}.mode = 'compressed' AND ${f}.mime_type = '${GIF_MIME}'`;
    }
    if (category === 'links') {
        return `${m}.type = 'text' AND ${m}.body ~* '${URL_REGEX}'`;
    }
    return null;
}

function serializeAttachmentRow(row) {
    return {
        id: row.id,
        type: row.type,
        body: row.body,
        senderId: row.sender_id,
        senderName: row.sender_name,
        createdAt: row.created_at,
        file: row.file_row_id
            ? {
                id: row.file_row_id,
                mode: row.file_mode,
                mimeType: row.file_mime_type,
                sizeBytes: row.file_size_bytes,
                originalName: row.file_original_name
            }
            : null
    };
}

module.exports = {
    CATEGORIES,
    isValidCategory,
    resolveMessageType,
    requiresFileJoin,
    buildCategoryCondition,
    serializeAttachmentRow
};
