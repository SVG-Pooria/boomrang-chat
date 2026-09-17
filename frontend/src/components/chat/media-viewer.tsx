import { ChevronLeft, ChevronRight, Download, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { fetchBlobUrl, fileUrl, saveFile } from "@/lib/files";
import { useI18n } from "@/lib/i18n";

export type ViewerItem = {
  fileId: number;
  name: string;
  mimeType: string | null;
  sender: string;
  createdAt: string;
  caption?: string;
};

export function MediaViewer({
  items,
  index,
  onIndexChange,
  onClose,
}: {
  items: ViewerItem[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const { t, day, clock, digits, dir } = useI18n();
  const item = index === null ? null : (items[index] ?? null);
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const isVideo = (item?.mimeType ?? "").startsWith("video/");

  useEffect(() => {
    if (!item) return undefined;
    let active = true;
    let objectUrl: string | null = null;
    setSource(null);
    setFailed(false);
    fetchBlobUrl(fileUrl(item.fileId, "compressed"))
      .catch(() => fetchBlobUrl(fileUrl(item.fileId, "original")))
      .then((url) => {
        objectUrl = url;
        if (active) setSource(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item]);

  const step = useCallback(
    (delta: number) => {
      if (index === null || items.length < 2) return;
      onIndexChange((index + delta + items.length) % items.length);
    },
    [index, items.length, onIndexChange],
  );

  useEffect(() => {
    if (!item) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      const forward = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
      const backward = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
      if (event.key === forward) step(1);
      if (event.key === backward) step(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [item, dir, onClose, step]);

  if (!item || typeof document === "undefined") return null;

  return createPortal(
    <div
      dir={dir}
      className="fixed inset-0 z-[70] flex flex-col bg-[oklch(0.12_0.02_280/0.94)] font-body text-[oklch(0.97_0.005_285)] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex shrink-0 items-center gap-3 px-5 py-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold">{item.sender}</p>
          <p className="mt-0.5 text-[11.5px] opacity-70">
            {day(item.createdAt, { day: "numeric", month: "long", year: "numeric" })} •{" "}
            {clock(item.createdAt)}
            {items.length > 1 ? ` • ${digits(index! + 1)} / ${digits(items.length)}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            void saveFile(fileUrl(item.fileId, "original"), item.name).catch(() =>
              toast.error(t("دانلود فایل ناموفق بود")),
            )
          }
          className="flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-2 text-[12px] font-bold transition-colors hover:bg-white/20"
        >
          <Download className="size-4" />
          {t("دانلود نسخهٔ اصلی")}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("بستن")}
          className="grid size-10 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-16 pb-4">
        {items.length > 1 ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              step(-1);
            }}
            aria-label={t("قبلی")}
            className="absolute start-4 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
          >
            <ChevronRight className="size-5 ltr:rotate-180" />
          </button>
        ) : null}

        <div
          className="flex max-h-full max-w-full items-center justify-center"
          onClick={(event) => event.stopPropagation()}
        >
          {failed ? (
            <p className="text-[13px] opacity-80">{t("نمایش این رسانه ممکن نشد.")}</p>
          ) : !source ? (
            <Loader2 className="size-8 animate-spin opacity-70" />
          ) : isVideo ? (
            <video
              key={source}
              src={source}
              controls
              autoPlay
              className="max-h-[calc(100dvh-170px)] max-w-full rounded-2xl shadow-2xl"
            />
          ) : (
            <img
              src={source}
              alt={item.name}
              className="max-h-[calc(100dvh-170px)] max-w-full rounded-2xl object-contain shadow-2xl"
            />
          )}
        </div>

        {items.length > 1 ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              step(1);
            }}
            aria-label={t("بعدی")}
            className="absolute end-4 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
          >
            <ChevronLeft className="size-5 ltr:rotate-180" />
          </button>
        ) : null}
      </div>

      {item.caption ? (
        <p
          className="mx-auto mb-5 max-w-2xl shrink-0 rounded-2xl bg-white/10 px-4 py-2.5 text-center text-[13px] leading-relaxed"
          dir="auto"
          onClick={(event) => event.stopPropagation()}
        >
          {item.caption}
        </p>
      ) : null}
    </div>,
    document.body,
  );
}
