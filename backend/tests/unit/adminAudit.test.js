const test = require('node:test');
const assert = require('node:assert/strict');
const { mockModule, freshRequire, servicesDir } = require('../helpers/moduleMock');

function loadService(rows = []) {
    const dir = servicesDir();
    const queries = [];
    const notifications = [];
    const restoreDb = mockModule('../config/database', dir, {
        query: async (text, params) => {
            queries.push({ text, params });
            if (text.includes('INSERT INTO admin_audit_log')) {
                return { rows: [{ id: 41 }] };
            }
            if (text.includes('count(*)::int AS count')) {
                return { rows: [{ count: 3 }] };
            }
            return { rows };
        }
    });
    const restoreNotifier = mockModule('../socket/notifier', dir, {
        notifyAdmins: (event, payload) => notifications.push({ event, payload })
    });
    const service = freshRequire('../services/adminAudit.service', dir);
    return {
        service,
        queries,
        notifications,
        restore: () => {
            restoreDb();
            restoreNotifier();
        }
    };
}

test('a sensitive action is stored with its defined severity and pushed to super admins', async () => {
    const { service, queries, notifications, restore } = loadService();
    try {
        await service.record(7, 'password.viewed', 'کاربر آزمایشی', { targetUserId: 9 });
        const insert = queries.find((q) => q.text.includes('INSERT INTO admin_audit_log'));
        assert.deepEqual(insert.params, [7, 'password.viewed', 'کاربر آزمایشی', 'danger', JSON.stringify({ targetUserId: 9 })]);
        assert.equal(notifications.length, 1);
        assert.equal(notifications[0].event, 'admin:audit');
        assert.equal(notifications[0].payload.level, 'danger');
    } finally {
        restore();
    }
});

test('an action without a definition is kept as an ordinary event by the system', async () => {
    const { service, queries, restore } = loadService();
    try {
        await service.record(null, 'custom.event');
        const insert = queries.find((q) => q.text.includes('INSERT INTO admin_audit_log'));
        assert.equal(insert.params[0], null);
        assert.equal(insert.params[3], 'info');
    } finally {
        restore();
    }
});

test('filtering the log by severity is done in SQL', async () => {
    const { service, queries, restore } = loadService([]);
    try {
        await service.list({ level: 'warn', limit: 5 });
        const select = queries[queries.length - 1];
        assert.match(select.text, /WHERE l\.level = \$1/);
        assert.deepEqual(select.params, ['warn', 5]);
    } finally {
        restore();
    }
});

test('the CSV export opens as Persian in spreadsheets and neutralises formulas', async () => {
    const { service, restore } = loadService([
        {
            id: 1,
            action: 'user.created',
            target_description: '=HYPERLINK("http://x")',
            level: 'info',
            created_at: new Date('2026-09-14T06:30:00Z'),
            actor: 'ادمین کل'
        }
    ]);
    try {
        const csv = await service.exportCsv();
        assert.ok(csv.startsWith('﻿'));
        assert.ok(csv.includes('"\'=HYPERLINK(""http://x"")"'));
        assert.ok(csv.includes('"ساخت کاربر جدید"'));
        assert.ok(csv.includes('"عادی"'));
        assert.ok(csv.includes('"ادمین کل"'));
    } finally {
        restore();
    }
});

test('security alerts count only lockouts and blocked infected files', async () => {
    const { service, queries, restore } = loadService();
    try {
        const count = await service.countSecurityAlerts(7);
        assert.equal(count, 3);
        assert.deepEqual(queries[0].params, [['auth.login_blocked', 'upload.infected_blocked'], 7]);
    } finally {
        restore();
    }
});
