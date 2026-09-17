const test = require('node:test');
const assert = require('node:assert');
const { freshRequire, servicesDir } = require('../helpers/moduleMock');

const dir = servicesDir();
const KEYS = ['SUMMARY_MODEL_ENABLED', 'SUMMARY_API_BASE_URL', 'SUMMARY_API_KEY', 'SUMMARY_MODEL', 'SUMMARY_TIMEOUT_MS'];

async function withEnv(values, run) {
    const previous = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
    const previousFetch = global.fetch;
    for (const key of KEYS) {
        if (values[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = values[key];
        }
    }
    try {
        await run(freshRequire('./summarizer.service', dir));
    } finally {
        global.fetch = previousFetch;
        for (const key of KEYS) {
            if (previous[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = previous[key];
            }
        }
    }
}

test('the model layer is off by default and never calls out', async () => {
    await withEnv({}, async (summarizer) => {
        let called = false;
        global.fetch = async () => {
            called = true;
        };
        assert.strictEqual(summarizer.isEnabled(), false);
        assert.deepStrictEqual(await summarizer.interpret({ facts: ['x'], messages: [] }), []);
        assert.strictEqual(called, false);
    });
});

test('only well-formed short Persian output is accepted', async () => {
    await withEnv({}, async (summarizer) => {
        assert.deepStrictEqual(
            summarizer.parseInsights('{"bullets": ["تیم روی زمان انتشار هنوز جمع‌بندی نکرده است."]}'),
            ['تیم روی زمان انتشار هنوز جمع‌بندی نکرده است.']
        );
        assert.deepStrictEqual(summarizer.parseInsights('```json\n{"bullets": []}\n```'), []);
        assert.deepStrictEqual(summarizer.parseInsights('not json'), []);
        assert.deepStrictEqual(summarizer.parseInsights('{"items": ["متن"]}'), []);
        assert.deepStrictEqual(summarizer.parseInsights('{"bullets": ["یک", "دو", "سه"]}'), []);
        assert.deepStrictEqual(summarizer.parseInsights('{"bullets": ["The team has not decided yet."]}'), []);
        assert.deepStrictEqual(summarizer.parseInsights(JSON.stringify({ bullets: ['ب'.repeat(200)] })), []);
        assert.deepStrictEqual(summarizer.parseInsights('{"bullets": ["درست", 5]}'), []);
    });
});

test('an enabled layer posts the OpenAI-compatible shape and discards failures', async () => {
    await withEnv(
        {
            SUMMARY_MODEL_ENABLED: 'true',
            SUMMARY_API_BASE_URL: 'http://127.0.0.1:11434/v1/',
            SUMMARY_MODEL: 'local-model',
            SUMMARY_TIMEOUT_MS: '50'
        },
        async (summarizer) => {
            const requests = [];
            global.fetch = async (url, options) => {
                requests.push({ url, options });
                return {
                    ok: true,
                    json: async () => ({ choices: [{ message: { content: '{"bullets": ["جمع‌بندی نهایی هنوز باز است."]}' } }] })
                };
            };
            const insights = await summarizer.interpret({ facts: ['واقعیت'], messages: [{ sender: 'الف', text: 'سلام' }] });
            assert.deepStrictEqual(insights, ['جمع‌بندی نهایی هنوز باز است.']);
            assert.strictEqual(requests[0].url, 'http://127.0.0.1:11434/v1/chat/completions');
            assert.strictEqual(requests[0].options.headers.Authorization, undefined);
            const body = JSON.parse(requests[0].options.body);
            assert.strictEqual(body.model, 'local-model');
            assert.strictEqual(body.messages[0].role, 'system');

            global.fetch = (url, options) =>
                new Promise((resolve, reject) => {
                    options.signal.addEventListener('abort', () => reject(new Error('aborted')));
                });
            assert.deepStrictEqual(await summarizer.interpret({ facts: [], messages: [] }), []);

            global.fetch = async () => ({ ok: false, json: async () => ({}) });
            assert.deepStrictEqual(await summarizer.interpret({ facts: [], messages: [] }), []);
        }
    );
});
