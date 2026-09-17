import { KeyRound, Lock, MessageSquarePlus, Search, Tag } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AlphaIndex, LetterHeader } from "@/components/ui/alpha-index";
import { UserAvatar } from "@/components/ui/user-avatar";
import { getSocket } from "@/lib/chat";
import { useI18n } from "@/lib/i18n";
import {
  fetchTeamMembers,
  setMemberPermission,
  setMemberTag,
  setMemberTitle,
  type TeamMemberRecord,
  type TeamMembersData,
} from "@/lib/manager";
import { groupByLetter, jumpToLetter, useActiveLetter } from "@/lib/people";
import { cn } from "@/lib/utils";

type Filter = "all" | TeamMemberRecord["role"] | "never";

const ROLE_ACCENT: Record<TeamMemberRecord["role"], string> = {
  super_admin: "bg-chat-violet/15 text-chat-violet",
  management: "bg-chat-sky/18 text-chat-sky-deep",
  manager: "bg-chat-lemon/25 text-chat-ink",
  employee: "bg-chat-mint/20 text-chat-mint-deep",
};

function FilterTabs({
  value,
  onChange,
  items,
}: {
  value: Filter;
  onChange: (value: Filter) => void;
  items: { value: Filter; label: string; count: number }[];
}) {
  const { t, digits } = useI18n();
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-chat-panel-border bg-white/50 p-1">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-bold transition-colors",
            value === item.value
              ? "bg-white text-chat-ink shadow-sm"
              : "text-chat-ink-soft hover:text-chat-ink",
          )}
        >
          {t(item.label)}
          <span
            className={cn(
              "grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9.5px]",
              value === item.value
                ? "bg-chat-violet/15 text-chat-violet"
                : "bg-chat-ink/8 text-chat-ink-soft",
            )}
          >
            {digits(item.count)}
          </span>
        </button>
      ))}
    </div>
  );
}

