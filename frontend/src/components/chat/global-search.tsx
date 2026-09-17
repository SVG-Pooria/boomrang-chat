import { FileText, Hash, Loader2, Megaphone, MessageSquare, Search, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Highlight, snippetAround } from "@/components/chat/highlight";
import { searchEverywhere, type GlobalSearchResult } from "@/lib/chat";
import { useI18n } from "@/lib/i18n";

export type SearchTarget = {
  targetType: "conversation" | "group" | "channel";
  targetId: number;
  messageId?: number;
};

const TYPE_ICON = { conversation: MessageSquare, group: Users, channel: Megaphone };

export function GlobalSearch({ onOpen }: { onOpen: (target: SearchTarget) => void }) {
  const { t, day, clock } = useI18n();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GlobalSearchResult | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cleaned = term.trim();
    if (cleaned.length < 2) {
      setResult(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchEverywhere(cleaned)
        .then((found) => {
          setResult(found);
          setOpen(true);
        })
        .catch(() => setResult({ chats: [], messages: [] }))
        .finally(() => setLoading(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      if (container.current && !container.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const choose = (target: SearchTarget) => {
    setOpen(false);
    onOpen(target);
  };

  const empty = result && result.chats.length === 0 && result.messages.length === 0;

  return (
    <div ref={container} className="relative w-full max-w-[460px]">
      <label className="flex items-center gap-2 rounded-full border border-chat-panel-border bg-chat-panel px-3.5 py-2 backdrop-blur-xl transition-colors focus-within:bg-white/80">
        {loading ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-chat-ink-soft" />
        ) : (
          <Search className="size-4 shrink-0 text-chat-ink-soft" />
        )}
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onFocus={() => result && setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          placeholder={t("جستجو در همهٔ گفتگوها، فایل‌ها و کانال‌ها...")}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-chat-ink outline-none placeholder:text-chat-ink-soft"
        />
        {term ? (
          <button
            type="button"
            onClick={() => {
              setTerm("");
              setResult(null);
            }}
            aria-label={t("پاک کردن جستجو")}
            className="grid size-6 place-items-center rounded-full text-chat-ink-soft hover:bg-chat-ink/5 hover:text-chat-ink"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </label>

      {open && result ? (
        <div className="custom-scrollbar absolute inset-x-0 top-[calc(100%+8px)] z-40 max-h-[min(520px,70dvh)] overflow-y-auto rounded-[22px] border border-chat-panel-border bg-chat-surface p-2 shadow-[0_28px_70px_-30px_oklch(0.2_0.05_288/0.65)]">
          {empty ? (
            <p className="py-8 text-center text-[12px] text-chat-ink-soft">
              {t("چیزی با این عبارت پیدا نشد.")}
            </p>
          ) : null}

          {result.chats.length ? (
            <div className="mb-1">
              <p className="px-3 pb-1 pt-1.5 text-[10.5px] font-bold text-chat-ink-soft">
                {t("گفتگوها")}
              </p>
              {result.chats.map((chat) => {
                const Icon = TYPE_ICON[chat.targetType] ?? Hash;
                return (
                  <button
                    key={`${chat.targetType}-${chat.targetId}`}
                    type="button"
                    onClick={() => choose({ targetType: chat.targetType, targetId: chat.targetId })}
                    className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-2 text-start transition-colors hover:bg-white/70"
                  >
                    <span className="grid size-8 place-items-center rounded-xl bg-chat-violet/12 text-chat-violet">
                      <Icon className="size-4" />
                    </span>
                    <span className="truncate text-[12.5px] font-bold text-chat-ink">
                      <Highlight text={chat.name} term={term} />
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {result.messages.length ? (
            <div>
              <p className="px-3 pb-1 pt-1.5 text-[10.5px] font-bold text-chat-ink-soft">
                {t("پیام‌ها و فایل‌ها")}
              </p>
              {result.messages.map((hit) => {
                const Icon = TYPE_ICON[hit.targetType] ?? Hash;
                return (
                  <button
                    key={`${hit.targetType}-${hit.messageId}`}
                    type="button"
                    onClick={() =>
                      choose({
                        targetType: hit.targetType,
                        targetId: hit.targetId,
                        messageId: hit.messageId,
                      })
                    }
                    className="flex w-full items-start gap-2.5 rounded-2xl px-3 py-2 text-start transition-colors hover:bg-white/70"
                  >
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-chat-sky/15 text-chat-sky-deep">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate font-bold text-chat-ink">
                          {hit.targetName ?? t("گفتگو")} • {hit.senderName}
                        </span>
                        <span className="shrink-0 text-chat-ink-soft">
                          {day(hit.createdAt, { day: "numeric", month: "short", year: "numeric" })}{" "}
                          • <span dir="ltr">{clock(hit.createdAt)}</span>
                        </span>
                      </span>
                      {hit.fileName ? (
                        <span className="mt-0.5 flex items-center gap-1 text-[12px] text-chat-ink">
                          <FileText className="size-3.5 shrink-0 text-chat-sky-deep" />
                          <span className="truncate" dir="auto">
                            <Highlight text={hit.fileName} term={term} />
                          </span>
                        </span>
                      ) : null}
                      {hit.snippet ? (
                        <span
                          className="mt-0.5 line-clamp-2 block text-[12px] leading-relaxed text-chat-ink-soft"
                          dir="auto"
                        >
                          <Highlight text={snippetAround(hit.snippet, term)} term={term} />
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
