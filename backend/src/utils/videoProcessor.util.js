const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
}

const COMPRESSED_MAX_WIDTH = 1280;
const COMPRESSED_CRF = 28;
const COMPRESSED_PRESET = 'veryfast';
const AUDIO_BITRATE = '128k';
const THUMBNAIL_MAX_WIDTH = 320;
const THUMBNAIL_SEEK_SECONDS = 1;

function scaleFilter(maxWidth) {
    return `scale='min(${maxWidth},iw)':-2`;
}

async function createCompressed(sourcePath, destPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(sourcePath)
            .videoCodec('libx264')
            .audioCodec('aac')
            .audioBitrate(AUDIO_BITRATE)
            .outputOptions([
                `-crf ${COMPRESSED_CRF}`,
                `-preset ${COMPRESSED_PRESET}`,
                '-movflags +faststart',
                '-pix_fmt yuv420p'
            ])
            .videoFilters(scaleFilter(COMPRESSED_MAX_WIDTH))
            .format('mp4')
            .on('error', (err) => reject(err))
            .on('end', () => resolve())
            .save(destPath);
    });
}

function captureFrame(sourcePath, destPath, timestampSeconds) {
    const path = require('path');
    return new Promise((resolve, reject) => {
        ffmpeg(sourcePath)
            .on('error', (err) => reject(err))
            .on('end', () => resolve())
            .screenshots({
                timestamps: [timestampSeconds],
                filename: path.basename(destPath),
                folder: path.dirname(destPath),
                size: `${THUMBNAIL_MAX_WIDTH}x?`
            });
    });
}

async function createThumbnail(sourcePath, destPath) {
    try {
        await captureFrame(sourcePath, destPath, THUMBNAIL_SEEK_SECONDS);
    } catch (err) {
        await captureFrame(sourcePath, destPath, 0);
    }
}

module.exports = { createCompressed, createThumbnail };
