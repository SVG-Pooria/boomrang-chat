const test = require('node:test');
const assert = require('node:assert');
const { mockModule, freshRequire, servicesDir } = require('../helpers/moduleMock');

const dir = servicesDir();

function withMockedDb(rows, run) {
    const queries = [];
    const restoreDb = mockModule('../config/database', dir, {
        query: async (text, params) => {
            queries.push({ text, params });
            return { rows: typeof rows === 'function' ? rows(text, params) : rows };
        },
        pool: { connect: async () => ({}) }
    });
    const restoreTarget = mockModule('./workspaceTarget.service', dir, {
        displayName: async () => '#کانال-آزمایشی'
    });
    try {
        const service = freshRequire('./approval.service', dir);
        return run(service, queries);
    } finally {
        restoreTarget();
        restoreDb();
    }
}

test('a request type name must be a non-empty label within the length limit', () => {
    withMockedDb([], (service) => {
        for (const type of ['مرخصی', 'خرید', 'تنخواه']) {
            assert.strictEqual(service.isValidType(type), true, type);
        }
        assert.strictEqual(service.isValidType('   '), false);
        assert.strictEqual(service.isValidType('ن'.repeat(61)), false);
        assert.strictEqual(service.isValidType(null), false);
    });
});

test('the flow adds a manager step only when the requester reports to a manager', async () => {
    await withMockedDb([{ manager_id: 12, manager_role: 'manager' }], async (service) => {
        const withManager = await service.buildFlow(3);
        assert.deepStrictEqual(
            withManager.map((step) => step.step_name),
            ['تأیید مدیر', 'تأیید مدیریت']
        );
    });
    await withMockedDb([{ manager_id: 12, manager_role: 'management' }], async (service) => {
        const executiveOnly = await service.buildFlow(3);
        assert.deepStrictEqual(
            executiveOnly.map((step) => step.step_name),
            ['تأیید مدیریت']
        );
    });
});

test('only the three decisions are accepted', () => {
    withMockedDb([], (service) => {
        assert.strictEqual(service.isValidDecision('تأیید'), true);
        assert.strictEqual(service.isValidDecision('رد'), true);
        assert.strictEqual(service.isValidDecision('ارجاع'), true);
        assert.strictEqual(service.isValidDecision('شاید'), false);
    });
});

test('a pending request is serialised with its real step, amount and source', async () => {
    await withMockedDb(
        [
            {
                id: 7,
                title: 'درخواست خرید لایسنس',
                requester_name: 'سارا محمدی',
                type: 'خرید',
                amount_rials: 48000000,
                created_at: new Date('2026-09-10T09:00:00Z'),
                deadline_at: null,
                priority: 'بالا',
                current_step: 2,
                total_steps: 4,
                step_name: 'تأیید مدیر مالی',
                status: 'pending',
                can_decide: false,
                source_target_type: 'channel',
                source_target_id: 1
            }
        ],
        async (service) => {
            const [item] = await service.listForViewer({ role: 'employee', sub: 5 });
            assert.strictEqual(item.id, 'REQ-۷');
            assert.strictEqual(item.step, 2);
            assert.strictEqual(item.totalSteps, 4);
            assert.strictEqual(item.stepName, 'تأیید مدیر مالی');
            assert.strictEqual(item.amount, '۴۸٬۰۰۰٬۰۰۰ ریال');
            assert.strictEqual(item.fromChat, '#کانال-آزمایشی');
            assert.strictEqual(item.canDecide, false);
            assert.strictEqual(item.initials, 'سم');
        }
    );
});

test('a request with no source conversation reports گفتگوی شخصی', async () => {
    await withMockedDb(
        [
            {
                id: 8,
                title: 'مرخصی',
                requester_name: 'امیر راد',
                type: 'مرخصی',
                amount_rials: null,
                created_at: new Date('2026-09-10T09:00:00Z'),
                priority: 'فوری',
                current_step: 1,
                total_steps: 2,
                step_name: 'تأیید سرپرست مستقیم',
                status: 'pending',
                can_decide: true,
                source_target_type: null,
                source_target_id: null
            }
        ],
        async (service) => {
            const [item] = await service.listForViewer({ role: 'management', sub: 6 });
            assert.strictEqual(item.fromChat, 'گفتگوی شخصی');
            assert.strictEqual(item.amount, undefined);
            assert.strictEqual(item.canDecide, true);
        }
    );
});

test('the decide query authorises the real owner of the pending stage', async () => {
    await withMockedDb([{ count: 0 }], async (service, queries) => {
        await service.countPendingFor({ sub: 7, role: 'management' });
        const [pending] = queries;
        assert.match(pending.text, /s\.approver_scope = 'role' AND s\.approver_role = \$1/);
        assert.match(pending.text, /s\.approver_scope = 'direct_manager'/);
        assert.match(pending.text, /u\.manager_id = \$2/);
        assert.doesNotMatch(pending.text, /s\.step_number = 1/);
    });
});
