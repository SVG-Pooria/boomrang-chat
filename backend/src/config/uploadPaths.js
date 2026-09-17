const path = require('path');

const ROOT = process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.resolve(__dirname, '..', '..', 'uploads');

const TEMP_DIR = path.join(ROOT, 'tmp');
const ORIGINAL_DIR = path.join(ROOT, 'original');
const COMPRESSED_DIR = path.join(ROOT, 'compressed');
const THUMBNAIL_DIR = path.join(ROOT, 'thumbnails');
const AVATAR_DIR = path.join(ROOT, 'avatars');

module.exports = { ROOT, TEMP_DIR, ORIGINAL_DIR, COMPRESSED_DIR, THUMBNAIL_DIR, AVATAR_DIR };
