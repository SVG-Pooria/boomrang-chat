const test = require('node:test');
const assert = require('node:assert/strict');
const { mockModule, freshRequire, servicesDir } = require('../helpers/moduleMock');

function loadService(stored) {
    const dir = servicesDir();
    const settings = new Map(Object.entries(stored));
    const restore = mockModule('../config/database', dir, {
        query: async (text, params) => {
            if (text.startsWith('SELECT key, value FROM system_settings')) {
                return {
                    rows: params[0].filter((key) => settings.has(key)).map((key) => ({ key, value: settings.get(key) }))
                };
            }
            if (text.startsWith('SELECT value FROM system_settings')) {
                return { rows: settings.has(params[0]) ? [{ value: settings.get(params[0]) }] : [] };
            }
            if (text.startsWith('INSERT INTO system_settings')) {
                settings.set(params[0], params[1]);
                return { rows: [] };
            }
            throw new Error(`Unexpected query in test double: ${text}`);
        }
    });
    const service = freshRequire('../services/systemSettings.service', dir);
    return { service, settings, restore };
}

test('policy flags fall back to current behaviour when nothing is stored', async () => {
    const { service, restore } = loadService({});
    try {
        assert.deepEqual(await service.getFlags(), {
            readReceiptsEnabled: true,
            fileScanEnabled: true
        });
    } finally {
        restore();
    }
});

test('stored flags override the defaults', async () => {
    const { service, restore } = loadService({ read_receipts_enabled: 'false' });
    try {
        const flags = await service.getFlags();
        assert.equal(flags.readReceiptsEnabled, false);
        assert.equal(flags.fileScanEnabled, true);
    } finally {
        restore();
    }
});

test('turning read receipts off hides seen counts from message listings', async () => {
    const { service, restore } = loadService({});
    try {
        await service.setFlag('readReceiptsEnabled', false);
        const [message] = await service.applyReadReceiptPolicy([{ id: 1, seen_by_count: 4, audience_count: 6 }]);
        assert.equal(message.seen_by_count, null);
        assert.equal(message.audience_count, null);
    } finally {
        restore();
    }
});

test('read receipts stay untouched while the policy is on', async () => {
    const { service, restore } = loadService({ read_receipts_enabled: 'true' });
    try {
        const messages = [{ id: 1, seen_by_count: 2 }];
        assert.equal(await service.applyReadReceiptPolicy(messages), messages);
    } finally {
        restore();
    }
});

test('the system language defaults to Persian', async () => {
    const { service, restore } = loadService({});
    try {
        assert.equal(await service.getLanguage(), 'fa');
    } finally {
        restore();
    }
});

test('an unknown stored language falls back to Persian', async () => {
    const { service, restore } = loadService({ system_language: 'de' });
    try {
        assert.equal(await service.getLanguage(), 'fa');
    } finally {
        restore();
    }
});

test('switching the system language is stored and served immediately', async () => {
    const { service, settings, restore } = loadService({});
    try {
        await service.setLanguage('en');
        assert.equal(settings.get('system_language'), 'en');
        assert.equal(await service.getLanguage(), 'en');
        assert.equal(service.cachedLanguageOrDefault(), 'en');
    } finally {
        restore();
    }
});
