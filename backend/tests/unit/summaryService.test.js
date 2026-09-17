const test = require('node:test');
const assert = require('node:assert');
const { mockModule, freshRequire, servicesDir } = require('../helpers/moduleMock');

const dir = servicesDir();

function loadService(routes = []) {
    const queries = [];
    const broadcasts = [];
    const restores = [
        mockModule('../config/database', dir, {
            query: async (text, params) => {
                queries.push({ text, params });
                const route = routes.find(([pattern]) => pattern.test(text));
                if (!route) {
                    return { rows: [] };
                }
                const rows = typeof route[1] === 'function' ? route[1](text, params) : route[1];
                return { rows };
            },
            pool: {}
        }),
        mockModule('./summarizer.service', dir, {
            MAX_INSIGHTS: 2,
            isEnabled: () => false,
            interpret: async () => []
        }),
        mockModule('../socket/notifier', dir, {
            notifySummaryUpdated: (targetType, targetId, summary) =>
                broadcasts.push({ targetType, targetId, summary })
        })
    ];
    const service = freshRequire('./summary.service', dir);
    return {
        service,
        queries,
        broadcasts,
        restore: () => restores.reverse().forEach((restore) => restore())
    };
}

async function withService(routes, run) {
    const loaded = loadService(routes);
    try {
        await run(loaded);
    } finally {
        loaded.restore();
    }
}

const SETTINGS = {
    minNewMessages: 10,
    maxAgeMinutes: 60,
    windowFloorMessages: 50,
    followUpMinutes: 30
};

function windowRoute(row) {
    return [/AS newest_id/, [row]];
}

function savedRow(params) {
    return [
        {
            target_type: params[0],
            target_id: params[1],
            bullets: JSON.parse(params[2]),
            covered_from_message_id: params[3],
            covered_to_message_id: params[4],
            message_count: params[5],
            is_manual: false,
            generated_at: new Date()
        }
    ];
}

const activityRoutes = [
    [/AS message_count/, [{ message_count: 12, participants: 3, window_start: new Date('2026-09-01T08:00:00Z') }]],
    [/GROUP BY m\.sender_id/, [
        { sender_id: 4, full_name: 'سارا احمدی', messages: 6 },
        { sender_id: 7, full_name: 'رضا کریمی', messages: 4 }
    ]]
];

function fullFacts() {
    return {
        pinned: {
            rows: [
                { id: 91, body: 'نسخه نهایی بیلبورد را در گاوصندوق گذاشتم', original_name: null },
                { id: 88, body: 'جلسه بازبینی ساعت ده برگزار می‌شود', original_name: null }
            ],
            total: 3
        },
        work: { tasks: 2, approvals: 1, meetings: 0 },
        polls: [
            { messageId: 70, question: 'رنگ اصلی کمپین؟', isClosed: false, options: [{ label: 'سبز', votes: 3 }, { label: 'آبی', votes: 1 }] },
            { messageId: 60, question: 'تاریخ انتشار؟', isClosed: true, options: [{ label: 'شنبه', votes: 2 }, { label: 'یکشنبه', votes: 2 }] }
        ],
        files: { counts: { media: 3, files: 1, music: 0, gifs: 0 }, latestId: 95, latestName: 'render-4k.png' },
        questions: { rows: [{ id: 99, body: 'فایل لایه‌باز را کسی دارد؟' }], total: 1 },
        activity: { messageCount: 12, participants: 3, busiest: [{ name: 'سارا احمدی', messages: 6 }, { name: 'رضا کریمی', messages: 4 }] }
    };
}

test('confidential, deleted, bot, hidden-role and per-user hidden messages are excluded in SQL', async () => {
    await withService(
        [windowRoute({ newest_id: 120, floor_id: 71, first_new_id: null }), ...activityRoutes],
        async ({ service, queries }) => {
            await service.computeDigest('conversation', 5, null, SETTINGS);
            const messageQueries = queries.filter((q) => /FROM messages m|FROM messages q|JOIN messages m/.test(q.text));
            assert.ok(messageQueries.length >= 5, 'every family reads from the messages table');
            for (const query of messageQueries) {
                assert.match(query.text, /is_confidential = false/);
                assert.match(query.text, /is_deleted = false/);
                assert.match(query.text, /is_bot = false/);
                assert.match(query.text, /role <> \$2/);
                assert.match(query.text, /message_hidden_for_user/);
                assert.strictEqual(query.params[1], 'super_admin');
            }
        }
    );
});

