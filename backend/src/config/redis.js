const Redis = require('ioredis');

let client = null;

function getClient() {
    if (!client) {
        client = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
    }
    return client;
}

function createDuplicate() {
    return getClient().duplicate();
}

module.exports = { getClient, createDuplicate };
