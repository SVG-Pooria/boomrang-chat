const test = require('node:test');
const assert = require('node:assert');
const { mockModule, freshRequire, servicesDir } = require('../helpers/moduleMock');

const dir = servicesDir();

function withService(step, requesterManagerId, run) {
    const statements = [];
    const client = {
        query: async (text, params) => {
            statements.push({ text, params });
            if (text.includes('FROM approval_requests WHERE id')) {
                return { rows: [{ id: 3, status: 'pending', current_step: 1, total_steps: 2, requester_id: 55 }] };
            }
            if (text.includes('FROM approval_steps WHERE request_id')) {
                return { rows: [step] };
            }
            if (text.includes('SELECT manager_id FROM users')) {
                return { rows: [{ manager_id: requesterManagerId }] };
            }
            return { rows: [] };
        },
        release() {}
    };
    const restores = [
        mockModule('../config/database', dir, {
            query: async () => ({ rows: [] }),
            pool: { connect: async () => client }
        }),
        mockModule('./workspaceTarget.service', dir, { displayName: async () => '#کانال' })
    ];
    try {
        return run(freshRequire('./approval.service', dir), statements);
    } finally {
        restores.reverse().forEach((restore) => restore());
    }
}

const directManagerStep = {
    id: 9,
    step_number: 1,
    step_name: 'تأیید سرپرست مستقیم',
    approver_role: 'management',
    approver_scope: 'direct_manager'
};

test('a direct-manager stage belongs to that requester manager alone', async () => {
    await withService(directManagerStep, 7, async (service) => {
        const stranger = await service.decide(3, { sub: 12, role: 'management' }, 'تأیید');
        assert.deepStrictEqual(stranger, { error: 'NOT_STEP_APPROVER' });
    });
    await withService(directManagerStep, 7, async (service) => {
        const manager = await service.decide(3, { sub: 7, role: 'management' }, 'تأیید');
        assert.ok(manager.success);
    });
});

test('a direct-manager stage falls back to the role when the requester has no manager', async () => {
    await withService(directManagerStep, null, async (service) => {
        const employee = await service.decide(3, { sub: 12, role: 'employee' }, 'تأیید');
        assert.deepStrictEqual(employee, { error: 'NOT_STEP_APPROVER' });
    });
    await withService(directManagerStep, null, async (service) => {
        const anyManager = await service.decide(3, { sub: 12, role: 'management' }, 'تأیید');
        assert.ok(anyManager.success);
    });
});

test('a role stage is not decidable by an unrelated direct manager', async () => {
    const financeStep = {
        id: 4,
        step_number: 1,
        step_name: 'تأیید مدیر مالی',
        approver_role: 'management',
        approver_scope: 'role'
    };
    await withService(financeStep, 7, async (service) => {
        const directManagerWhoIsEmployee = await service.decide(3, { sub: 7, role: 'employee' }, 'تأیید');
        assert.deepStrictEqual(directManagerWhoIsEmployee, { error: 'NOT_STEP_APPROVER' });
    });
});

test('listing the manager inbox filters by the real stage owner, not by role alone', async () => {
    const queries = [];
    const restores = [
        mockModule('../config/database', dir, {
            query: async (text, params) => {
                queries.push({ text, params });
                return { rows: [] };
            },
            pool: { connect: async () => ({}) }
        }),
        mockModule('./workspaceTarget.service', dir, { displayName: async () => '#کانال' })
    ];
    try {
        const service = freshRequire('./approval.service', dir);
        await service.listForManager({ sub: 7, role: 'management' }, [55, 56]);
        const [query] = queries;
        assert.match(query.text, /s\.approver_scope = 'direct_manager'/);
        assert.match(query.text, /u\.manager_id = \$2/);
        assert.deepStrictEqual(query.params, ['management', 7, [55, 56]]);
    } finally {
        restores.reverse().forEach((restore) => restore());
    }
});