function MemberDetails({
  member,
  data,
  busy,
  onTag,
  onTitle,
  onPermission,
  onChat,
}: {
  member: TeamMemberRecord;
  data: TeamMembersData;
  busy: boolean;
  onTag: (tagId: number | null) => void;
  onTitle: (title: string) => void;
  onPermission: (permission: string, enabled: boolean) => void;
  onChat: () => void;
}) {
  const { t, digits } = useI18n();
  const [draft, setDraft] = useState(member.jobTitle ?? "");
  const [touched, setTouched] = useState(false);
  const title = touched ? draft : (member.jobTitle ?? "");

  useEffect(() => {
    setTouched(false);
    setDraft(member.jobTitle ?? "");
  }, [member.userId, member.jobTitle]);

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <UserAvatar name={member.name} src={member.avatarUrl} seed={member.userId} size={48} />
        <div className="min-w-0">
          <p className="truncate font-display text-[15px] font-semibold text-chat-ink">
            {member.name}
          </p>
          <p className="text-[11.5px] text-chat-ink-soft" dir="ltr">
            {digits(member.phone)}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-chat-panel-border bg-white/60 px-3.5 py-2.5">
        <span className="flex items-center gap-1.5 text-[11.5px] font-bold text-chat-ink-soft">
          <Lock className="size-3.5" />
          {t("نقش سازمانی")}
        </span>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[10.5px] font-bold",
            ROLE_ACCENT[member.role],
          )}
        >
          {t(member.roleLabel)}
        </span>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-[11.5px] font-bold text-chat-ink-soft">
          {t("عنوان سازمانی")}
        </span>
        <span className="flex items-center gap-2">
          <input
            value={title}
            maxLength={80}
            onChange={(event) => {
              setTouched(true);
              setDraft(event.target.value);
            }}
            placeholder={t("مثلاً مدیر فروش")}
            className="min-w-0 flex-1 rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-[13px] text-chat-ink outline-none transition-colors placeholder:text-chat-ink-soft focus:border-chat-sky/30 focus:bg-white"
          />
          <button
            type="button"
            disabled={busy || title.trim() === (member.jobTitle ?? "").trim()}
            onClick={() => {
              setTouched(false);
              onTitle(title.trim());
            }}
            className="shrink-0 rounded-full border border-chat-mint/25 bg-chat-mint/20 px-3.5 py-2 text-[12px] font-bold text-chat-mint-deep transition-colors hover:bg-chat-mint/25 disabled:opacity-50"
          >
            {t("ثبت")}
          </button>
        </span>
        <span className="mt-1.5 block text-[10.5px] leading-relaxed text-chat-ink-soft">
          {t("این عنوان کنار نقش کاربر در بالای پنل خودش نمایش داده می‌شود.")}
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-bold text-chat-ink-soft">
          <Tag className="size-3.5" />
          {t("تگ سازمانی")}
        </span>
        <select
          disabled={busy}
          value={member.tagId ?? ""}
          onChange={(event) => onTag(event.target.value ? Number(event.target.value) : null)}
          className="w-full appearance-none rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-[13px] text-chat-ink outline-none focus:border-chat-sky/30 focus:bg-white disabled:opacity-50"
        >
          <option value="">{t("بدون تگ")}</option>
          {data.tags.map((tag) => (
            <option key={tag.tagId} value={tag.tagId}>
              {tag.name}
            </option>
          ))}
        </select>
      </label>

      <div className="rounded-2xl border border-chat-panel-border bg-white/60 p-3.5">
        <p className="flex items-center gap-1.5 text-[11.5px] font-bold text-chat-ink-soft">
          <KeyRound className="size-3.5" />
          {t("دسترسی‌ها")}
        </p>
        {member.roleGrantsAll ? (
          <p className="mt-2 text-[11px] leading-relaxed text-chat-ink-soft">
            {t("این نقش همهٔ دسترسی‌های زیر را به‌صورت پیش‌فرض دارد.")}
          </p>
        ) : (
          <div className="mt-2.5 grid gap-2">
            {data.permissions.map((permission) => {
              const on = member.permissions.includes(permission.key);
              return (
                <div key={permission.key} className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-chat-ink">{t(permission.label)}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    disabled={busy}
                    onClick={() => onPermission(permission.key, !on)}
                    className={cn(
                      "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
                      on ? "bg-chat-mint" : "bg-chat-ink/10",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-all",
                        on ? "end-[22px]" : "end-0.5",
                      )}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-chat-ink/5 px-3.5 py-3 text-[11.5px] leading-relaxed text-chat-ink-soft">
        {member.neverSignedIn
          ? t("هنوز وارد نشده")
          : t("آخرین بار آنلاین: {value}", { value: t(member.lastSeen) })}
      </div>

      <button
        type="button"
        onClick={onChat}
        className="flex items-center justify-center gap-1.5 rounded-full bg-chat-ink px-4 py-2.5 text-[12.5px] font-bold text-chat-on-ink transition-opacity hover:opacity-90"
      >
        <MessageSquarePlus className="size-4" />
        {t("شروع گفتگو")}
      </button>
    </div>
  );
}

export function UsersConsole({ onOpenChat }: { onOpenChat: (userId: number) => void }) {
  const { t, digits } = useI18n();
  const [data, setData] = useState<TeamMembersData | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchTeamMembers());
    } catch {
      toast.error(t("بارگذاری فهرست کاربران ناموفق بود"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const refresh = () => void load();
    socket.on("workspace:changed", refresh);
    socket.on("presence:update", refresh);
    return () => {
      socket.off("workspace:changed", refresh);
      socket.off("presence:update", refresh);
    };
  }, [load]);

  const members = useMemo(() => data?.members ?? [], [data]);

  const counts = useMemo(() => {
    const base: Record<Filter, number> = {
      all: members.length,
      super_admin: 0,
      management: 0,
      manager: 0,
      employee: 0,
      never: 0,
    };
    for (const member of members) {
      base[member.role] += 1;
      if (member.neverSignedIn) base.never += 1;
    }
    return base;
  }, [members]);

  const groups = useMemo(() => {
    const cleaned = query.trim().toLowerCase();
    const visible = members.filter(
      (member) =>
        (filter === "all" ||
          (filter === "never" ? member.neverSignedIn : member.role === filter)) &&
        (!cleaned ||
          member.name.toLowerCase().includes(cleaned) ||
          member.phone.includes(cleaned) ||
          (member.jobTitle ?? "").toLowerCase().includes(cleaned) ||
          (member.tag ?? "").toLowerCase().includes(cleaned)),
    );
    return groupByLetter(visible, (member) => member.name);
  }, [members, query, filter]);

  const activeLetter = useActiveLetter(list, groups.length);
  const visibleMembers = groups.flatMap((group) => group.items);
  const current = visibleMembers.find((member) => member.userId === selected) ?? visibleMembers[0];

  const run = async (action: () => Promise<{ members: TeamMemberRecord[] }>, success: string) => {
    setBusy(true);
    try {
      const result = await action();
      setData((existing) => (existing ? { ...existing, members: result.members } : existing));
      toast.success(t(success));
    } catch {
      toast.error(t("ثبت تغییر ناموفق بود"));
    } finally {
      setBusy(false);
    }
  };

  const filters: { value: Filter; label: string; count: number }[] = [
    { value: "all", label: "همه", count: counts.all },
    { value: "management", label: "هیئت مدیره", count: counts.management },
    { value: "manager", label: "مدیر", count: counts.manager },
    { value: "employee", label: "کارمند", count: counts.employee },
    { value: "never", label: "وارد نشده", count: counts.never },
  ];

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="panel flex min-h-0 flex-col overflow-hidden rounded-[26px]">
        <header className="shrink-0 border-b border-chat-panel-border px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[15px] font-semibold">{t("کاربران")}</h2>
              <p className="mt-0.5 text-[11.5px] text-chat-ink-soft">
                {t("عنوان سازمانی، تگ و دسترسی همکاران را از همین‌جا تنظیم کنید.")}
              </p>
            </div>
            <label className="flex w-full items-center gap-2 rounded-full border border-chat-panel-border bg-white/70 px-3.5 py-2 sm:w-64">
              <Search className="size-4 shrink-0 text-chat-ink-soft" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("جستجوی نام، شماره یا عنوان...")}
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-chat-ink outline-none placeholder:text-chat-ink-soft"
              />
            </label>
          </div>
          <div className="mt-3">
            <FilterTabs value={filter} onChange={setFilter} items={filters} />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 bg-chat-sky/[0.06]">
          <div ref={list} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {groups.map((group) => (
              <div key={group.letter}>
                <LetterHeader letter={group.letter} />
                <div className="grid gap-1.5">
                  {group.items.map((member) => (
                    <button
                      key={member.userId}
                      type="button"
                      onClick={() => setSelected(member.userId)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-start transition-colors",
                        current?.userId === member.userId
                          ? "border-chat-violet/35 bg-white shadow-sm"
                          : "border-chat-panel-border bg-white/70 hover:bg-white",
                      )}
                    >
                      <UserAvatar
                        name={member.name}
                        src={member.avatarUrl}
                        seed={member.userId}
                        size={38}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-bold text-chat-ink">
                          {member.name}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-chat-ink-soft">
                          <span dir="ltr">{digits(member.phone)}</span>
                          {member.jobTitle ? ` · ${member.jobTitle}` : ""}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold",
                          ROLE_ACCENT[member.role],
                        )}
                      >
                        {t(member.roleLabel)}
                      </span>
                      <span className="hidden w-28 text-left text-[11px] text-chat-ink-soft/70 lg:inline">
                        {t(member.lastSeen)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {data && visibleMembers.length === 0 ? (
              <p className="py-16 text-center text-[12.5px] text-chat-ink-soft">
                {t("همکاری با این مشخصات پیدا نشد.")}
              </p>
            ) : null}
          </div>
          <AlphaIndex
            letters={groups.map((group) => group.letter)}
            active={activeLetter}
            onJump={(letter) => jumpToLetter(list.current, letter)}
          />
        </div>
      </section>

      {current && data ? (
        <section className="panel custom-scrollbar min-h-0 overflow-y-auto rounded-[26px] p-5">
          <MemberDetails
            key={current.userId}
            member={current}
            data={data}
            busy={busy}
            onTag={(tagId) => void run(() => setMemberTag(current.userId, tagId), "تگ ثبت شد")}
            onTitle={(title) =>
              void run(() => setMemberTitle(current.userId, title), "عنوان کاربر ثبت شد")
            }
            onPermission={(permission, enabled) =>
              void run(
                () => setMemberPermission(current.userId, permission, enabled),
                enabled ? "دسترسی داده شد" : "دسترسی برداشته شد",
              )
            }
            onChat={() => onOpenChat(current.userId)}
          />
        </section>
      ) : null}
    </div>
  );
}
