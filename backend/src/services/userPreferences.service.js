const db = require('../config/database');

const FONT_SIZE_VALUES = ['small', 'medium', 'large'];
const NOTIFICATION_SOUND_VALUES = ['classic', 'soft', 'bell', 'pulse', 'none'];
const THEME_VALUES = ['light', 'dark'];
const BUBBLE_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const DEFAULT_PREFERENCES = {
    bubbleColor: null,
    fontSize: 'medium',
    autoImagePreview: true,
    notificationSound: 'classic',
    sidebarCollapsed: false,
    theme: 'light'
};

const COLUMNS = 'bubble_color, font_size, auto_image_preview, notification_sound, sidebar_collapsed, theme';

function toResponse(row) {
    if (!row) {
        return { ...DEFAULT_PREFERENCES };
    }
    return {
        bubbleColor: row.bubble_color || null,
        fontSize: row.font_size,
        autoImagePreview: row.auto_image_preview,
        notificationSound: row.notification_sound,
        sidebarCollapsed: Boolean(row.sidebar_collapsed),
        theme: THEME_VALUES.includes(row.theme) ? row.theme : DEFAULT_PREFERENCES.theme
    };
}

async function getPreferences(userId) {
    const result = await db.query(`SELECT ${COLUMNS} FROM user_chat_preferences WHERE user_id = $1`, [userId]);
    return toResponse(result.rows[0]);
}

async function savePreferences(userId, preferences) {
    const result = await db.query(
        `INSERT INTO user_chat_preferences
            (user_id, bubble_color, font_size, auto_image_preview, notification_sound, sidebar_collapsed, theme, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (user_id) DO UPDATE SET
             bubble_color = EXCLUDED.bubble_color,
             font_size = EXCLUDED.font_size,
             auto_image_preview = EXCLUDED.auto_image_preview,
             notification_sound = EXCLUDED.notification_sound,
             sidebar_collapsed = EXCLUDED.sidebar_collapsed,
             theme = EXCLUDED.theme,
             updated_at = now()
         RETURNING ${COLUMNS}`,
        [
            userId,
            preferences.bubbleColor || null,
            preferences.fontSize,
            preferences.autoImagePreview,
            preferences.notificationSound,
            preferences.sidebarCollapsed,
            preferences.theme
        ]
    );
    return toResponse(result.rows[0]);
}

async function updatePreferences(userId, patch) {
    const current = await getPreferences(userId);
    const merged = Object.fromEntries(
        Object.keys(DEFAULT_PREFERENCES).map((key) => [key, patch[key] !== undefined ? patch[key] : current[key]])
    );
    return savePreferences(userId, merged);
}

module.exports = {
    FONT_SIZE_VALUES,
    NOTIFICATION_SOUND_VALUES,
    THEME_VALUES,
    BUBBLE_COLOR_PATTERN,
    DEFAULT_PREFERENCES,
    getPreferences,
    updatePreferences
};
