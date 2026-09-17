const sharp = require('sharp');

const COMPRESSED_MAX_WIDTH = 1600;
const COMPRESSED_QUALITY = 80;
const THUMBNAIL_MAX_WIDTH = 320;
const THUMBNAIL_QUALITY = 60;
const AVATAR_SIZE = 512;
const AVATAR_QUALITY = 85;

async function createCompressed(sourcePath, destPath) {
    await sharp(sourcePath)
        .rotate()
        .resize({ width: COMPRESSED_MAX_WIDTH, withoutEnlargement: true })
        .png({ quality: COMPRESSED_QUALITY, compressionLevel: 8 })
        .toFile(destPath);
}

async function createThumbnail(sourcePath, destPath) {
    await sharp(sourcePath)
        .rotate()
        .resize({ width: THUMBNAIL_MAX_WIDTH, withoutEnlargement: true })
        .png({ quality: THUMBNAIL_QUALITY, compressionLevel: 8 })
        .toFile(destPath);
}

async function createAvatar(sourcePath, destPath) {
    await sharp(sourcePath)
        .rotate()
        .resize({
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            fit: 'cover',
            position: 'centre'
        })
        .jpeg({ quality: AVATAR_QUALITY })
        .toFile(destPath);
}

module.exports = { createCompressed, createThumbnail, createAvatar };
