const test = require('node:test');
const assert = require('node:assert/strict');
const { mockModule, freshRequire, servicesDir } = require('../helpers/moduleMock');

function loadService(seedRow) {
    const dir = servicesDir();
    const store = new Map();
    if (seedRow) {
        store.set(seedRow.user_id, seedRow);
    }

    const restoreDb = mockModule('../config/database', dir, {
        query: async (text, params) => {
            if (text.startsWith('SELECT bubble_color')) {
                const row = store.get(params[0]);
                return { rows: row ? [row] : [] };
            }
            if (text.startsWith('INSERT INTO user_chat_preferences')) {
                const [userId, bubbleColor, fontSize, autoImagePreview, notificationSound, sidebarCollapsed, theme] =
                    params;
                const row = {
                    user_id: userId,
                    bubble_color: bubbleColor,
                    font_size: fontSize,
                    auto_image_preview: autoImagePreview,
                    notification_sound: notificationSound,
                    sidebar_collapsed: sidebarCollapsed,
                    theme
                };
                store.set(userId, row);
                return { rows: [row] };
            }
            throw new Error(`Unexpected query in test double: ${text}`);
        }
    });

    const service = freshRequire('../services/userPreferences.service', dir);
    return { service, store, restore: restoreDb };
}

test('getPreferences returns defaults when no row exists yet', async () => {
    const { service, restore } = loadService(null);
    try {
        const preferences = await service.getPreferences(7);
        assert.deepEqual(preferences, {
            bubbleColor: null,
            fontSize: 'medium',
            autoImagePreview: true,
            notificationSound: 'classic',
            sidebarCollapsed: false,
            theme: 'light'
        });
    } finally {
        restore();
    }
});

test('getPreferences returns the stored row for a user', async () => {
    const { service, restore } = loadService({
        user_id: 3,
        bubble_color: '#5b8fd1',
        font_size: 'large',
        auto_image_preview: false,
        notification_sound: 'bell',
        sidebar_collapsed: true,
        theme: 'dark'
    });
    try {
        const preferences = await service.getPreferences(3);
        assert.deepEqual(preferences, {
            bubbleColor: '#5b8fd1',
            fontSize: 'large',
            autoImagePreview: false,
            notificationSound: 'bell',
            sidebarCollapsed: true,
            theme: 'dark'
        });
    } finally {
        restore();
    }
});

test('updatePreferences inserts a new row on first save, merging with defaults', async () => {
    const { service, restore } = loadService(null);
    try {
        const preferences = await service.updatePreferences(9, { fontSize: 'small' });
        assert.deepEqual(preferences, {
            bubbleColor: null,
            fontSize: 'small',
            autoImagePreview: true,
            notificationSound: 'classic',
            sidebarCollapsed: false,
            theme: 'light'
        });
    } finally {
        restore();
    }
});

test('updatePreferences only overwrites the fields present in the patch', async () => {
    const { service, restore } = loadService({
        user_id: 5,
        bubble_color: '#4fae7c',
        font_size: 'large',
        auto_image_preview: false,
        notification_sound: 'pulse',
        sidebar_collapsed: true,
        theme: 'dark'
    });
    try {
        const preferences = await service.updatePreferences(5, { notificationSound: 'none' });
        assert.deepEqual(preferences, {
            bubbleColor: '#4fae7c',
            fontSize: 'large',
            autoImagePreview: false,
            notificationSound: 'none',
            sidebarCollapsed: true,
            theme: 'dark'
        });
    } finally {
        restore();
    }
});

test('updatePreferences can clear the bubble color back to the theme default', async () => {
    const { service, restore } = loadService({
        user_id: 2,
        bubble_color: '#d15a53',
        font_size: 'medium',
        auto_image_preview: true,
        notification_sound: 'classic'
    });
    try {
        const preferences = await service.updatePreferences(2, { bubbleColor: null });
        assert.equal(preferences.bubbleColor, null);
    } finally {
        restore();
    }
});

test('updatePreferences persists the collapsed sidebar state independently of other fields', async () => {
    const { service, restore } = loadService({
        user_id: 11,
        bubble_color: null,
        font_size: 'medium',
        auto_image_preview: true,
        notification_sound: 'classic',
        sidebar_collapsed: false,
        theme: 'light'
    });
    try {
        const preferences = await service.updatePreferences(11, { sidebarCollapsed: true });
        assert.deepEqual(preferences, {
            bubbleColor: null,
            fontSize: 'medium',
            autoImagePreview: true,
            notificationSound: 'classic',
            sidebarCollapsed: true,
            theme: 'light'
        });
    } finally {
        restore();
    }
});

test('updatePreferences switches the theme without touching chat settings', async () => {
    const { service, restore } = loadService({
        user_id: 12,
        bubble_color: '#4fae7c',
        font_size: 'small',
        auto_image_preview: true,
        notification_sound: 'soft',
        sidebar_collapsed: false,
        theme: 'light'
    });
    try {
        const preferences = await service.updatePreferences(12, { theme: 'dark' });
        assert.equal(preferences.theme, 'dark');
        assert.equal(preferences.bubbleColor, '#4fae7c');
        assert.equal(preferences.fontSize, 'small');
    } finally {
        restore();
    }
});

test('an unexpected stored theme falls back to light', async () => {
    const { service, restore } = loadService({
        user_id: 13,
        bubble_color: null,
        font_size: 'medium',
        auto_image_preview: true,
        notification_sound: 'classic',
        sidebar_collapsed: false,
        theme: 'sepia'
    });
    try {
        assert.equal((await service.getPreferences(13)).theme, 'light');
    } finally {
        restore();
    }
});
