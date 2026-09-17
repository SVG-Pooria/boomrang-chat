const fs = require('fs/promises');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const uploadPaths = require('../config/uploadPaths');
const fileUploadService = require('../services/fileUpload.service');
const attemptLimit = require('../services/attemptLimit.service');

const BLOCKED_EXTENSIONS = new Set([
    '.application', '.bat', '.cmd', '.com', '.cpl', '.dll', '.exe', '.gadget', '.hta', '.jar',
    '.js', '.jse', '.lnk', '.msc', '.msi', '.msp', '.pif', '.ps1', '.psm1', '.reg', '.scf',
    '.scr', '.sys', '.vbe', '.vbs', '.wsf', '.wsh'
]);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadPaths.TEMP_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').slice(0, 10);
        cb(null, `${crypto.randomUUID()}${ext}`);
    }
});

function restoreUtf8Name(file) {
    if (!file || !file.originalname) {
        return;
    }
    const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (!decoded.includes('�')) {
        file.originalname = decoded;
    }
}

function isBlockedFile(file) {
    return BLOCKED_EXTENSIONS.has(path.extname(file.originalname || '').toLowerCase());
}

async function discard(file) {
    if (file && file.path) {
        await fs.unlink(file.path).catch(() => {});
    }
}

function fileUpload({ required }) {
    return async function handleFileUpload(req, res, next) {
        try {
            if (req.user) {
                const limit = await attemptLimit.consume(attemptLimit.LIMITS.uploadsByUser, req.user.sub);
                if (!limit.allowed) {
                    return res.status(429).json({
                        error: 'TOO_MANY_UPLOADS',
                        retryAfterSeconds: limit.retryAfterSeconds
                    });
                }
            }
            const maxBytes = await fileUploadService.getMaxFileSizeBytes();
            const upload = multer({
                storage,
                limits: maxBytes ? { fileSize: maxBytes } : undefined
            }).single('file');

            return upload(req, res, async (err) => {
                if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(413).json({ error: 'FILE_TOO_LARGE' });
                }
                if (err) {
                    return res.status(400).json({ error: 'UPLOAD_FAILED' });
                }
                if (!req.file) {
                    return required ? res.status(400).json({ error: 'FILE_REQUIRED' }) : next();
                }
                restoreUtf8Name(req.file);
                if (isBlockedFile(req.file)) {
                    await discard(req.file);
                    return res.status(415).json({ error: 'FILE_TYPE_NOT_ALLOWED' });
                }
                return next();
            });
        } catch (err) {
            return next(err);
        }
    };
}

module.exports = fileUpload({ required: true });
module.exports.uploadOptionalFile = fileUpload({ required: false });
module.exports.BLOCKED_EXTENSIONS = BLOCKED_EXTENSIONS;
