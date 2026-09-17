const path = require('path');
const fs = require('fs/promises');
const uploadPaths = require('./uploadPaths');

const MIRROR_ROOT = process.env.BACKUP_MIRROR_FILES_DIR || null;

const REPO_ROOT = path.resolve(uploadPaths.ROOT, '..', '..');

function isConfigured() {
    return Boolean(MIRROR_ROOT);
}

function mirrorPathFor(absoluteFilePath) {
    if (!MIRROR_ROOT || !absoluteFilePath) {
        return null;
    }
    const relative = path.relative(REPO_ROOT, absoluteFilePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {

        return null;
    }
    return path.join(MIRROR_ROOT, relative);
}

async function mirrorFile(absoluteFilePath) {
    const mirrored = mirrorPathFor(absoluteFilePath);
    if (!mirrored) {
        return false;
    }
    try {
        await fs.mkdir(path.dirname(mirrored), { recursive: true });
        await fs.copyFile(absoluteFilePath, mirrored);
        return true;
    } catch (err) {
        return false;
    }
}

async function restoreFromMirror(absoluteFilePath) {
    const mirrored = mirrorPathFor(absoluteFilePath);
    if (!mirrored) {
        return false;
    }
    try {
        await fs.access(mirrored);
    } catch (err) {
        return false;
    }
    try {
        await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true });
        await fs.copyFile(mirrored, absoluteFilePath);
        return true;
    } catch (err) {
        return false;
    }
}

async function removeMirroredCopy(absoluteFilePath) {
    const mirrored = mirrorPathFor(absoluteFilePath);
    if (!mirrored) {
        return false;
    }
    try {
        await fs.unlink(mirrored);
        return true;
    } catch (err) {

        return false;
    }
}

module.exports = { isConfigured, mirrorPathFor, mirrorFile, restoreFromMirror, removeMirroredCopy };
