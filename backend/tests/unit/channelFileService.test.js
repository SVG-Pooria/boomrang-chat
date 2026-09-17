const test = require('node:test');
const assert = require('node:assert');
const { mockModule, freshRequire, servicesDir } = require('../helpers/moduleMock');

const dir = servicesDir();

function withCapturedQuery(run) {
    const queries = [];
    const restore = mockModule('../config/database', dir, {
        query: async (text, params) => {
            queries.push({ text, params });
            return { rows: [] };
        },
        pool: { connect: async () => ({}) }
    });
    try {
        const service = freshRequire('./channelFile.service', dir);
        return run(service, queries);
    } finally {
        restore();
    }
}

test('confidential and deleted messages are excluded in SQL, not after the fact', async () => {
    await withCapturedQuery(async (service, queries) => {
        await service.listAttachments('channel', 1, 'media');
        const [attachmentQuery] = queries;
        assert.match(attachmentQuery.text, /is_confidential = false/);
        assert.match(attachmentQuery.text, /is_deleted = false/);
        assert.match(attachmentQuery.text, /av_scan_status <> 'infected'/);
    });
});

test('the media query keeps images and video, the vault query excludes them', async () => {
    await withCapturedQuery(async (service, queries) => {
        await service.listAttachments('channel', 1, 'media');
        await service.listAttachments('channel', 1, 'files');
        assert.match(queries[0].text, /f\.mode = 'compressed' AND \(f\.mime_type LIKE 'image\/%'/);
        assert.match(queries[1].text, /NOT \(f\.mode = 'compressed'/);
    });
});

test('each target type reads from its own message table', async () => {
    await withCapturedQuery(async (service, queries) => {
        await service.listAttachments('conversation', 1, 'files');
        await service.listAttachments('channel', 1, 'files');
        await service.listAttachments('group', 1, 'files');
        assert.match(queries[0].text, /FROM messages m/);
        assert.match(queries[1].text, /FROM channel_messages m/);
        assert.match(queries[2].text, /FROM group_messages m/);
    });
});
