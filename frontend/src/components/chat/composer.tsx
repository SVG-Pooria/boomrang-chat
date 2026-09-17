import { Plus, Smile, Vote } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { EmojiPicker } from "@/components/chat/emoji-picker";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function SendGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M20.04 11.13 5.42 3.82c-.86-.43-1.8.43-1.44 1.32l2.6 6.4c.12.3.12.62 0 .92l-2.6 6.4c-.36.89.58 1.75 1.44 1.32l14.62-7.31a.97.97 0 0 0 0-1.74Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M6.7 12h6.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function Composer({
  targetKey,
  placeholder,
  disabled,
  uploading,
  canPoll,
  onSend,
  onTyping,
  onPickFiles,
  onPoll,
}: {
  targetKey: string;
  placeholder: string;
  disabled: boolean;
  uploading: boolean;
  canPoll: boolean;
  onSend: (text: string) => void;
  onTyping: () => void;
  onPickFiles: (files: File[]) => void;
  onPoll: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue("");
    setEmojiOpen(false);
  }, [targetKey]);

  useEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 132)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
    textarea.current?.focus();
  };

  const insertEmoji = useCallback((emoji: string) => {
    const node = textarea.current;
    setValue((current) => {
      if (!node) return current + emoji;
      const start = node.selectionStart ?? current.length;
      const end = node.selectionEnd ?? current.length;
      const next = current.slice(0, start) + emoji + current.slice(end);
      requestAnimationFrame(() => {
        node.focus();
        node.selectionStart = node.selectionEnd = start + emoji.length;
      });
      return next;
    });
  }, []);

  return (
    <div className="shrink-0 space-y-2 px-4 pb-4 pt-1">
      {canPoll ? (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onPoll}
            disabled={disabled}
            className="flex items-center gap-1.5 rounded-full border border-chat-panel-border bg-white/70 px-3 py-1.5 text-[11px] font-bold text-chat-ink-soft transition-colors hover:bg-white hover:text-chat-ink disabled:opacity-50"
          >
            <Vote className="size-3.5" />
            {t("نظرسنجی")}
          </button>
        </div>
      ) : null}

      <div className="relative">
        <EmojiPicker open={emojiOpen} onClose={() => setEmojiOpen(false)} onSelect={insertEmoji} />
        <div
          className={cn(
            "flex items-end gap-1.5 rounded-[22px] border border-chat-panel-border bg-white/75 p-1.5 transition-colors focus-within:border-chat-sky/35 focus-within:bg-white",
            disabled && "opacity-60",
          )}
        >
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => fileInput.current?.click()}
            aria-label={t("ارسال فایل")}
            className="grid size-9 shrink-0 place-items-center rounded-2xl text-chat-ink-soft transition-colors hover:bg-chat-ink/5 hover:text-chat-ink disabled:opacity-50"
          >
            <Plus className={cn("size-[18px]", uploading && "animate-spin")} />
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length) onPickFiles(files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEmojiOpen((current) => !current)}
            aria-label={t("شکلک")}
            aria-expanded={emojiOpen}
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-2xl transition-colors disabled:opacity-50",
              emojiOpen
                ? "bg-chat-violet/15 text-chat-violet"
                : "text-chat-ink-soft hover:bg-chat-ink/5 hover:text-chat-ink",
            )}
          >
            <Smile className="size-[18px]" />
          </button>
          <textarea
            ref={textarea}
            rows={1}
            value={value}
            disabled={disabled}
            dir="auto"
            onChange={(event) => {
              setValue(event.target.value);
              onTyping();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files ?? []);
              if (files.length) {
                event.preventDefault();
                onPickFiles(files);
              }
            }}
            placeholder={placeholder}
            className="max-h-[132px] min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[13.5px] leading-relaxed text-chat-ink outline-none placeholder:text-chat-ink-soft"
          />
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !value.trim()}
            aria-label={t("ارسال")}
            className="grid size-9 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-chat-mint to-chat-sky-deep text-chat-on-accent shadow-md shadow-chat-mint/25 transition-all hover:opacity-90 active:scale-95 disabled:from-chat-ink/15 disabled:to-chat-ink/15 disabled:text-chat-ink-soft disabled:shadow-none"
          >
            <SendGlyph className="size-[19px] rtl:-scale-x-100" />
          </button>
        </div>
      </div>
    </div>
  );
}
