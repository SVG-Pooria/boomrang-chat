import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Plus,
  Search,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DatePicker, TimePicker } from "@/components/ui/date-picker";
import { GlassDialog } from "@/components/ui/glass-dialog";
import { UserAvatar } from "@/components/ui/user-avatar";
import { readSession } from "@/lib/auth";
import { getSocket } from "@/lib/chat";
import { useI18n } from "@/lib/i18n";
import { combineDateAndTime } from "@/lib/jalali";
import {
  cancelMeeting,
  confirmAttendance,
  createMeeting,
  fetchMeetings,
  markAttendance,
  type MeetingItem,
  type MeetingScope,
  type MeetingStatus,
} from "@/lib/meetings";
import type { TaskCapabilities } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { fetchDirectory, type Person } from "@/lib/workspace";

const STATUS_TONE: Record<MeetingStatus, string> = {
  امروز: "bg-chat-mint/18 text-chat-mint-deep",
  آینده: "bg-chat-sky/16 text-chat-sky-deep",
  "برگزار شده": "bg-chat-ink/8 text-chat-ink-soft",
  "لغو شده": "bg-chat-rose/12 text-chat-rose",
};

const DURATIONS = [30, 45, 60, 90, 120];

function MeetingCard({
  meeting,
  viewerId,
  onOpen,
}: {
  meeting: MeetingItem;
  viewerId: number | null;
  onOpen: () => void;
}) {
  const { t, digits, day, clock, language } = useI18n();
  const mine = meeting.participants.find((person) => person.userId === viewerId);
  const time =
    language === "fa" ? meeting.time : `${clock(meeting.startsAt)} — ${clock(meeting.endsAt)}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-[20px] border border-chat-panel-border bg-white/70 px-3 py-2.5 text-start transition-colors hover:bg-white"
    >
      <span className="grid w-12 shrink-0 place-items-center rounded-xl bg-chat-violet/10 py-1.5 text-center text-chat-violet">
        <span className="font-display text-[17px] font-bold leading-none">
          {day(meeting.startsAt, { day: "numeric" })}
        </span>
        <span className="mt-0.5 text-[9.5px] font-bold">
          {day(meeting.startsAt, { month: "long" })}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-chat-ink">
            {meeting.title}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
              STATUS_TONE[meeting.status],
            )}
          >
            {t(meeting.status)}
          </span>
          {mine && meeting.status !== "برگزار شده" ? (
            <span
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                mine.confirmed
                  ? "bg-chat-mint/18 text-chat-mint-deep"
                  : "bg-chat-lemon/20 text-chat-lemon",
              )}
            >
              {mine.confirmed ? <CheckCircle2 className="size-3" /> : <Clock className="size-3" />}
              {mine.confirmed ? t("حضور تأیید شد") : t("در انتظار تأیید حضور")}
            </span>
          ) : null}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-chat-ink-soft">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {time}
          </span>
          <span className="flex items-center gap-1">
            <MapPin className="size-3" />
            {meeting.location}
          </span>
          <span className="flex items-center gap-1">
            <Users className="size-3" />
            {t("{count} نفر", { count: digits(meeting.attendeeCount) })}
          </span>
          <span className="flex items-center gap-1">
            {meeting.participants.slice(0, 4).map((person) => (
              <UserAvatar key={person.userId} name={person.name} seed={person.userId} size={18} />
            ))}
            {meeting.attendeeCount > 4 ? (
              <span className="text-[10.5px]">+{digits(meeting.attendeeCount - 4)}</span>
            ) : null}
          </span>
        </span>
      </span>
    </button>
  );
}

export function MeetingsBoard() {
  const { t, digits, day, clock } = useI18n();
  const session = readSession();
  const viewerId = session?.user.id ?? null;

  const [scope, setScope] = useState<MeetingScope>("participant");
  const [meetings, setMeetings] = useState<MeetingItem[]>([]);
  const [capabilities, setCapabilities] = useState<TaskCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [peopleQuery, setPeopleQuery] = useState("");
  const [attendance, setAttendance] = useState<number[]>([]);
  const [draft, setDraft] = useState<{
    title: string;
    date: Date | null;
    hours: number;
    minutes: number;
    duration: number;
    location: string;
    description: string;
    attendeeIds: number[];
  }>({
    title: "",
    date: new Date(),
    hours: 10,
    minutes: 0,
    duration: 60,
    location: "",
    description: "",
    attendeeIds: [],
  });

  const load = useCallback(
    async (nextScope: MeetingScope) => {
      try {
        const result = await fetchMeetings(nextScope);
        setMeetings(result.meetings);
        setCapabilities(result.capabilities);
      } catch {
        toast.error(t("بارگذاری جلسات ناموفق بود"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    setLoading(true);
    void load(scope);
  }, [load, scope]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onChanged = (payload: { section?: string }) => {
      if (!payload?.section || payload.section === "meetings") void load(scope);
    };
    socket.on("workspace:changed", onChanged);
    return () => {
      socket.off("workspace:changed", onChanged);
    };
  }, [load, scope]);

  useEffect(() => {
    if (!createOpen || people.length) return;
    fetchDirectory()
      .then(setPeople)
      .catch(() => toast.error(t("بارگذاری فهرست همکاران ناموفق بود")));
  }, [createOpen, people.length, t]);

  const meeting = useMemo(
    () => meetings.find((item) => item.meetingId === openId) ?? null,
    [meetings, openId],
  );

  useEffect(() => {
    if (!meeting) return;
    setAttendance(
      meeting.participants.filter((person) => person.attended).map((person) => person.userId),
    );
  }, [meeting]);

  const scopes: { id: MeetingScope; label: string }[] = [
    { id: "participant", label: "دعوت‌شده" },
    { id: "organizer", label: "برگزارکننده" },
    ...(capabilities?.manageTeam ? [{ id: "all" as const, label: "همهٔ جلسات" }] : []),
  ];

  const isOrganizer =
    meeting !== null && (meeting.ownerId === viewerId || capabilities?.executive === true);
  const mine = meeting?.participants.find((person) => person.userId === viewerId) ?? null;

  const run = (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    action()
      .then(() => load(scope))
      .catch(() => toast.error(t(failure)))
      .finally(() => setBusy(false));
  };

  const submitCreate = () => {
    if (!draft.title.trim() || !draft.date) {
      toast.error(t("عنوان و تاریخ جلسه الزامی است"));
      return;
    }
    const start = combineDateAndTime(draft.date, draft.hours, draft.minutes);
    const end = new Date(start.getTime() + draft.duration * 60000);
    setBusy(true);
    createMeeting({
      title: draft.title.trim(),
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      location: draft.location.trim(),
      description: draft.description.trim(),
      attendeeIds: draft.attendeeIds,
    })
      .then(() => {
        toast.success(t("جلسه ثبت شد"));
        setCreateOpen(false);
        setDraft({
          title: "",
          date: new Date(),
          hours: 10,
          minutes: 0,
          duration: 60,
          location: "",
          description: "",
          attendeeIds: [],
        });
        return load(scope);
      })
      .catch(() => toast.error(t("ثبت جلسه ناموفق بود")))
      .finally(() => setBusy(false));
  };

  const filteredPeople = people.filter(
    (person) =>
      person.userId !== viewerId &&
      (peopleQuery.trim() === "" || person.name.includes(peopleQuery.trim())),
  );

  return (
    <section className="panel flex h-full min-h-0 flex-col overflow-hidden rounded-[26px]">
      <header className="flex shrink-0 items-center gap-3 border-b border-chat-panel-border px-4 py-3">
        <span className="grid size-9 place-items-center rounded-2xl bg-chat-sky/14 text-chat-sky-deep">
          <CalendarDays className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[14.5px] font-semibold">{t("جلسات")}</p>
          <p className="truncate text-[11px] text-chat-ink-soft">
            {t("زمان‌بندی، دعوت و حضور و غیاب جلسه‌های سازمان")}
          </p>
        </div>
        {capabilities?.scheduleMeetings ? (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 rounded-full bg-chat-ink px-3.5 py-2 text-[11.5px] font-bold text-chat-on-ink transition-opacity hover:opacity-90"
          >
            <Plus className="size-3.5" />
            {t("جلسهٔ جدید")}
          </button>
        ) : null}
      </header>

      <div className="flex shrink-0 gap-1.5 overflow-x-auto px-4 py-3">
        {scopes.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setScope(item.id)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-[11.5px] font-bold transition-colors",
              scope === item.id
                ? "bg-chat-ink text-chat-on-ink"
                : "border border-chat-panel-border bg-white/60 text-chat-ink-soft hover:bg-white hover:text-chat-ink",
            )}
          >
            {t(item.label)}
          </button>
        ))}
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="grid h-full place-items-center">
            <Loader2 className="size-5 animate-spin text-chat-ink-soft" />
          </div>
        ) : meetings.length === 0 ? (
          <p className="py-16 text-center text-[12px] text-chat-ink-soft">
            {t("جلسه‌ای ثبت نشده است.")}
          </p>
        ) : (
          meetings.map((item) => (
            <MeetingCard
              key={item.meetingId}
              meeting={item}
              viewerId={viewerId}
              onOpen={() => setOpenId(item.meetingId)}
            />
          ))
        )}
      </div>

      <GlassDialog
        open={meeting !== null}
        onClose={() => setOpenId(null)}
        title={meeting?.title ?? ""}
        description={meeting ? t("برگزارکننده: {name}", { name: meeting.organizer }) : ""}
        size="lg"
      >
        {meeting ? (
          <div className="custom-scrollbar grid max-h-[62dvh] gap-3.5 overflow-y-auto pe-1">
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-chat-ink-soft">
              <span
                className={cn("rounded-full px-2.5 py-1 font-bold", STATUS_TONE[meeting.status])}
              >
                {t(meeting.status)}
              </span>
              <span className="flex items-center gap-1">
                <CalendarDays className="size-3.5" />
                {day(meeting.startsAt, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" />
                {clock(meeting.startsAt)} — {clock(meeting.endsAt)}
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" />
                {meeting.location}
              </span>
            </div>

            {meeting.description ? (
              <p className="rounded-2xl border border-chat-panel-border bg-white/55 p-3 text-[12.5px] leading-relaxed text-chat-ink">
                {meeting.description}
              </p>
            ) : null}

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[11.5px] font-bold text-chat-ink-soft">{t("شرکت‌کنندگان")}</p>
                <p className="text-[11px] text-chat-ink-soft">
                  {t("{confirmed} از {total} تأیید کرده‌اند", {
                    confirmed: digits(meeting.confirmedCount),
                    total: digits(meeting.attendeeCount),
                  })}
                </p>
              </div>
              <div className="grid gap-1.5">
                {meeting.participants.map((person) => (
                  <div
                    key={person.userId}
                    className="flex items-center gap-2 rounded-2xl border border-chat-panel-border bg-white/55 px-3 py-2"
                  >
                    <UserAvatar name={person.name} seed={person.userId} size={26} />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-chat-ink">
                      {person.name}
                    </span>
                    {person.confirmed ? (
                      <span className="shrink-0 rounded-full bg-chat-mint/16 px-2 py-0.5 text-[10px] font-bold text-chat-mint-deep">
                        {t("تأیید حضور")}
                      </span>
                    ) : null}
                    {isOrganizer && meeting.status !== "آینده" ? (
                      <label className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold text-chat-ink-soft">
                        <input
                          type="checkbox"
                          checked={attendance.includes(person.userId)}
                          onChange={(event) =>
                            setAttendance((current) =>
                              event.target.checked
                                ? [...current, person.userId]
                                : current.filter((id) => id !== person.userId),
                            )
                          }
                          className="size-3.5 accent-[var(--chat-mint)]"
                        />
                        {t("حاضر بود")}
                      </label>
                    ) : person.attended ? (
                      <span className="shrink-0 rounded-full bg-chat-sky/14 px-2 py-0.5 text-[10px] font-bold text-chat-sky-deep">
                        {t("حاضر")}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-chat-panel-border pt-3">
              {mine && meeting.status !== "برگزار شده" && !meeting.canceled ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => confirmAttendance(meeting.meetingId, !mine.confirmed),
                      "ثبت حضور ناموفق بود",
                    )
                  }
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-bold transition-opacity hover:opacity-90 disabled:opacity-50",
                    mine.confirmed
                      ? "border border-chat-panel-border bg-white/70 text-chat-ink"
                      : "bg-chat-mint text-chat-on-accent",
                  )}
                >
                  <CheckCircle2 className="size-4" />
                  {mine.confirmed ? t("لغو تأیید حضور") : t("حضور در جلسه")}
                </button>
              ) : null}
              {isOrganizer && meeting.status !== "آینده" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => markAttendance(meeting.meetingId, attendance),
                      "ثبت حاضران ناموفق بود",
                    )
                  }
                  className="flex items-center gap-1.5 rounded-full bg-chat-ink px-4 py-2 text-[12px] font-bold text-chat-on-ink transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <UserCheck className="size-4" />
                  {t("ثبت حاضران")}
                </button>
              ) : null}
              {isOrganizer && !meeting.canceled && meeting.status !== "برگزار شده" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCancelId(meeting.meetingId)}
                  className="ms-auto flex items-center gap-1.5 rounded-full border border-chat-panel-border bg-white/70 px-4 py-2 text-[12px] font-bold text-chat-rose transition-colors hover:bg-white disabled:opacity-50"
                >
                  <XCircle className="size-4" />
                  {t("لغو جلسه")}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </GlassDialog>

      <GlassDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t("جلسهٔ جدید")}
        description={t("زمان، مکان و شرکت‌کنندگان جلسه را مشخص کنید.")}
        size="lg"
      >
        <div className="custom-scrollbar grid max-h-[62dvh] gap-3 overflow-y-auto pe-1">
          <label className="grid gap-1.5">
            <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("عنوان جلسه")}</span>
            <input
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
              className="rounded-2xl border border-chat-panel-border bg-white/70 px-3 py-2.5 text-[12.5px] text-chat-ink outline-none focus:bg-white"
              dir="auto"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("روز برگزاری")}</span>
              <DatePicker
                value={draft.date}
                onChange={(value) => setDraft((current) => ({ ...current, date: value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("ساعت شروع")}</span>
              <TimePicker
                hours={draft.hours}
                minutes={draft.minutes}
                onChange={(hours, minutes) =>
                  setDraft((current) => ({ ...current, hours, minutes }))
                }
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("مدت جلسه")}</span>
            <div className="flex flex-wrap gap-1.5">
              {DURATIONS.map((duration) => (
                <button
                  key={duration}
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, duration }))}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[11.5px] font-bold transition-colors",
                    draft.duration === duration
                      ? "bg-chat-violet text-chat-on-accent"
                      : "border border-chat-panel-border bg-white/60 text-chat-ink-soft hover:bg-white hover:text-chat-ink",
                  )}
                >
                  {t("{count} دقیقه", { count: digits(duration) })}
                </button>
              ))}
            </div>
          </div>

          <label className="grid gap-1.5">
            <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("مکان")}</span>
            <input
              value={draft.location}
              onChange={(event) =>
                setDraft((current) => ({ ...current, location: event.target.value }))
              }
              placeholder={t("اتاق جلسات طبقهٔ سوم")}
              className="rounded-2xl border border-chat-panel-border bg-white/70 px-3 py-2.5 text-[12.5px] text-chat-ink outline-none placeholder:text-chat-ink-soft focus:bg-white"
              dir="auto"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("دستور جلسه")}</span>
            <textarea
              rows={3}
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
              className="resize-none rounded-2xl border border-chat-panel-border bg-white/70 px-3 py-2.5 text-[12.5px] leading-relaxed text-chat-ink outline-none focus:bg-white"
              dir="auto"
            />
          </label>

          <div className="grid gap-1.5">
            <span className="text-[11.5px] font-bold text-chat-ink-soft">
              {t("شرکت‌کنندگان")} ({digits(draft.attendeeIds.length)})
            </span>
            <div className="flex items-center gap-2 rounded-2xl border border-chat-panel-border bg-white/70 px-3 py-2">
              <Search className="size-3.5 text-chat-ink-soft" />
              <input
                value={peopleQuery}
                onChange={(event) => setPeopleQuery(event.target.value)}
                placeholder={t("جستجوی همکار...")}
                className="w-full bg-transparent text-[12px] text-chat-ink outline-none placeholder:text-chat-ink-soft"
              />
            </div>
            <div className="custom-scrollbar grid max-h-44 gap-1 overflow-y-auto">
              {filteredPeople.map((person) => {
                const checked = draft.attendeeIds.includes(person.userId);
                return (
                  <button
                    key={person.userId}
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        attendeeIds: checked
                          ? current.attendeeIds.filter((id) => id !== person.userId)
                          : [...current.attendeeIds, person.userId],
                      }))
                    }
                    className={cn(
                      "flex items-center gap-2 rounded-2xl border px-3 py-2 text-start transition-colors",
                      checked
                        ? "border-chat-mint/40 bg-chat-mint/10"
                        : "border-chat-panel-border bg-white/55 hover:bg-white",
                    )}
                  >
                    <UserAvatar
                      name={person.name}
                      src={person.avatarUrl}
                      seed={person.userId}
                      size={26}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-bold text-chat-ink">
                        {person.name}
                      </span>
                      <span className="block truncate text-[10.5px] text-chat-ink-soft">
                        {person.role} — {person.unit}
                      </span>
                    </span>
                    {checked ? (
                      <CheckCircle2 className="size-4 shrink-0 text-chat-mint-deep" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={submitCreate}
              className="rounded-full bg-chat-ink px-4 py-2 text-[12px] font-bold text-chat-on-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t("ثبت جلسه")}
            </button>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-full border border-chat-panel-border bg-white/60 px-4 py-2 text-[12px] font-bold text-chat-ink-soft transition-colors hover:bg-white hover:text-chat-ink"
            >
              {t("انصراف")}
            </button>
          </div>
        </div>
      </GlassDialog>

      <ConfirmDialog
        open={cancelId !== null}
        title={t("لغو جلسه")}
        description={t("جلسه برای همهٔ شرکت‌کنندگان لغو می‌شود.")}
        confirmLabel={t("لغو جلسه")}
        busy={busy}
        onConfirm={() => {
          const target = cancelId;
          setCancelId(null);
          setOpenId(null);
          if (target) run(() => cancelMeeting(target), "لغو جلسه ناموفق بود");
        }}
        onClose={() => setCancelId(null)}
      />
    </section>
  );
}
