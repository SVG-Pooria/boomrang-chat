const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const format = require('../../src/utils/persianFormat.util');
const botService = require(path.join(__dirname, '..', '..', 'src', 'services', 'bot.service'));

test('file sizes read like the admin panel expects', () => {
    assert.equal(format.fileSize(1288490188), '۱٫۲ گیگابایت');
    assert.equal(format.fileSize(40 * 1024 * 1024), '۴۰ مگابایت');
    assert.equal(format.fileSize(500), '۵۰۰ بایت');
});

test('backup durations are spelled out in minutes and seconds', () => {
    assert.equal(format.elapsed(134), '۲ دقیقه و ۱۴ ثانیه');
    assert.equal(format.elapsed(122), '۲ دقیقه و ۰۲ ثانیه');
    assert.equal(format.elapsed(48), '۴۸ ثانیه');
    assert.equal(format.elapsed(0), 'کمتر از یک ثانیه');
});

test('large counts are grouped with the Persian thousands separator', () => {
    assert.equal(format.groupDigits(1240), '۱٬۲۴۰');
});

test('reminder schedules are described the way people say them', () => {
    assert.equal(
        botService.scheduleLabel({ repeat_daily_at: '16:30', repeat_days: [0, 1, 2, 3, 6] }),
        'هر روز کاری، ۱۶:۳۰'
    );
    assert.equal(botService.scheduleLabel({ repeat_daily_at: '08:00', repeat_days: null }), 'هر روز، ۰۸:۰۰');
    assert.equal(botService.scheduleLabel({ repeat_daily_at: '10:00', repeat_days: [0] }), 'یک‌شنبه‌ها، ۱۰:۰۰');
});

test('a weekday reminder only runs on its days in Tehran time', () => {
    assert.equal(botService.runsOn([6], new Date('2026-09-12T08:00:00Z')), true);
    assert.equal(botService.runsOn([0, 1, 2, 3, 6], new Date('2026-09-11T08:00:00Z')), false);
    assert.equal(botService.runsOn(null, new Date('2026-09-11T08:00:00Z')), true);
});
