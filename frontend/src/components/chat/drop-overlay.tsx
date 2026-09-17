import { FileUp, Images } from "lucide-react";
import { useState, type DragEvent } from "react";

import { useI18n } from "@/lib/i18n";
import type { UploadMode } from "@/lib/chat";
import { cn } from "@/lib/utils";

function DropZone({
  mode,
  active,
  onHover,
  onDropFiles,
}: {
  mode: UploadMode;
  active: boolean;
  onHover: (mode: UploadMode | null) => void;
  onDropFiles: (files: File[], mode: UploadMode) => void;
}) {
  const { t } = useI18n();
  const compressed = mode === "compressed";
  const Icon = compressed ? Images : FileUp;

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        onHover(mode);
      }}
      onDragLeave={() => onHover(null)}
      onDrop={(event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        onHover(null);
        const files = Array.from(event.dataTransfer.files ?? []);
        if (files.length) onDropFiles(files, mode);
      }}
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-[26px] border-2 border-dashed p-6 text-center transition-all duration-150",
        active
          ? "scale-[1.01] border-chat-on-accent bg-chat-on-accent/15"
          : "border-chat-on-accent/55 bg-chat-on-accent/5",
      )}
    >
      <span
        className={cn(
          "grid size-14 place-items-center rounded-2xl transition-colors",
          active
            ? "bg-chat-on-accent text-chat-sky-deep"
            : "bg-chat-on-accent/15 text-chat-on-accent",
        )}
      >
        <Icon className="size-7" strokeWidth={1.75} />
      </span>
      <p className="font-display text-[16px] font-semibold text-chat-on-accent">
        {compressed ? t("ارسال فشرده") : t("ارسال به‌صورت فایل")}
      </p>
      <p className="max-w-[240px] text-[12px] leading-relaxed text-chat-on-accent/80">
        {compressed
          ? t("عکس‌ها و ویدیوها سبک می‌شوند و در گالری رسانه‌ها دیده می‌شوند")
          : t("فایل بدون هیچ تغییری در کیفیت یا حجم فرستاده می‌شود")}
      </p>
    </div>
  );
}

export function DropOverlay({
  visible,
  onDropFiles,
  onLeave,
}: {
  visible: boolean;
  onDropFiles: (files: File[], mode: UploadMode) => void;
  onLeave: () => void;
}) {
  const [hovered, setHovered] = useState<UploadMode | null>(null);
  if (!visible) return null;

  return (
    <div
      className="absolute inset-0 z-20 flex gap-3 rounded-[26px] bg-[oklch(0.2_0.05_280/0.72)] p-4 backdrop-blur-[2px]"
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setHovered(null);
          onLeave();
        }
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        setHovered(null);
        onLeave();
      }}
    >
      <DropZone
        mode="compressed"
        active={hovered === "compressed"}
        onHover={setHovered}
        onDropFiles={(files, mode) => {
          setHovered(null);
          onDropFiles(files, mode);
        }}
      />
      <DropZone
        mode="file"
        active={hovered === "file"}
        onHover={setHovered}
        onDropFiles={(files, mode) => {
          setHovered(null);
          onDropFiles(files, mode);
        }}
      />
    </div>
  );
}
