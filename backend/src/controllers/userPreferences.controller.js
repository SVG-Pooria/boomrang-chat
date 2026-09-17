const preferencesService = require('../services/userPreferences.service');
const activityLogService = require('../services/activityLog.service');

async function getMyPreferences(req, res) {
    const preferences = await preferencesService.getPreferences(req.user.sub);
    return res.status(200).json(preferences);
}

async function updateMyPreferences(req, res) {
    const { bubbleColor, fontSize, autoImagePreview, notificationSound, sidebarCollapsed, theme } = req.body || {};
    const patch = {};

    if (theme !== undefined) {
        if (!preferencesService.THEME_VALUES.includes(theme)) {
            return res.status(400).json({ error: 'INVALID_THEME' });
        }
        patch.theme = theme;
    }

    if (bubbleColor !== undefined) {
        if (bubbleColor !== null && !preferencesService.BUBBLE_COLOR_PATTERN.test(bubbleColor)) {
            return res.status(400).json({ error: 'INVALID_BUBBLE_COLOR' });
        }
        patch.bubbleColor = bubbleColor;
    }

    if (fontSize !== undefined) {
        if (!preferencesService.FONT_SIZE_VALUES.includes(fontSize)) {
            return res.status(400).json({ error: 'INVALID_FONT_SIZE' });
        }
        patch.fontSize = fontSize;
    }

    if (autoImagePreview !== undefined) {
        if (typeof autoImagePreview !== 'boolean') {
            return res.status(400).json({ error: 'INVALID_AUTO_IMAGE_PREVIEW' });
        }
        patch.autoImagePreview = autoImagePreview;
    }

    if (notificationSound !== undefined) {
        if (!preferencesService.NOTIFICATION_SOUND_VALUES.includes(notificationSound)) {
            return res.status(400).json({ error: 'INVALID_NOTIFICATION_SOUND' });
        }
        patch.notificationSound = notificationSound;
    }

    if (sidebarCollapsed !== undefined) {
        if (typeof sidebarCollapsed !== 'boolean') {
            return res.status(400).json({ error: 'INVALID_SIDEBAR_COLLAPSED' });
        }
        patch.sidebarCollapsed = sidebarCollapsed;
    }

    if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'INVALID_REQUEST' });
    }

    const preferences = await preferencesService.updatePreferences(req.user.sub, patch);
    await activityLogService.log(req.user.sub, 'user.preferences.updated', patch);
    return res.status(200).json(preferences);
}

module.exports = { getMyPreferences, updateMyPreferences };
