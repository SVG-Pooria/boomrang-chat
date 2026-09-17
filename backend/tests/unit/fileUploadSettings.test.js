const test = require('node:test');
const assert = require('node:assert/strict');
const { mockModule, freshRequire, servicesDir } = require('../helpers/moduleMock');

function loadService(initialValue) {
    const dir = servicesDir();
    const settings = new Map([['max_file_size_bytes', initialValue]]);

    const restoreDb = mockModule('../config/database', dir, {
        query: async (text, params) => {
            if (text.startsWith('SELECT value FROM system_settings')) {
                const value = settings.get(params[0]);
                return { rows: value === undefined ? [] : [{ value }] };
            }
            if (text.startsWith('INSERT INTO system_settings')) {
                settings.set(params[0], params[1]);
                return { rows: [{ key: params[0], value: params[1] }] };
            }
            throw new Error(`Unexpected query in test double: ${text}`);
        }
    });

    const service = freshRequire('../services/fileUpload.service', dir);
    return { service, restore: restoreDb };
}

test('getMaxFileSizeBytes returns null when unlimited is configured', async () => {
    const { service, restore } = loadService('unlimited');
    try {
        assert.equal(await service.getMaxFileSizeBytes(), null);
    } finally {
        restore();
    }
});

test('getMaxFileSizeBytes returns null when no setting row exists yet', async () => {
    const { service, restore } = loadService(undefined);
    try {
        assert.equal(await service.getMaxFileSizeBytes(), null);
    } finally {
        restore();
    }
});

test('getMaxFileSizeBytes parses a positive numeric limit', async () => {
    const { service, restore } = loadService('10485760');
    try {
        assert.equal(await service.getMaxFileSizeBytes(), 10485760);
    } finally {
        restore();
    }
});

test('setMaxFileSizeBytes stores the unlimited marker for a null value', async () => {
    const { service, restore } = loadService('10485760');
    try {
        const stored = await service.setMaxFileSizeBytes(null);
        assert.equal(stored, 'unlimited');
        assert.equal(await service.getMaxFileSizeBytes(), null);
    } finally {
        restore();
    }
});

test('setMaxFileSizeBytes round-trips a concrete byte value', async () => {
    const { service, restore } = loadService('unlimited');
    try {
        const stored = await service.setMaxFileSizeBytes(2048);
        assert.equal(stored, '2048');
        assert.equal(await service.getMaxFileSizeBytes(), 2048);
    } finally {
        restore();
    }
});
