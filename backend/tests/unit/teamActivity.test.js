const test = require('node:test');
const assert = require('node:assert');
const { mockModule, freshRequire, servicesDir } = require('../helpers/moduleMock');

const dir = servicesDir();

function withService(rows, run) {
    const queries = [];
    const restore = mockModule('../config/database', dir, {
        query: async (text, params) => {
            queries.push({ text, params });
            return { rows: typeof rows === 'function' ? rows(text) : rows };
        },
        pool: { connect: async () => ({}) }
    });
    try {
        return run(freshRequire('./compliance.service', dir), queries);
    } finally {
        restore();
    }
}

test('the compliance log and the team timeline read separate audiences of one table', async () => {
    await withService([], async (service, queries) => {
        await service.auditLog(5);
        await service.teamTimeline([1, 2], 5);
        assert.match(queries[0].text, /audience = 'compliance'/);
        assert.match(queries[1].text, /audience = 'team'/);
        assert.match(queries[1].text, /actor_id = ANY\(\$1::int\[\]\)/);
        assert.deepStrictEqual(queries[1].params, [[1, 2], 5]);
    });
});

test('team activity rows are written with the team audience and a real actor', async () => {
    await withService([], async (service, queries) => {
        await service.recordTeamActivity(4, 'task.moved', 'وظیفهٔ «الف» را به «بررسی» برد', { taskId: 3 });
        const [insert] = queries;
        assert.match(insert.text, /INSERT INTO activity_log/);
        assert.match(insert.text, /'team'/);
        assert.strictEqual(insert.params[0], 4);
        assert.strictEqual(insert.params[1], 'task.moved');
    });
});

test('timeline entries carry the real actor name and event text, with no invented rows', async () => {
    const createdAt = new Date();
    await withService(
        [{ action: 'approval.submitted', description: 'درخواست «خرید» را ثبت کرد', created_at: createdAt, full_name: 'سارا محمدی' }],
        async (service) => {
            const [entry] = await service.teamTimeline([1], 5);
            assert.strictEqual(entry.who, 'سارا محمدی');
            assert.strictEqual(entry.what, 'درخواست «خرید» را ثبت کرد');
            assert.strictEqual(entry.tone, 'violet');
            assert.match(entry.when, /^[۰-۹]{2}:[۰-۹]{2}$/);
        }
    );
});
