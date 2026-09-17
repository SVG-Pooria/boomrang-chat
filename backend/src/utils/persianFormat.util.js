const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const JALALI_MONTHS = [
    'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
];
const WEEKDAYS = ['یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const TIMEZONE = 'Asia/Tehran';

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short'
});

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});

const clockFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
});

function toPersianDigits(value) {
    return String(value).replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

function gregorianParts(date) {
    const [year, month, day] = partsFormatter.format(date).split('-').map(Number);
    return { year, month, day };
}

function div(a, b) {
    return Math.floor(a / b);
}

function gregorianToJalali(gy, gm, gd) {
    const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let jy = gy <= 1600 ? 0 : 979;
    const gy2 = gy <= 1600 ? gy - 621 : gy - 1600;
    const gm2 = gm > 2 ? gy2 + 1 : gy2;
    let days =
        365 * gy2 +
        div(gm2 + 3, 4) -
        div(gm2 + 99, 100) +
        div(gm2 + 399, 400) -
        80 +
        gd +
        g_d_m[gm - 1];
    jy += 33 * div(days, 12053);
    days %= 12053;
    jy += 4 * div(days, 1461);
    days %= 1461;
    if (days > 365) {
        jy += div(days - 1, 365);
        days = (days - 1) % 365;
    }
    const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
    const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
    return { jy, jm, jd };
}

function toJalali(date) {
    const { year, month, day } = gregorianParts(date);
    return gregorianToJalali(year, month, day);
}

function jalaliDate(date) {
    const { jy, jm, jd } = toJalali(date);
    const padded = String(jm).padStart(2, '0') + '/' + String(jd).padStart(2, '0');
    return toPersianDigits(`${jy}/${padded}`);
}

function dayKey(date) {
    return partsFormatter.format(date);
}

function daysBetween(from, to) {
    const start = Date.parse(`${dayKey(from)}T00:00:00Z`);
    const end = Date.parse(`${dayKey(to)}T00:00:00Z`);
    return Math.round((end - start) / 86400000);
}

function jalaliDayLabel(date, now = new Date()) {
    const diff = daysBetween(now, date);
    const { jm, jd } = toJalali(date);
    const monthDay = `${toPersianDigits(jd)} ${JALALI_MONTHS[jm - 1]}`;
    if (diff === 0) {
        return `امروز، ${monthDay}`;
    }
    if (diff === 1) {
        return `فردا، ${monthDay}`;
    }
    if (diff === -1) {
        return `دیروز، ${monthDay}`;
    }
    return monthDay;
}

function clock(date) {
    return toPersianDigits(clockFormatter.format(date));
}

function timeRange(startsAt, endsAt) {
    return `${clock(startsAt)} تا ${clock(endsAt)}`;
}

function relativeTime(date, now = new Date()) {
    const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
    if (seconds < 60) {
        return 'همین حالا';
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${toPersianDigits(minutes)} دقیقه پیش`;
    }
    const dayDiff = daysBetween(date, now);
    if (dayDiff === 0) {
        return `${toPersianDigits(Math.round(minutes / 60))} ساعت پیش`;
    }
    if (dayDiff === 1) {
        return 'دیروز';
    }
    return `${toPersianDigits(dayDiff)} روز پیش`;
}

function dayClock(date, now = new Date()) {
    const diff = daysBetween(date, now);
    if (diff === 0) {
        return `امروز، ${clock(date)}`;
    }
    if (diff === 1) {
        return `دیروز، ${clock(date)}`;
    }
    return `${toPersianDigits(diff)} روز پیش`;
}

function weekdayIndex(date) {
    return WEEKDAY_INDEX[weekdayFormatter.format(date)];
}

function weekdayName(date) {
    return WEEKDAYS[weekdayIndex(date)];
}

function durationLabel(milliseconds) {
    const minutes = Math.max(1, Math.round(milliseconds / 60000));
    if (minutes < 60) {
        return `${toPersianDigits(minutes)} دقیقه`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 48) {
        return `${toPersianDigits(hours)} ساعت`;
    }
    return `${toPersianDigits(Math.round(hours / 24))} روز`;
}

function deadlineLabel(deadlineAt, now = new Date()) {
    if (!deadlineAt) {
        return 'بدون مهلت';
    }
    const diff = daysBetween(now, deadlineAt);
    if (diff < 0) {
        return 'منقضی شده';
    }
    if (diff === 0) {
        return 'امروز';
    }
    return `${toPersianDigits(diff)} روز تا انقضا`;
}

function dueLabel(dueAt, now = new Date()) {
    if (!dueAt) {
        return 'بدون مهلت';
    }
    const diff = daysBetween(now, dueAt);
    if (diff === 0) {
        return `امروز ${clock(dueAt)}`;
    }
    if (diff === 1) {
        return `فردا ${clock(dueAt)}`;
    }
    if (diff === -1) {
        return 'دیروز';
    }
    if (diff < 0) {
        return `${toPersianDigits(Math.abs(diff))} روز پیش`;
    }
    return `${jalaliDayLabel(dueAt, now)} ${clock(dueAt)}`;
}

function rials(amount) {
    if (amount === null || amount === undefined) {
        return null;
    }
    const grouped = String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
    return `${toPersianDigits(grouped)} ریال`;
}

function percent(part, total) {
    if (!total) {
        return toPersianDigits(0) + '٪';
    }
    return `${toPersianDigits(Math.round((part / total) * 100))}٪`;
}

function initials(fullName) {
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
        return '؟';
    }
    if (parts.length === 1) {
        return parts[0].slice(0, 2);
    }
    return `${parts[0][0]}${parts[1][0]}`;
}

function referenceId(prefix, id) {
    return `${prefix}-${toPersianDigits(id)}`;
}

function groupDigits(value) {
    return toPersianDigits(String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '٬'));
}

function monthDay(date) {
    const { jm, jd } = toJalali(date);
    return `${toPersianDigits(jd)} ${JALALI_MONTHS[jm - 1]}`;
}

function dayStamp(date, now = new Date()) {
    const diff = daysBetween(date, now);
    if (diff === 0) {
        return `امروز، ${clock(date)}`;
    }
    if (diff === 1) {
        return `دیروز، ${clock(date)}`;
    }
    if (diff > 1 && diff < 7) {
        return `${toPersianDigits(diff)} روز پیش، ${clock(date)}`;
    }
    return `${monthDay(date)}، ${clock(date)}`;
}

function decimal(value) {
    const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
    return toPersianDigits(String(rounded).replace('.', '٫'));
}

function fileSize(bytes) {
    const value = Number(bytes) || 0;
    const units = [
        [1024 ** 3, 'گیگابایت'],
        [1024 ** 2, 'مگابایت'],
        [1024, 'کیلوبایت']
    ];
    for (const [size, label] of units) {
        if (value >= size) {
            return `${decimal(value / size)} ${label}`;
        }
    }
    return `${toPersianDigits(value)} بایت`;
}

function elapsed(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    if (total < 1) {
        return 'کمتر از یک ثانیه';
    }
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    if (minutes === 0) {
        return `${toPersianDigits(rest)} ثانیه`;
    }
    if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        const remainder = minutes % 60;
        return remainder ? `${toPersianDigits(hours)} ساعت و ${toPersianDigits(remainder)} دقیقه` : `${toPersianDigits(hours)} ساعت`;
    }
    return rest
        ? `${toPersianDigits(minutes)} دقیقه و ${toPersianDigits(String(rest).padStart(2, '0'))} ثانیه`
        : `${toPersianDigits(minutes)} دقیقه`;
}

module.exports = {
    TIMEZONE,
    JALALI_MONTHS,
    WEEKDAYS,
    groupDigits,
    monthDay,
    dayStamp,
    fileSize,
    elapsed,
    toPersianDigits,
    toJalali,
    jalaliDate,
    jalaliDayLabel,
    clock,
    timeRange,
    relativeTime,
    dayClock,
    weekdayIndex,
    weekdayName,
    durationLabel,
    deadlineLabel,
    dueLabel,
    daysBetween,
    dayKey,
    rials,
    percent,
    initials,
    referenceId
};