test('each target type reads only its own message table', async () => {
    for (const [targetType, table] of [
        ['conversation', 'messages'],
        ['channel', 'channel_messages'],
        ['group', 'group_messages']
    ]) {
        await withService(
            [windowRoute({ newest_id: 10, floor_id: 1, first_new_id: null }), ...activityRoutes],
            async ({ service, queries }) => {
                await service.computeDigest(targetType, 3, null, SETTINGS);
                const tables = new Set();
                for (const query of queries) {
                    for (const match of query.text.matchAll(/\b(messages|channel_messages|group_messages)\s+[mqr]\b/g)) {
                        tables.add(match[1]);
                    }
                }
                assert.deepStrictEqual([...tables], [table]);
            }
        );
    }
});

test('the unanswered-question family never counts a reply from the asker and waits for the follow-up window', async () => {
    await withService(
        [windowRoute({ newest_id: 40, floor_id: 1, first_new_id: null }), ...activityRoutes],
        async ({ service, queries }) => {
            await service.computeDigest('group', 2, null, { ...SETTINGS, followUpMinutes: 45 });
            const question = queries.find((q) => /btrim\(q\.body\)/.test(q.text));
            assert.ok(question, 'question query issued');
            assert.match(question.text, /r\.sender_id <> q\.sender_id/);
            assert.match(question.text, /\[\?؟\]\$/);
            assert.strictEqual(question.params[4], 45);
        }
    );
});

test('every empty family is omitted rather than padded', () => {
    const { service, restore } = loadService();
    try {
        assert.deepStrictEqual(service.composeBullets({}), []);
        assert.deepStrictEqual(
            service.composeBullets({
                pinned: { rows: [], total: 0 },
                work: { tasks: 0, approvals: 0, meetings: 0 },
                polls: [],
                files: { counts: { media: 0, files: 0, music: 0, gifs: 0 }, latestId: null, latestName: null },
                questions: { rows: [], total: 0 },
                activity: { messageCount: 0, participants: 0, busiest: [] }
            }),
            []
        );
        const onlyWork = service.composeBullets({ work: { tasks: 2, approvals: 1, meetings: 0 } });
        assert.deepStrictEqual(onlyWork, [
            { kind: 'work', text: '۲ وظیفه و ۱ درخواست تأیید از این گفتگو ساخته شده است.', ref_message_id: null }
        ]);
    } finally {
        restore();
    }
});

test('the result is capped at five bullets in the fixed priority order', () => {
    const { service, restore } = loadService();
    try {
        const bullets = service.composeBullets(fullFacts());
        assert.strictEqual(bullets.length, service.MAX_BULLETS);
        assert.deepStrictEqual(
            bullets.map((item) => item.kind),
            ['pinned', 'pinned', 'work', 'poll', 'poll']
        );

        const facts = fullFacts();
        facts.pinned = { rows: facts.pinned.rows.slice(0, 1), total: 1 };
        facts.polls = facts.polls.slice(0, 1);
        const next = service.composeBullets(facts);
        assert.deepStrictEqual(
            next.map((item) => item.kind),
            ['pinned', 'work', 'poll', 'files', 'question']
        );
    } finally {
        restore();
    }
});

test('bullets quote real rows, link real message ids and never round counts', () => {
    const { service, restore } = loadService();
    try {
        const [firstPin, secondPin, work, openPoll, closedPoll] = service.composeBullets(fullFacts());
        assert.strictEqual(firstPin.ref_message_id, 91);
        assert.match(firstPin.text, /^سنجاق‌شده: «نسخه نهایی بیلبورد را در گاوصندوق گذاشتم»$/);
        assert.match(secondPin.text, /و ۱ پیام سنجاق‌شدهٔ دیگر/);
        assert.strictEqual(work.ref_message_id, null);
        assert.match(openPoll.text, /۴ رأی و پیشتاز «سبز» با ۳ رأی/);
        assert.strictEqual(openPoll.ref_message_id, 70);
        assert.match(closedPoll.text, /با آرای برابر بسته شد/);

        const facts = fullFacts();
        facts.pinned = null;
        facts.work = null;
        facts.polls = [];
        const [files, question, activity] = service.composeBullets(facts);
        assert.strictEqual(files.text, '۳ رسانه و ۱ فایل در گاوصندوق بارگذاری شد؛ تازه‌ترین: «render-4k.png».');
        assert.strictEqual(files.ref_message_id, 95);
        assert.strictEqual(question.text, 'پرسش بی‌پاسخ: «فایل لایه‌باز را کسی دارد؟»');
        assert.doesNotMatch(question.text, /تصمیم باز/);
        assert.strictEqual(activity.text, 'در این بازه ۱۲ پیام از ۳ نفر ثبت شد؛ بیشترین مشارکت با سارا احمدی.');
    } finally {
        restore();
    }
});

