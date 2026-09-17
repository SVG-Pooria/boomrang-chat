import { CalendarDays, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n";
import {
  JALALI_MONTHS,
  JALALI_WEEKDAYS,
  GREGORIAN_WEEKDAYS,
  addJalaliMonths,
  daysInGregorianMonth,
  daysInJalaliMonth,
  fromJalali,
  sameJalaliDay,
  startWeekdayOfGregorianMonth,
  startWeekdayOfJalaliMonth,
  toJalali,
  type JalaliDate,
} from "@/lib/jalali";
import { cn } from "@/lib/utils";

const GREGORIAN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function cellsFor(language: string, cursor: JalaliDate) {
  if (language === "fa") {
    const lead = startWeekdayOfJalaliMonth(cursor.year, cursor.month);
    const count = daysInJalaliMonth(cursor.year, cursor.month);
    return { lead, count };
  }
  const lead = startWeekdayOfGregorianMonth(cursor.year, cursor.month);
  const count = daysInGregorianMonth(cursor.year, cursor.month);
  return { lead, count };
}

function cursorFromDate(language: string, date: Date): JalaliDate {
  if (language === "fa") return toJalali(date);
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

function dateFromCursor(language: string, cursor: JalaliDate, day: number) {
  if (language === "fa") return fromJalali({ ...cursor, day });
  return new Date(cursor.year, cursor.month - 1, day);
}

function shiftMonth(language: string, cursor: JalaliDate, delta: number): JalaliDate {
  if (language === "fa") return addJalaliMonths(cursor, delta);
  const date = new Date(cursor.year, cursor.month - 1 + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: 1 };
}

export function DatePicker({
  value,
  onChange,
  placeholder,
}: {
  value: Date | null;
  onChange: (value: Date | null) => void;
  placeholder?: string;
}) {
  const { t, language, digits, day: formatDay } = useI18n();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<JalaliDate>(() =>
    cursorFromDate(language, value ?? new Date()),
  );
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCursor(cursorFromDate(language, value ?? new Date()));
  }, [language, value]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      if (container.current && !container.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const today = useMemo(() => cursorFromDate(language, new Date()), [language, open]);
  const selected = value ? cursorFromDate(language, value) : null;
  const { lead, count } = cellsFor(language, cursor);
  const weekdays = language === "fa" ? JALALI_WEEKDAYS : GREGORIAN_WEEKDAYS;
  const monthLabel =
    language === "fa" ? JALALI_MONTHS[cursor.month - 1] : GREGORIAN_MONTHS[cursor.month - 1];

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex w-full items-center gap-2 rounded-2xl border border-chat-panel-border bg-white/70 px-3 py-2.5 text-start text-[12.5px] transition-colors hover:bg-white",
          value ? "text-chat-ink" : "text-chat-ink-soft",
        )}
      >
        <CalendarDays className="size-4 shrink-0 text-chat-violet" />
        <span className="flex-1 truncate">
          {value
            ? formatDay(value, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
            : (placeholder ?? t("انتخاب تاریخ"))}
        </span>
        {value ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label={t("پاک کردن")}
            onClick={(event) => {
              event.stopPropagation();
              onChange(null);
            }}
            className="grid size-5 place-items-center rounded-full text-chat-ink-soft transition-colors hover:bg-chat-ink/8 hover:text-chat-ink"
          >
            <X className="size-3" />
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute inset-x-0 top-[calc(100%+8px)] z-40 rounded-[22px] border border-chat-panel-border bg-chat-surface p-3 shadow-[0_28px_70px_-32px_oklch(0.2_0.05_288/0.65)]">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label={t("ماه قبل")}
              onClick={() => setCursor((current) => shiftMonth(language, current, -1))}
              className="grid size-8 place-items-center rounded-full text-chat-ink-soft transition-colors hover:bg-chat-ink/6 hover:text-chat-ink"
            >
              <ChevronRight className="size-4 ltr:hidden" />
              <ChevronLeft className="size-4 rtl:hidden" />
            </button>
            <p className="text-[12.5px] font-bold">
              {monthLabel} {digits(cursor.year)}
            </p>
            <button
              type="button"
              aria-label={t("ماه بعد")}
              onClick={() => setCursor((current) => shiftMonth(language, current, 1))}
              className="grid size-8 place-items-center rounded-full text-chat-ink-soft transition-colors hover:bg-chat-ink/6 hover:text-chat-ink"
            >
              <ChevronLeft className="size-4 ltr:hidden" />
              <ChevronRight className="size-4 rtl:hidden" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {weekdays.map((weekday) => (
              <span key={weekday} className="py-1 text-[10px] font-bold text-chat-ink-soft">
                {weekday}
              </span>
            ))}
            {Array.from({ length: lead }).map((_, index) => (
              <span key={`lead-${index}`} />
            ))}
            {Array.from({ length: count }).map((_, index) => {
              const dayNumber = index + 1;
              const cell = { ...cursor, day: dayNumber };
              const isToday = sameJalaliDay(cell, today);
              const isSelected = selected !== null && sameJalaliDay(cell, selected);
              return (
                <button
                  key={dayNumber}
                  type="button"
                  onClick={() => {
                    onChange(dateFromCursor(language, cursor, dayNumber));
                    setOpen(false);
                  }}
                  className={cn(
                    "grid h-8 place-items-center rounded-xl text-[12px] font-semibold transition-colors",
                    isSelected
                      ? "bg-chat-violet text-chat-on-accent"
                      : isToday
                        ? "bg-chat-mint/18 text-chat-mint-deep"
                        : "text-chat-ink hover:bg-chat-ink/6",
                  )}
                >
                  {digits(dayNumber)}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-chat-panel-border pt-2">
            <button
              type="button"
              onClick={() => {
                onChange(new Date());
                setOpen(false);
              }}
              className="rounded-full px-3 py-1 text-[11px] font-bold text-chat-mint-deep transition-colors hover:bg-chat-mint/12"
            >
              {t("امروز")}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full px-3 py-1 text-[11px] font-bold text-chat-ink-soft transition-colors hover:bg-chat-ink/6 hover:text-chat-ink"
            >
              {t("بستن")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stepper({
  value,
  max,
  label,
  onChange,
}: {
  value: number;
  max: number;
  label: string;
  onChange: (value: number) => void;
}) {
  const { digits } = useI18n();
  const wrap = (next: number) => ((next % (max + 1)) + (max + 1)) % (max + 1);
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        aria-label={`${label} +`}
        onClick={() => onChange(wrap(value + 1))}
        className="grid size-7 place-items-center rounded-lg text-chat-ink-soft transition-colors hover:bg-chat-ink/6 hover:text-chat-ink"
      >
        <ChevronUp className="size-4" />
      </button>
      <span
        onWheel={(event) => {
          event.preventDefault();
          onChange(wrap(value + (event.deltaY < 0 ? 1 : -1)));
        }}
        className="grid h-11 w-14 place-items-center rounded-xl bg-white/80 font-display text-[18px] font-semibold tabular-nums text-chat-ink shadow-[inset_0_0_0_1px_var(--chat-panel-border)]"
      >
        {digits(String(value).padStart(2, "0"))}
      </span>
      <button
        type="button"
        aria-label={`${label} -`}
        onClick={() => onChange(wrap(value - 1))}
        className="grid size-7 place-items-center rounded-lg text-chat-ink-soft transition-colors hover:bg-chat-ink/6 hover:text-chat-ink"
      >
        <ChevronDown className="size-4" />
      </button>
    </div>
  );
}

export function TimePicker({
  hours,
  minutes,
  onChange,
}: {
  hours: number;
  minutes: number;
  onChange: (hours: number, minutes: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-3 rounded-2xl border border-chat-panel-border bg-white/55 p-3">
      <div className="text-center">
        <Stepper
          value={hours}
          max={23}
          label={t("ساعت")}
          onChange={(next) => onChange(next, minutes)}
        />
        <p className="mt-1 text-[10px] font-bold text-chat-ink-soft">{t("ساعت")}</p>
      </div>
      <span className="pb-5 font-display text-[18px] text-chat-ink-soft">:</span>
      <div className="text-center">
        <Stepper
          value={minutes}
          max={59}
          label={t("دقیقه")}
          onChange={(next) => onChange(hours, next)}
        />
        <p className="mt-1 text-[10px] font-bold text-chat-ink-soft">{t("دقیقه")}</p>
      </div>
    </div>
  );
}
