const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const uploadPaths = require('../config/uploadPaths');

const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadPaths.TEMP_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').slice(0, 10);
        cb(null, `${crypto.randomUUID()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_AVATAR_BYTES },
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            return cb(null, false);
        }
        return cb(null, true);
    }
}).single('avatar');

function uploadAvatarFile(req, res, next) {
    upload(req, res, (err) => {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'FILE_TOO_LARGE' });
        }
        if (err) {
            return res.status(400).json({ error: 'UPLOAD_FAILED' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'INVALID_IMAGE_TYPE' });
        }
        return next();
    });
}

module.exports = uploadAvatarFile;