test('a tie for the busiest participant names nobody', () => {
    const { service, restore } = loadService();
    try {
        const [activity] = service.composeBullets({
            activity: {
                messageCount: 8,
                participants: 2,
                busiest: [{ name: 'الف', messages: 4 }, { name: 'ب', messages: 4 }]
            }
        });
        assert.strictEqual(activity.text, 'در این بازه ۸ پیام از ۲ نفر ثبت شد.');
    } finally {
        restore();
    }
});

test('the watermark starts after the previous covered message when many messages arrived', async () => {
    await withService(
        [
            [/FROM conversation_summaries WHERE/, [{
                target_type: 'channel', target_id: 3, is_manual: false, covered_to_message_id: 100,
                bullets: [], generated_at: new Date(Date.now() - 2 * 60 * 60 * 1000)
            }]],
            windowRoute({ newest_id: 300, floor_id: 251, first_new_id: 101 }),
            ...activityRoutes,
            [/INSERT INTO conversation_summaries/, (text, params) => savedRow(params)]
        ],
        async ({ service, queries }) => {
            const row = await service.refresh('channel', 3);
            const windowQuery = queries.find((q) => /AS newest_id/.test(q.text));
            assert.strictEqual(windowQuery.params[3], 100);
            assert.strictEqual(row.covered_from_message_id, 101);
            assert.strictEqual(row.covered_to_message_id, 300);
            assert.strictEqual(row.message_count, 12);
        }
    );
});

test('the floor keeps a useful span when only a few messages are new', async () => {
    await withService(
        [windowRoute({ newest_id: 130, floor_id: 81, first_new_id: 101 }), ...activityRoutes],
        async ({ service }) => {
            const digest = await service.computeDigest('channel', 3, { covered_to_message_id: 100 }, SETTINGS);
            assert.strictEqual(digest.coveredFromMessageId, 81);
            assert.strictEqual(digest.coveredToMessageId, 130);
        }
    );
});

test('a fresh summary is served from storage until enough new messages arrive', async () => {
    const stored = {
        target_type: 'group', target_id: 2, is_manual: false, covered_to_message_id: 50,
        bullets: [{ kind: 'activity', text: 'x', ref_message_id: null }], generated_at: new Date()
    };
    await withService(
        [[/FROM conversation_summaries WHERE/, [stored]], [/AS fresh/, [{ fresh: 3 }]]],
        async ({ service, queries }) => {
            const row = await service.refresh('group', 2);
            assert.strictEqual(row, stored);
            assert.ok(!queries.some((q) => /AS newest_id/.test(q.text)), 'no recompute while fresh');
        }
    );
});

test('a pinned manual summary blocks automatic and forced recomputation', async () => {
    const manual = {
        target_type: 'channel', target_id: 3, is_manual: true, covered_to_message_id: 10,
        bullets: [{ kind: 'manual', text: 'تصمیم نهایی', ref_message_id: null }],
        generated_at: new Date(0)
    };
    await withService([[/FROM conversation_summaries WHERE/, [manual]]], async ({ service, queries, broadcasts }) => {
        const row = await service.refresh('channel', 3, { force: true });
        assert.strictEqual(row, manual);
        assert.strictEqual(queries.length, 1);
        assert.strictEqual(broadcasts.length, 0);
    });
});

test('the automatic upsert never overwrites a manual summary', async () => {
    await withService(
        [windowRoute({ newest_id: 5, floor_id: 1, first_new_id: null }), ...activityRoutes],
        async ({ service, queries }) => {
            await service.refresh('conversation', 8, { force: true });
            const upsert = queries.find((q) => /INSERT INTO conversation_summaries/.test(q.text));
            assert.ok(upsert, 'auto summary written');
            assert.match(upsert.text, /WHERE conversation_summaries\.is_manual = false/);
        }
    );
});

