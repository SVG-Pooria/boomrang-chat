import { ChevronDown, ChevronUp, FileText, Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Highlight, snippetAround } from "@/components/chat/highlight";
import { searchInChat, type ChatSearchHit, type ChatTarget } from "@/lib/chat";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function ChatSearch({
  target,
  onJump,
  onClose,
}: {
  target: ChatTarget;
  onJump: (messageId: number) => void;
  onClose: () => void;
}) {
  const { t, digits, day, clock } = useI18n();
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<ChatSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [listOpen, setListOpen] = useState(true);
  const input = useRef<HTMLInputElement>(null);

  const ordered = useMemo(() => [...hits].reverse(), [hits]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const cleaned = term.trim();
    if (!cleaned) {
      setHits([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchInChat(target, cleaned)
        .then((results) => {
          setHits(results);
          setCursor(0);
          setListOpen(true);
        })
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 280);
    return () => window.clearTimeout(timer);
  }, [term, target]);

  const go = (next: number) => {
    if (ordered.length === 0) return;
    const wrapped = (next + ordered.length) % ordered.length;
    setCursor(wrapped);
    onJump(ordered[wrapped]!.id);
  };

  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-2">
      <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-chat-panel-border bg-white/70 px-3.5 py-2">
        {loading ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-chat-ink-soft" />
        ) : (
          <Search className="size-4 shrink-0 text-chat-ink-soft" />
        )}
        <input
          ref={input}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "Enter") {
              event.preventDefault();
              go(event.shiftKey ? cursor - 1 : hits.length && listOpen ? cursor : cursor + 1);
              setListOpen(false);
            }
          }}
          placeholder={t("جستجو در همین گفتگو...")}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-chat-ink outline-none placeholder:text-chat-ink-soft"
        />
        {term.trim() ? (
          <span className="shrink-0 text-[11px] font-bold text-chat-ink-soft">
            {ordered.length ? `${digits(cursor + 1)} / ${digits(ordered.length)}` : t("بدون نتیجه")}
          </span>
        ) : null}
      </label>
      <button
        type="button"
        disabled={ordered.length < 2}
        onClick={() => go(cursor + 1)}
        aria-label={t("نتیجهٔ قبلی")}
        className="grid size-8 place-items-center rounded-full text-chat-ink-soft transition-colors hover:bg-white/70 hover:text-chat-ink disabled:opacity-40"
      >
        <ChevronUp className="size-4" />
      </button>
      <button
        type="button"
        disabled={ordered.length < 2}
        onClick={() => go(cursor - 1)}
        aria-label={t("نتیجهٔ بعدی")}
        className="grid size-8 place-items-center rounded-full text-chat-ink-soft transition-colors hover:bg-white/70 hover:text-chat-ink disabled:opacity-40"
      >
        <ChevronDown className="size-4" />
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("بستن جستجو")}
        className="grid size-8 place-items-center rounded-full text-chat-ink-soft transition-colors hover:bg-white/70 hover:text-chat-ink"
      >
        <X className="size-4" />
      </button>

      {listOpen && ordered.length > 0 ? (
        <div className="custom-scrollbar absolute inset-x-0 top-[calc(100%+8px)] z-30 max-h-[300px] overflow-y-auto rounded-[20px] border border-chat-panel-border bg-chat-surface p-1.5 shadow-[0_24px_60px_-28px_oklch(0.2_0.05_288/0.6)]">
          {ordered.map((hit, index) => (
            <button
              key={hit.id}
              type="button"
              onClick={() => {
                setCursor(index);
                setListOpen(false);
                onJump(hit.id);
              }}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-2xl px-3 py-2 text-start transition-colors",
                index === cursor ? "bg-white/80" : "hover:bg-white/60",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate font-bold text-chat-ink">{hit.senderName}</span>
                  <span className="shrink-0 text-chat-ink-soft">
                    {day(hit.createdAt, { day: "numeric", month: "short", year: "numeric" })} •{" "}
                    <span dir="ltr">{clock(hit.createdAt)}</span>
                  </span>
                </p>
                {hit.fileName ? (
                  <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-chat-ink">
                    <FileText className="size-3.5 shrink-0 text-chat-sky-deep" />
                    <span className="truncate" dir="auto">
                      <Highlight text={hit.fileName} term={term} />
                    </span>
                  </p>
                ) : null}
                {hit.snippet ? (
                  <p
                    className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-chat-ink-soft"
                    dir="auto"
                  >
                    <Highlight text={snippetAround(hit.snippet, term)} term={term} />
                  </p>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
