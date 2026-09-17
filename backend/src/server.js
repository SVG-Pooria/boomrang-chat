require('dotenv').config();
const http = require('http');
const envConfig = require('./config/env');

envConfig.validate();

const app = require('./app');
const backupJob = require('./services/backup.job');
const fileCleanupJob = require('./services/fileCleanup.job');
const attachSocketServer = require('./socket/index');
const presenceTracker = require('./socket/presenceTracker');
const fileUploadService = require('./services/fileUpload.service');
const avatarUploadService = require('./services/avatarUpload.service');
const botService = require('./services/bot.service');
const forwardWorker = require('./queue/forwardWorker');

const port = process.env.PORT || 1234;

const host = process.env.HOST || '0.0.0.0';
const httpServer = http.createServer(app);
const io = attachSocketServer(httpServer);

fileUploadService.ensureDirectories()
    .then(() => avatarUploadService.ensureDirectories())
    .then(() => botService.ensureBotChannelMembership())
    .then(() => presenceTracker.reconcile(io).catch((err) => {
        console.error('Failed to reconcile presence:', err.message);
    }))
    .then(() => {
        httpServer.listen(port, host, () => {
            console.log(`Backend listening on ${host}:${port}`);
            backupJob.start();
            fileCleanupJob.start();
            botService.start(io);
            forwardWorker.start();
        });
    })
    .catch((err) => {
        console.error('Failed to prepare upload directories:', err.message);
        process.exit(1);
    });

process.on('SIGTERM', async () => {
    await forwardWorker.stop();
    process.exit(0);
});
process.on('SIGINT', async () => {
    await forwardWorker.stop();
    process.exit(0);
});
