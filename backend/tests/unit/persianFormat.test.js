const test = require('node:test');
const assert = require('node:assert');
const format = require('../../src/utils/persianFormat.util');

test('toPersianDigits converts every latin digit', () => {
    assert.strictEqual(format.toPersianDigits('1405/06/19'), '۱۴۰۵/۰۶/۱۹');
    assert.strictEqual(format.toPersianDigits(0), '۰');
});

test('gregorian dates map to the expected jalali date', () => {
    assert.strictEqual(format.jalaliDate(new Date('2026-09-10T09:00:00Z')), '۱۴۰۵/۰۶/۱۹');
    assert.strictEqual(format.jalaliDate(new Date('2025-03-21T09:00:00Z')), '۱۴۰۴/۰۱/۰۱');
});

test('day labels use امروز and فردا relative to now', () => {
    const now = new Date('2026-09-10T09:00:00Z');
    assert.ok(format.jalaliDayLabel(now, now).startsWith('امروز'));
    assert.ok(format.jalaliDayLabel(new Date('2026-09-11T09:00:00Z'), now).startsWith('فردا'));
    assert.ok(format.jalaliDayLabel(new Date('2026-09-09T09:00:00Z'), now).startsWith('دیروز'));
});

test('deadline labels count whole days and flag expiry', () => {
    const now = new Date('2026-09-10T09:00:00Z');
    assert.strictEqual(format.deadlineLabel(now, now), 'امروز');
    assert.strictEqual(format.deadlineLabel(new Date('2026-09-12T09:00:00Z'), now), '۲ روز تا انقضا');
    assert.strictEqual(format.deadlineLabel(new Date('2026-09-08T09:00:00Z'), now), 'منقضی شده');
    assert.strictEqual(format.deadlineLabel(null, now), 'بدون مهلت');
});

test('rials are grouped with the persian thousands separator', () => {
    assert.strictEqual(format.rials(48000000), '۴۸٬۰۰۰٬۰۰۰ ریال');
    assert.strictEqual(format.rials(null), null);
});

test('percent never divides by zero', () => {
    assert.strictEqual(format.percent(84, 100), '۸۴٪');
    assert.strictEqual(format.percent(3, 0), '۰٪');
});

test('initials take the first letter of the first two name parts', () => {
    assert.strictEqual(format.initials('سارا محمدی'), 'سم');
    assert.strictEqual(format.initials('لیلا'), 'لی');
    assert.strictEqual(format.initials(''), '؟');
});

test('reference ids keep the latin prefix and localise the number', () => {
    assert.strictEqual(format.referenceId('REQ', 1042), 'REQ-۱۰۴۲');
});
