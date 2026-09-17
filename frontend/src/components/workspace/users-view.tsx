import { MessageSquarePlus, Phone, Search, Send } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { AlphaIndex, LetterHeader } from "@/components/ui/alpha-index";
import { groupByLetter, jumpToLetter, useActiveLetter } from "@/lib/people";
import { GlassDialog } from "@/components/ui/glass-dialog";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useI18n } from "@/lib/i18n";
import { ROLE_LABELS } from "@/lib/roles";
import type { Person } from "@/lib/workspace";
import { cn } from "@/lib/utils";

export function UsersView({
  people,
  viewerId,
  viewerRole,
  onStartChat,
  onRequestChat,
}: {
  people: Person[];
  viewerId: number | null;
  viewerRole: string | undefined;
  onStartChat: (person: Person) => Promise<void>;
  onRequestChat: (person: Person, subject: string, message: string) => Promise<void>;
}) {
  const { t, digits } = useI18n();
  const [term, setTerm] = useState("");
  const [requesting, setRequesting] = useState<Person | null>(null);
  const [subject, setSubject] = useState("");
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const cleaned = term.trim().toLowerCase();
    const visible = people.filter(
      (person) =>
        person.userId !== viewerId &&
        (!cleaned ||
          person.name.toLowerCase().includes(cleaned) ||
          person.role.toLowerCase().includes(cleaned) ||
          person.phone.includes(cleaned) ||
          (person.tag ?? "").toLowerCase().includes(cleaned) ||
          person.unit.toLowerCase().includes(cleaned)),
    );
    return groupByLetter(visible, (person) => person.name);
  }, [people, viewerId, term]);

  const activeLetter = useActiveLetter(list, groups.length);

  const needsTicket = (person: Person) =>
    viewerRole === "employee" && person.accountRole === "management";

  const statusTone: Record<string, string> = {
    آنلاین: "bg-chat-mint",
    "در جلسه": "bg-chat-sky",
    مرخصی: "bg-chat-lemon",
  };

  return (
    <section className="panel flex h-full flex-col overflow-hidden rounded-[26px]">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-chat-panel-border px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[15px] font-semibold">{t("کاربران")}</h2>
          <p className="mt-0.5 text-[11.5px] text-chat-ink-soft">
            {t("{count} همکار — گفتگوی تازه را از همین‌جا شروع کنید", {
              count: digits(Math.max(0, people.length - 1)),
            })}
          </p>
        </div>
        <label className="flex w-full items-center gap-2 rounded-full border border-chat-panel-border bg-white/70 px-3.5 py-2 sm:w-72">
          <Search className="size-4 shrink-0 text-chat-ink-soft" />
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t("جستجوی نام، شماره، سمت یا تگ...")}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-chat-ink outline-none placeholder:text-chat-ink-soft"
          />
        </label>
      </header>

      <div className="flex min-h-0 flex-1 bg-chat-sky/[0.06]">
        <div
          ref={list}
          className="custom-scrollbar relative min-h-0 flex-1 overflow-y-auto px-4 pb-4"
        >
          {groups.length === 0 ? (
            <p className="py-16 text-center text-[12.5px] text-chat-ink-soft">
              {t("همکاری با این مشخصات پیدا نشد.")}
            </p>
          ) : null}
          {groups.map((group) => (
            <div key={group.letter}>
              <LetterHeader letter={group.letter} />
              <div className="grid gap-2">
                {group.items.map((person) => {
                  const ticket = needsTicket(person);
                  return (
                    <div
                      key={person.userId}
                      className="flex items-center gap-3 rounded-[18px] border border-chat-panel-border bg-white/80 px-3 py-2.5 shadow-[0_10px_24px_-20px_oklch(0.4_0.075_288/0.75)] transition-colors hover:bg-white"
                    >
                      <UserAvatar
                        name={person.name}
                        src={person.avatarUrl}
                        seed={person.userId}
                        size={42}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-[13px] font-bold text-chat-ink">
                          <span className="truncate">{person.name}</span>
                          {person.accountRole !== "employee" ? (
                            <span className="shrink-0 rounded-full bg-chat-violet/15 px-2 py-0.5 text-[10px] text-chat-violet">
                              {t(ROLE_LABELS[person.accountRole])}
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-chat-ink-soft">
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              statusTone[person.status] ?? "bg-chat-ink-soft/40",
                            )}
                          />
                          <span className="truncate">
                            {[t(person.status), person.role, person.tag]
                              .filter(Boolean)
                              .join(" • ")}
                          </span>
                        </p>
                      </div>
                      <span
                        dir="ltr"
                        className="hidden shrink-0 items-center gap-1 rounded-full bg-chat-ink/6 px-2.5 py-1 text-[11px] text-chat-ink-soft sm:flex"
                      >
                        <Phone className="size-3" />
                        {digits(person.phone)}
                      </span>
                      <button
                        type="button"
                        disabled={busyId === person.userId}
                        onClick={() => {
                          if (ticket) {
                            setRequesting(person);
                            setSubject("");
                            setNote("");
                            return;
                          }
                          setBusyId(person.userId);
                          void onStartChat(person).finally(() => setBusyId(null));
                        }}
                        className={cn(
                          "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-[11.5px] font-bold transition-colors disabled:opacity-60",
                          ticket
                            ? "border border-chat-panel-border bg-white/70 text-chat-ink hover:bg-white"
                            : "bg-chat-ink text-chat-on-ink hover:opacity-90",
                        )}
                      >
                        {ticket ? (
                          <Send className="size-3.5 rtl:-scale-x-100" />
                        ) : (
                          <MessageSquarePlus className="size-3.5" />
                        )}
                        {ticket ? t("درخواست گفتگو") : t("شروع گفتگو")}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <AlphaIndex
          letters={groups.map((group) => group.letter)}
          active={activeLetter}
          onJump={(letter) => jumpToLetter(list.current, letter)}
        />
      </div>

      <GlassDialog
        open={requesting !== null}
        onClose={() => setRequesting(null)}
        title={t("درخواست گفتگو با {name}", { name: requesting?.name ?? "" })}
        description={t("گفتگو با هیئت مدیره پس از تأیید درخواست باز می‌شود.")}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!requesting || !subject.trim()) return;
            setBusyId(requesting.userId);
            void onRequestChat(requesting, subject.trim(), note.trim())
              .then(() => setRequesting(null))
              .finally(() => setBusyId(null));
          }}
        >
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold text-chat-ink-soft">
              {t("موضوع")}
            </span>
            <input
              autoFocus
              value={subject}
              maxLength={200}
              onChange={(event) => setSubject(event.target.value)}
              className="w-full rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-[13px] text-chat-ink outline-none focus:border-chat-violet/40 focus:bg-white"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold text-chat-ink-soft">
              {t("توضیح")}
            </span>
            <textarea
              value={note}
              rows={3}
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
              className="w-full resize-none rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-[13px] leading-relaxed text-chat-ink outline-none focus:border-chat-violet/40 focus:bg-white"
            />
          </label>
          <button
            type="submit"
            disabled={!subject.trim() || busyId !== null}
            className="rounded-full bg-chat-ink px-4 py-2.5 text-[12.5px] font-bold text-chat-on-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {t("ثبت درخواست")}
          </button>
        </form>
      </GlassDialog>
    </section>
  );
}
