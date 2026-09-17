const searchService = require('../services/search.service');
const asyncHandler = require('../utils/asyncHandler');

async function search(req, res) {
    const term = String((req.query || {}).q || '').trim();
    if (!term) {
        return res.status(200).json({ chats: [], messages: [] });
    }
    const results = await searchService.searchAll(req.user.sub, term);
    return res.status(200).json(results);
}

module.exports = {
    search: asyncHandler(search)
};
