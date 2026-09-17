import { FileArchive, FileText, Film, ImageIcon, Plus, SendHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { GlassDialog } from "@/components/ui/glass-dialog";
import { formatBytes, isVisualMedia } from "@/lib/files";
import { useI18n } from "@/lib/i18n";
import type { UploadMode } from "@/lib/chat";
import { cn } from "@/lib/utils";

export type PendingUpload = { files: File[]; mode: UploadMode };

function FilePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const { t, digits } = useI18n();
  const [preview, setPreview] = useState<string | null>(null);
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  const lower = file.name.toLowerCase();
  const isArchive = /\.(zip|rar|7z)$/.test(lower);

  useEffect(() => {
    if (!isImage) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  return (
    <div className="group relative flex items-center gap-3 rounded-2xl border border-chat-panel-border bg-white/60 p-2">
      <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-chat-violet/10 text-chat-violet">
        {preview ? (
          <img src={preview} alt="" className="size-full object-cover" />
        ) : isVideo ? (
          <Film className="size-5" />
        ) : isImage ? (
          <ImageIcon className="size-5" />
        ) : isArchive ? (
          <FileArchive className="size-5 text-chat-lemon" />
        ) : (
          <FileText className="size-5 text-chat-sky-deep" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-bold text-chat-ink" dir="auto">
          {file.name}
        </p>
        <p className="mt-0.5 text-[11px] text-chat-ink-soft" dir="ltr">
          {formatBytes(file.size, digits)}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("حذف از فهرست")}
        className="grid size-8 shrink-0 place-items-center rounded-full text-chat-ink-soft transition-colors hover:bg-chat-rose/10 hover:text-chat-rose"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function SendFilesDialog({
  pending,
  busy,
  onChange,
  onClose,
  onSend,
}: {
  pending: PendingUpload | null;
  busy: boolean;
  onChange: (next: PendingUpload | null) => void;
  onClose: () => void;
  onSend: (upload: PendingUpload, caption: string) => void;
}) {
  const { t, digits } = useI18n();
  const [caption, setCaption] = useState("");
  const moreInput = useRef<HTMLInputElement>(null);
  const open = pending !== null && pending.files.length > 0;

  useEffect(() => {
    if (!open) setCaption("");
  }, [open]);

  const hasMedia = useMemo(
    () => (pending?.files ?? []).some((file) => isVisualMedia(file.type)),
    [pending],
  );

  if (!pending) return null;

  const mode: UploadMode = hasMedia ? pending.mode : "file";
  const count = pending.files.length;

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      title={count === 1 ? t("ارسال فایل") : t("ارسال {count} فایل", { count: digits(count) })}
      description={t(
        "پیش از ارسال می‌توانید توضیح بنویسید و نحوهٔ ارسال عکس و ویدیو را انتخاب کنید.",
      )}
    >
      <div className="grid gap-3">
        <div className="custom-scrollbar grid max-h-[260px] gap-2 overflow-y-auto pe-1">
          {pending.files.map((file, index) => (
            <FilePreview
              key={`${file.name}-${file.size}-${index}`}
              file={file}
              onRemove={() => {
                const files = pending.files.filter((_, position) => position !== index);
                onChange(files.length ? { ...pending, files } : null);
              }}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => moreInput.current?.click()}
          className="inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-bold text-chat-violet transition-colors hover:bg-chat-violet/10"
        >
          <Plus className="size-3.5" />
          {t("افزودن فایل دیگر")}
        </button>
        <input
          ref={moreInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const added = Array.from(event.target.files ?? []);
            if (added.length) onChange({ ...pending, files: [...pending.files, ...added] });
            event.target.value = "";
          }}
        />

        {hasMedia ? (
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["compressed", "ارسال فشرده", "عکس و ویدیو در گالری، سبک و سریع"],
                ["file", "ارسال به‌صورت فایل", "بدون تغییر در کیفیت و حجم"],
              ] as const
            ).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ ...pending, mode: value })}
                aria-pressed={mode === value}
                className={cn(
                  "rounded-2xl border px-3 py-2.5 text-start transition-colors",
                  mode === value
                    ? "border-chat-violet/45 bg-chat-violet/12 ring-2 ring-chat-violet/20"
                    : "border-chat-panel-border bg-white/55 hover:bg-white/80",
                )}
              >
                <span className="block text-[12px] font-bold text-chat-ink">{t(label)}</span>
                <span className="mt-0.5 block text-[10.5px] leading-relaxed text-chat-ink-soft">
                  {t(hint)}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-bold text-chat-ink-soft">
            {t("توضیح")}
          </span>
          <textarea
            value={caption}
            rows={2}
            maxLength={2000}
            onChange={(event) => setCaption(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!busy) onSend({ ...pending, mode }, caption.trim());
              }
            }}
            placeholder={t("توضیحی برای این ارسال بنویسید...")}
            className="w-full resize-none rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-[13px] leading-relaxed text-chat-ink outline-none placeholder:text-chat-ink-soft focus:border-chat-violet/40 focus:bg-white"
          />
        </label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onSend({ ...pending, mode }, caption.trim())}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-br from-chat-mint to-chat-sky-deep px-4 py-2.5 text-[12.5px] font-bold text-chat-on-accent shadow-md shadow-chat-mint/25 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <SendHorizontal className="size-4 rtl:-scale-x-100" />
            {busy ? t("در حال ارسال...") : t("ارسال")}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-chat-panel-border bg-white/60 px-4 py-2.5 text-[12.5px] font-bold text-chat-ink-soft transition-colors hover:bg-white hover:text-chat-ink"
          >
            {t("انصراف")}
          </button>
        </div>
      </div>
    </GlassDialog>
  );
}
