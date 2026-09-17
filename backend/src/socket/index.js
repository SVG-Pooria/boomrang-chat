const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const redis = require('../config/redis');
const authenticateSocket = require('./auth');
const presenceTracker = require('./presenceTracker');
const conversationService = require('../services/conversation.service');
const groupCoreService = require('../services/groupCore.service');
const channelCoreService = require('../services/channelCore.service');
const activityLogService = require('../services/activityLog.service');
const notifier = require('./notifier');
const { registerMessageHandlers, conversationRoom, userRoom, roleRoom } = require('./messageHandlers');
const { groupRoom, channelRoom } = notifier;
const { isHiddenRole } = require('../config/visibility');
const { corsOrigin } = require('../config/allowedOrigins');

function attachSocketServer(httpServer) {
    const io = new Server(httpServer, {
        cors: { origin: corsOrigin() }
    });

    const pubClient = redis.getClient();
    const subClient = redis.createDuplicate();
    io.adapter(createAdapter(pubClient, subClient));

    io.use(authenticateSocket);

    notifier.setIo(io);

    io.on('connection', async (socket) => {
        const userId = socket.user.sub;
        socket.data.userId = userId;
        const connected = presenceTracker.registerConnection(userId, socket.id);

        socket.on('disconnect', async () => {
            await connected.catch(() => {});
            const remaining = await presenceTracker.registerDisconnection(userId, socket.id);
            if (remaining <= 0) {
                if (!isHiddenRole(socket.user.role)) {
                    io.emit('presence:update', { userId, status: 'offline' });
                }
                await activityLogService.log(userId, 'user.socket_disconnect', {});
            }
        });

        socket.join(userRoom(userId));
        socket.join(roleRoom(socket.user.role));
        socket.join(notifier.sessionRoom(socket.user.sessionId));

        const conversations = await conversationService.listForUser(userId);
        conversations.forEach((conversation) => {
            socket.join(conversationRoom(conversation.id));
        });

        const groups = await groupCoreService.listGroupsForUser(userId);
        groups.forEach((group) => {
            socket.join(groupRoom(group.id));
        });

        const channels = await channelCoreService.listChannelsForUser(userId);
        channels.forEach((channel) => {
            socket.join(channelRoom(channel.id));
        });

        await connected;
        if (socket.connected && !isHiddenRole(socket.user.role)) {
            io.emit('presence:update', { userId, status: 'online' });
        }

        registerMessageHandlers(io, socket);
    });

    return io;
}

module.exports = attachSocketServer;
