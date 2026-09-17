const test = require('node:test');
const assert = require('node:assert');
const { mockModule, freshRequire, servicesDir } = require('../helpers/moduleMock');

const dir = servicesDir();

function withService(handlers, run) {
    const queries = [];
    const restores = [
        mockModule('../config/database', dir, {
            query: async (text, params) => {
                queries.push({ text, params });
                const rows = handlers.rows ? handlers.rows(text, params) : [];
                return { rows: rows || [] };
            },
            pool: { connect: async () => ({}) }
        }),
        mockModule('./directory.service', dir, {
            statusResolver: async () => handlers.statusOf || (() => 'آنلاین')
        }),
        mockModule('./fileUpload.service', dir, { getMaxFileSizeBytes: async () => null }),
        mockModule('./meeting.service', dir, { DEFAULT_ROOM: 'اتاق', listUpcomingForAttendees: async () => [] }),
        mockModule('./approval.service', dir, handlers.approval || {}),
        mockModule('./compliance.service', dir, handlers.compliance || {})
    ];
    try {
        return run(freshRequire('./manager.service', dir), queries);
    } finally {
        restores.reverse().forEach((restore) => restore());
    }
}

test('a team is the manager direct reports only, excluding bots and hidden roles', async () => {
    await withService({}, async (service, queries) => {
        await service.listTeamMembers(42);
        const [query] = queries;
        assert.match(query.text, /manager_id = \$1/);
        assert.match(query.text, /is_active = true/);
        assert.match(query.text, /is_bot = false/);
        assert.match(query.text, /role <> \$2/);
        assert.strictEqual(query.params[0], 42);
        assert.strictEqual(query.params[1], 'super_admin');
    });
});

test('workload is computed from real open tasks against capacity, with overdue counted twice', async () => {
    await withService(
        {
            rows: (text) => {
                if (text.includes('system_settings')) {
                    return [{ value: '8' }];
                }
                if (text.includes('FROM tasks')) {
                    return [
                        { owner_id: 1, open: 4, overdue: 0 },
                        { owner_id: 2, open: 4, overdue: 4 }
                    ];
                }
                return [];
            },
            statusOf: (userId) => ({ 1: 'آنلاین', 2: 'مرخصی' }[userId] || 'خارج از ساعت کاری')
        },
        async (service) => {
            const roster = await service.buildRoster(
                [
                    { id: 1, full_name: 'سارا محمدی', job_title: 'سرپرست محصول' },
                    { id: 2, full_name: 'مارکو رئیسی', job_title: null },
                    { id: 3, full_name: 'نگار کیانی', job_title: null }
                ],
                new Date()
            );
            assert.deepStrictEqual(
                roster.map((person) => [person.load, person.open, person.status]),
                [
                    [50, 4, 'online'],
                    [100, 4, 'leave'],
                    [0, 0, 'away']
                ]
            );
            assert.strictEqual(roster[1].role, 'همکار');
        }
    );
});

test('response time reports an honest gap instead of inventing an average or a delta', async () => {
    await withService({}, (service) => {
        const thin = service.responseMetric({ decisions: 2, averageMs: 3600000 }, { decisions: 9, averageMs: 1 });
        assert.strictEqual(thin.value, '—');
        assert.strictEqual(thin.delta, 'دادهٔ کافی نیست');

        const noBaseline = service.responseMetric(
            { decisions: 5, averageMs: 6 * 3600000 },
            { decisions: 1, averageMs: 3600000 }
        );
        assert.strictEqual(noBaseline.value, '۶ ساعت');
        assert.strictEqual(noBaseline.delta, 'بدون داده مقایسه‌ای');

        const improved = service.responseMetric(
            { decisions: 5, averageMs: 4 * 3600000 },
            { decisions: 5, averageMs: 8 * 3600000 }
        );
        assert.strictEqual(improved.value, '۴ ساعت');
        assert.strictEqual(improved.delta, '۵۰٪ سریع‌تر نسبت به ۳۰ روز قبل');
    });
});

test('on-time rate and returned requests stay empty until real history exists', async () => {
    await withService({}, (service) => {
        const thin = service.onTimeMetric({ closed: 1, on_time: 1 }, { closed: 0, on_time: 0 });
        assert.strictEqual(thin.value, '—');
        assert.strictEqual(thin.delta, 'دادهٔ کافی نیست');

        const rate = service.onTimeMetric({ closed: 4, on_time: 3 }, { closed: 4, on_time: 2 });
        assert.strictEqual(rate.value, '۷۵٪');
        assert.strictEqual(rate.delta, '+۲۵ واحد نسبت به ۳۰ روز قبل');

        const fresh = service.referredMetric(2, 0, false);
        assert.strictEqual(fresh.value, '۲');
        assert.strictEqual(fresh.delta, 'بدون داده مقایسه‌ای');

        const compared = service.referredMetric(1, 3, true);
        assert.strictEqual(compared.delta, '۲ مورد کمتر نسبت به ۳۰ روز قبل');
    });
});
