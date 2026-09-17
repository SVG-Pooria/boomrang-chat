export type JalaliDate = { year: number; month: number; day: number };

export const JALALI_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

export const JALALI_WEEKDAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
export const GREGORIAN_WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function div(a: number, b: number) {
  return Math.floor(a / b);
}

function gregorianToJulian(year: number, month: number, day: number) {
  return (
    div((year + div(month - 8, 6) + 100100) * 1461, 4) +
    div(153 * ((month + 9) % 12) + 2, 5) +
    day -
    34840408 -
    div(div(year + 100100 + div(month - 8, 6), 100) * 3, 4) +
    752
  );
}

function julianToGregorian(julian: number) {
  let j = 4 * julian + 139361631;
  j = j + div(div(4 * julian + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div((j % 1461) / 4, 1) * 5 + 308;
  const day = div((i % 153) / 5, 1) + 1;
  const month = ((div(i, 153) % 4) + 1) | 0;
  const year = div(j, 1461) - 100100 + div(8 - month, 6);
  return { year, month, day };
}

function jalaliToJulian(year: number, month: number, day: number) {
  const base = year - (year >= 0 ? 474 : 473);
  const cycle = 474 + (base % 2820);
  return (
    day +
    (month <= 7 ? (month - 1) * 31 : (month - 1) * 30 + 6) +
    div(cycle * 682 - 110, 2816) +
    (cycle - 1) * 365 +
    div(base, 2820) * 1029983 +
    (1948320 - 1)
  );
}

function julianToJalali(julian: number) {
  const offset = julian - jalaliToJulian(475, 1, 1);
  const cycle = div(offset, 1029983);
  const remainder = offset % 1029983;
  let cycleYear;
  if (remainder === 1029982) {
    cycleYear = 2820;
  } else {
    const a = div(remainder, 366);
    const b = remainder % 366;
    cycleYear = div(2134 * a + 2816 * b + 2815, 1028522) + a + 1;
  }
  let year = cycleYear + 2820 * cycle + 474;
  if (year <= 0) {
    year -= 1;
  }
  const dayOfYear = julian - jalaliToJulian(year, 1, 1) + 1;
  const month = dayOfYear <= 186 ? Math.ceil(dayOfYear / 31) : Math.ceil((dayOfYear - 6) / 30);
  const day = julian - jalaliToJulian(year, month, 1) + 1;
  return { year, month, day };
}

export function toJalali(date: Date): JalaliDate {
  return julianToJalali(gregorianToJulian(date.getFullYear(), date.getMonth() + 1, date.getDate()));
}

export function fromJalali({ year, month, day }: JalaliDate): Date {
  const gregorian = julianToGregorian(jalaliToJulian(year, month, day));
  return new Date(gregorian.year, gregorian.month - 1, gregorian.day);
}

export function isJalaliLeapYear(year: number) {
  return daysInJalaliMonth(year, 12) === 30;
}

export function daysInJalaliMonth(year: number, month: number) {
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  const nextYearStart = jalaliToJulian(year + 1, 1, 1);
  const monthStart = jalaliToJulian(year, 12, 1);
  return nextYearStart - monthStart;
}

export function addJalaliMonths({ year, month, day }: JalaliDate, delta: number): JalaliDate {
  const total = (year * 12 + (month - 1) + delta) | 0;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return {
    year: nextYear,
    month: nextMonth,
    day: Math.min(day, daysInJalaliMonth(nextYear, nextMonth)),
  };
}

export function sameJalaliDay(a: JalaliDate, b: JalaliDate) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function startWeekdayOfJalaliMonth(year: number, month: number) {
  const first = fromJalali({ year, month, day: 1 });
  return (first.getDay() + 1) % 7;
}

export function startWeekdayOfGregorianMonth(year: number, month: number) {
  return new Date(year, month - 1, 1).getDay();
}

export function daysInGregorianMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function combineDateAndTime(date: Date, hours: number, minutes: number) {
  const combined = new Date(date);
  combined.setHours(hours, minutes, 0, 0);
  return combined;
}
