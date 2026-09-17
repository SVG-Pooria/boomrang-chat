const test = require('node:test');
const assert = require('node:assert');
const { mockModule, freshRequire, servicesDir } = require('../helpers/moduleMock');

const dir = servicesDir();

function withService(run) {
    const queries = [];
    const restore = mockModule('../config/database', dir, {
        query: async (text, params) => {
            queries.push({ text, params });
            return { rows: [{ id: 1, owner_id: 1, created_by: 1, title: 'وظیفه', status: 'در انتظار', progress: 0, tag: null }] };
        },
        pool: { connect: async () => ({}) }
    });
    try {
        return run(freshRequire('./task.service', dir), queries);
    } finally {
        restore();
    }
}

test('both boards share one status enum with a 1:1 column mapping', () => {
    withService((service) => {
        assert.deepStrictEqual(
            service.BOARD.map((column) => [column.status, column.managerColumn]),
            [
                ['در انتظار', 'در انتظار شروع'],
                ['در حال انجام', 'در جریان'],
                ['بررسی', 'منتظر تأیید مدیر'],
                ['انجام شد', 'انجام‌شده']
            ]
        );
        assert.deepStrictEqual(service.STATUSES, service.BOARD.map((column) => column.status));
        assert.strictEqual(new Set(service.BOARD.map((column) => column.managerColumn)).size, 4);
        assert.strictEqual(service.isValidStatus('منتظر تأیید مدیر'), false);
    });
});

test('completion time is stamped when a task is closed and cleared when it reopens', async () => {
    await withService(async (service, queries) => {
        await service.updateTask(1, { sub: 1, role: 'management' }, { status: 'انجام شد' });
        const update = queries.find((query) => query.text.includes('UPDATE tasks'));
        assert.match(update.text, /completed_at = CASE/);
        assert.match(update.text, /COALESCE\(completed_at, now\(\)\)/);
        assert.match(update.text, /ELSE NULL/);
    });
});

test('a manager may only edit tasks owned by their own direct reports', async () => {
    const restore = mockModule('../config/database', dir, {
        query: async (text) => {
            if (text.includes('owner_manager_id')) {
                return {
                    rows: [
                        { id: 5, owner_id: 77, created_by: 99, status: 'در انتظار', owner_manager_id: 8 }
                    ]
                };
            }
            return { rows: [{ id: 5, title: 'وظیفه', status: 'بررسی', progress: 0, tag: null }] };
        },
        pool: { connect: async () => ({}) }
    });
    try {
        const service = freshRequire('./task.service', dir);
        const outsider = await service.updateTask(5, { sub: 4, role: 'manager' }, { status: 'بررسی' });
        assert.deepStrictEqual(outsider, { error: 'FORBIDDEN' });
        const lead = await service.updateTask(5, { sub: 8, role: 'manager' }, { status: 'بررسی' });
        assert.ok(lead.task);
        const executive = await service.updateTask(5, { sub: 4, role: 'management' }, { status: 'بررسی' });
        assert.ok(executive.task);
        const stranger = await service.updateTask(5, { sub: 4, role: 'employee' }, { status: 'بررسی' });
        assert.deepStrictEqual(stranger, { error: 'FORBIDDEN' });
    } finally {
        restore();
    }
});
