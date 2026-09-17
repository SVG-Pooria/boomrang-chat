const systemSettings = require('../services/systemSettings.service');

async function clientSettings(req, res) {
    const [flags, language] = await Promise.all([systemSettings.getFlags(), systemSettings.getLanguage()]);
    return res.status(200).json({ readReceiptsEnabled: flags.readReceiptsEnabled, language });
}

async function publicSettings(req, res) {
    return res.status(200).json({ language: await systemSettings.getLanguage() });
}

module.exports = { clientSettings, publicSettings };
