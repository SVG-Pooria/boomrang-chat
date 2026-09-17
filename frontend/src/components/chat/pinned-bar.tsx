import { FileText, ImageIcon, Pin, Vote, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { PinnedItem } from "@/lib/chat";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function PinnedBar({
  items,
  canUnpin,
  onOpen,
  onUnpin,
}: {
  items: PinnedItem[];
  canUnpin: boolean;
  onOpen: (messageId: number) => void;
  onUnpin: (messageId: number) => void;
}) {
  const { t, digits } = useI18n();
  const [position, setPosition] = useState(0);

  useEffect(() => {
    setPosition((current) => (current >= items.length ? 0 : current));
  }, [items.length]);

  if (items.length === 0) return null;
  const item = items[position] ?? items[0]!;
  const isMedia =
    (item.fileMimeType ?? "").startsWith("image/") ||
    (item.fileMimeType ?? "").startsWith("video/");
  const Icon =
    item.kind === "poll" ? Vote : item.kind === "file" ? (isMedia ? ImageIcon : FileText) : null;
  const preview =
    item.kind === "poll"
      ? t("نظرسنجی: {question}", { question: item.text ?? "" })
      : item.kind === "file"
        ? item.text
          ? `${item.fileName ?? ""} — ${item.text}`
          : (item.fileName ?? t("پیوست"))
        : (item.text ?? "");

  return (
    <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-chat-panel-border bg-white/35 px-4">
      <div className="flex h-8 w-[3px] shrink-0 flex-col gap-[3px]">
        {items.slice(0, 4).map((pinned, index) => (
          <span
            key={pinned.messageId}
            className={cn(
              "flex-1 rounded-full",
              index === Math.min(position, 3) ? "bg-chat-violet" : "bg-chat-violet/25",
            )}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          onOpen(item.messageId);
          if (items.length > 1) setPosition((current) => (current + 1) % items.length);
        }}
        className="flex min-w-0 flex-1 items-center gap-2 text-start"
      >
        <Pin className="size-3.5 shrink-0 text-chat-violet" />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-bold text-chat-violet">
            {items.length > 1
              ? t("پیام سنجاق‌شده {current} از {total}", {
                  current: digits(position + 1),
                  total: digits(items.length),
                })
              : t("پیام سنجاق‌شده")}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-chat-ink">
            {Icon ? <Icon className="size-3.5 shrink-0 text-chat-ink-soft" /> : null}
            <span className="truncate" dir="auto">
              {preview}
            </span>
          </span>
        </span>
      </button>
      {canUnpin ? (
        <button
          type="button"
          onClick={() => onUnpin(item.messageId)}
          aria-label={t("برداشتن سنجاق")}
          className="grid size-8 shrink-0 place-items-center rounded-full text-chat-ink-soft transition-colors hover:bg-white/70 hover:text-chat-ink"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