test('when every family is empty nothing is stored and a stale automatic row is removed live', async () => {
    const stored = {
        target_type: 'conversation', target_id: 8, is_manual: false, covered_to_message_id: 4,
        bullets: [{ kind: 'activity', text: 'x', ref_message_id: null }], generated_at: new Date(0)
    };
    await withService(
        [[/FROM conversation_summaries WHERE/, [stored]], windowRoute({ newest_id: null, floor_id: null, first_new_id: null })],
        async ({ service, queries, broadcasts }) => {
            const row = await service.refresh('conversation', 8);
            assert.strictEqual(row, null);
            assert.ok(!queries.some((q) => /INSERT INTO conversation_summaries/.test(q.text)));
            assert.ok(queries.some((q) => /DELETE FROM conversation_summaries/.test(q.text) && /is_manual = false/.test(q.text)));
            assert.deepStrictEqual(broadcasts, [{ targetType: 'conversation', targetId: 8, summary: null }]);
        }
    );
});

test('a recompute broadcasts only when the bullets change', async () => {
    const bullets = [{ kind: 'activity', text: 'در این بازه ۱۲ پیام از ۳ نفر ثبت شد؛ بیشترین مشارکت با سارا احمدی.', ref_message_id: null }];
    const stored = {
        target_type: 'group', target_id: 2, is_manual: false, covered_to_message_id: 9,
        bullets, generated_at: new Date(0)
    };
    await withService(
        [
            [/FROM conversation_summaries WHERE/, [stored]],
            windowRoute({ newest_id: 9, floor_id: 1, first_new_id: null }),
            ...activityRoutes,
            [/INSERT INTO conversation_summaries/, (text, params) => savedRow(params)]
        ],
        async ({ service, broadcasts }) => {
            await service.refresh('group', 2, { force: true });
            assert.strictEqual(broadcasts.length, 0);
        }
    );
});

test('publishing a manual summary pins it to the publisher and broadcasts it', async () => {
    await withService(
        [[/INSERT INTO conversation_summaries/, (text, params) => [{
            target_type: params[0], target_id: params[1], bullets: JSON.parse(params[2]),
            is_manual: true, published_by: params[3], generated_at: new Date()
        }]]],
        async ({ service, queries, broadcasts }) => {
            const summary = await service.publishManual('channel', 3, 9, ['تصمیم اول']);
            const insert = queries.find((q) => /INSERT INTO conversation_summaries/.test(q.text));
            assert.match(insert.text, /is_manual = true/);
            assert.strictEqual(insert.params[3], 9);
            assert.deepStrictEqual(summary.bullets, [{ kind: 'manual', text: 'تصمیم اول', refMessageId: null }]);
            assert.strictEqual(summary.isManual, true);
            assert.strictEqual(broadcasts.length, 1);
        }
    );
});

test('clearing the pin resumes automatic recomputation', async () => {
    let manual = true;
    await withService(
        [
            [/UPDATE conversation_summaries SET is_manual = false/, () => {
                manual = false;
                return [{ id: 1 }];
            }],
            [/FROM conversation_summaries WHERE/, () => [{
                target_type: 'channel', target_id: 3, is_manual: manual, covered_to_message_id: 20,
                bullets: [{ kind: 'manual', text: 'دستی', ref_message_id: null }], generated_at: new Date()
            }]],
            windowRoute({ newest_id: 20, floor_id: 1, first_new_id: null }),
            ...activityRoutes,
            [/INSERT INTO conversation_summaries/, (text, params) => savedRow(params)]
        ],
        async ({ service, broadcasts }) => {
            const result = await service.clearManual('channel', 3);
            assert.strictEqual(result.cleared, true);
            assert.strictEqual(result.summary.isManual, false);
            assert.strictEqual(result.summary.bullets[0].kind, 'activity');
            assert.strictEqual(broadcasts.length, 1);
        }
    );
});

test('concurrent refreshes of one target share a single in-flight run', async () => {
    await withService(
        [windowRoute({ newest_id: 3, floor_id: 1, first_new_id: null }), ...activityRoutes,
            [/INSERT INTO conversation_summaries/, (text, params) => savedRow(params)]],
        async ({ service, queries }) => {
            const first = service.refreshTarget('channel', 1, { force: true });
            const second = service.refreshTarget('channel', 1);
            assert.strictEqual(first, second);
            await first;
            const reads = queries.filter((q) => /FROM conversation_summaries WHERE/.test(q.text));
            assert.strictEqual(reads.length, 2, 'the joined caller triggers one follow-up check, not a parallel run');
        }
    );
});
