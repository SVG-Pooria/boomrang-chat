const { WS_URL } = require('./env');

function loadSocketIoClient() {
    try {
        return require('socket.io-client');
    } catch (err) {
        return null;
    }
}

function connectSocket(token) {
    const io = loadSocketIoClient();
    if (!io) {
        return null;
    }
    return io(WS_URL, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true
    });
}

function waitForEvent(socket, eventName, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(eventName, onEvent);
            reject(new Error(`Timed out waiting for socket event: ${eventName}`));
        }, timeoutMs);
        function onEvent(payload) {
            clearTimeout(timer);
            resolve(payload);
        }
        socket.once(eventName, onEvent);
    });
}

function waitForConnect(socket, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out connecting to socket server')), timeoutMs);
        socket.once('connect', () => {
            clearTimeout(timer);
            resolve();
        });
        socket.once('connect_error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

function emitWithAck(socket, eventName, payload, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ack on ${eventName}`)), timeoutMs);
        socket.emit(eventName, payload, (response) => {
            clearTimeout(timer);
            resolve(response);
        });
    });
}

module.exports = { loadSocketIoClient, connectSocket, waitForEvent, waitForConnect, emitWithAck };
