const DEFAULT_TIMEOUT_MS = 8000;
const MAX_INSIGHTS = 2;
const MAX_INSIGHT_CHARS = 160;
const MAX_MESSAGE_CHARS = 400;
const PERSIAN_LETTERS = /[؀-ۿ]/g;
const LATIN_LETTERS = /[A-Za-z]/g;

const SYSTEM_PROMPT = [
    'You read an internal workplace conversation and the facts already listed in its summary box.',
    'Return at most two short Persian bullet points that add interpretation the facts do not already state.',
    'Never repeat or contradict a listed fact, never invent names, numbers or decisions.',
    'Answer with JSON only, exactly in the shape {"bullets": ["...", "..."]}. Use an empty array when nothing useful can be added.'
].join(' ');

function readConfig() {
    const timeout = Number(process.env.SUMMARY_TIMEOUT_MS);
    return {
        enabled: process.env.SUMMARY_MODEL_ENABLED === 'true',
        baseUrl: String(process.env.SUMMARY_API_BASE_URL || '').replace(/\/+$/, ''),
        apiKey: process.env.SUMMARY_API_KEY || '',
        model: process.env.SUMMARY_MODEL || '',
        timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS
    };
}

function isEnabled() {
    const config = readConfig();
    return config.enabled && Boolean(config.baseUrl) && Boolean(config.model);
}

function isPersian(text) {
    const persian = (text.match(PERSIAN_LETTERS) || []).length;
    const latin = (text.match(LATIN_LETTERS) || []).length;
    return persian > 0 && persian >= latin * 3;
}

function parseInsights(content) {
    if (typeof content !== 'string') {
        return [];
    }
    const unwrapped = content
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
    let parsed;
    try {
        parsed = JSON.parse(unwrapped);
    } catch (err) {
        return [];
    }
    if (!parsed || !Array.isArray(parsed.bullets) || parsed.bullets.length > MAX_INSIGHTS) {
        return [];
    }
    const cleaned = parsed.bullets.map((item) =>
        typeof item === 'string' ? item.replace(/\s+/g, ' ').trim() : ''
    );
    if (cleaned.some((text) => !text || text.length > MAX_INSIGHT_CHARS || !isPersian(text))) {
        return [];
    }
    return cleaned;
}

async function interpret({ facts, messages }) {
    const config = readConfig();
    if (!config.enabled || !config.baseUrl || !config.model) {
        return [];
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
        headers.Authorization = `Bearer ${config.apiKey}`;
    }
    try {
        const response = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: JSON.stringify({
                model: config.model,
                temperature: 0,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content: JSON.stringify({
                            facts,
                            messages: messages.map((message) => ({
                                sender: message.sender,
                                text: String(message.text || '').slice(0, MAX_MESSAGE_CHARS)
                            }))
                        })
                    }
                ]
            })
        });
        if (!response.ok) {
            return [];
        }
        const payload = await response.json();
        const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
        return parseInsights(choice && choice.message ? choice.message.content : null);
    } catch (err) {
        return [];
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    MAX_INSIGHTS,
    MAX_INSIGHT_CHARS,
    isEnabled,
    parseInsights,
    interpret
};
