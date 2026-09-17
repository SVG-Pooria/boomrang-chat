const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { corsOrigin } = require('./config/allowedOrigins');
const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const lockRoutes = require('./routes/lock.routes');
const conversationRoutes = require('./routes/conversation.routes');
const managementTicketRoutes = require('./routes/managementTicket.routes');
const uploadRoutes = require('./routes/upload.routes');
const fileRoutes = require('./routes/file.routes');
const avatarRoutes = require('./routes/avatar.routes');
const userRoutes = require('./routes/user.routes');
const userPreferencesRoutes = require('./routes/userPreferences.routes');
const oversightRoutes = require('./routes/oversight.routes');
const channelRoutes = require('./routes/channel.routes');
const groupRoutes = require('./routes/group.routes');
const channelGroupLinkRoutes = require('./routes/channelGroupLink.routes');
const searchRoutes = require('./routes/search.routes');
const workspaceRoutes = require('./routes/workspace.routes');
const taskRoutes = require('./routes/task.routes');
const meetingRoutes = require('./routes/meeting.routes');
const approvalRoutes = require('./routes/approval.routes');
const channelFileRoutes = require('./routes/channelFile.routes');
const summaryRoutes = require('./routes/summary.routes');
const managerRoutes = require('./routes/manager.routes');
const adminConsoleRoutes = require('./routes/adminConsole.routes');
const settingsRoutes = require('./routes/settings.routes');
const chatPinRoutes = require('./routes/chatPin.routes');
const messageForwardRoutes = require('./routes/messageForward.routes');

const app = express();

app.set('trust proxy', 'loopback');

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
}));
app.use(cors({ origin: corsOrigin() }));
app.use(express.json());

app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', adminConsoleRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/lock', lockRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/management-tickets', managementTicketRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/avatars', avatarRoutes);
app.use('/api/users', userRoutes);
app.use('/api/preferences', userPreferencesRoutes);
app.use('/api/admin/oversight', oversightRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/channels', channelGroupLinkRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/channel-files', channelFileRoutes);
app.use('/api/summaries', summaryRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/chat-pins', chatPinRoutes);
app.use('/api/messages', messageForwardRoutes);

const frontendDistPath = path.join(__dirname, '..', '..', 'frontend', 'dist');
const frontendIndexPath = path.join(frontendDistPath, 'index.html');
const frontendBuildExists = fs.existsSync(frontendIndexPath);

if (frontendBuildExists) {
    app.use(express.static(frontendDistPath));

    app.get(/^(?!\/api\/).*/, (req, res) => {
        res.sendFile(frontendIndexPath);
    });
}

app.use((req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' });
});

app.use((err, req, res, next) => {

    console.error(`[unhandled error] ${req.method} ${req.originalUrl}:`, err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
});

module.exports = app;
