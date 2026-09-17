import { Bell, BellOff, Images, MoreHorizontal, Pin, Search, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function ChatMenu({
  muted,
  pinnedCount,
  onSearch,
  onShowPinned,
  onShowMedia,
  onToggleMute,
}: {
  muted: boolean;
  pinnedCount: number;
  onSearch: () => void;
  onShowPinned: () => void;
  onShowMedia: () => void;
  onToggleMute: () => void;
}) {
  const { t, digits } = useI18n();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

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

  const items: { key: string; icon: LucideIcon; label: string; hint?: string; run: () => void }[] =
    [
      { key: "search", icon: Search, label: t("جستجو در گفتگو"), run: onSearch },
      {
        key: "pinned",
        icon: Pin,
        label: t("پیام‌های سنجاق‌شده"),
        ...(pinnedCount ? { hint: digits(pinnedCount) } : {}),
        run: onShowPinned,
      },
      { key: "media", icon: Images, label: t("رسانه‌ها و فایل‌ها"), run: onShowMedia },
      {
        key: "mute",
        icon: muted ? Bell : BellOff,
        label: muted ? t("روشن کردن اعلان‌ها") : t("بی‌صدا کردن گفتگو"),
        run: onToggleMute,
      },
    ];

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={t("گزینه‌های گفتگو")}
        aria-expanded={open}
        className={cn(
          "grid size-9 place-items-center rounded-full border border-chat-panel-border transition-colors",
          open
            ? "bg-white text-chat-ink"
            : "bg-white/60 text-chat-ink-soft hover:bg-white hover:text-chat-ink",
        )}
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open ? (
        <div className="absolute end-0 top-[calc(100%+8px)] z-30 w-56 rounded-[20px] border border-chat-panel-border bg-chat-surface p-1.5 shadow-[0_24px_60px_-28px_oklch(0.2_0.05_288/0.6)]">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setOpen(false);
                item.run();
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-[12px] font-bold text-chat-ink transition-colors hover:bg-white/60"
            >
              <item.icon className="size-4 text-chat-ink-soft" />
              <span className="flex-1">{item.label}</span>
              {item.hint ? (
                <span className="rounded-full bg-chat-violet/15 px-1.5 text-[10px] text-chat-violet">
                  {item.hint}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
