import { Download, FileText, Film, ImageIcon, Lock, Pin, Play } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { UserAvatar } from "@/components/ui/user-avatar";
import { downloadFile, errorMessage, monitoredFilePath, oversightFileUrl } from "@/lib/admin";
import type { TranscriptMessage } from "@/lib/admin";
import { isVisualMedia } from "@/lib/files";
import { useI18n } from "@/lib/i18n";
import { useThumbnail } from "@/lib/use-thumbnail";
import { cn } from "@/lib/utils";

function MediaPreview({ message }: { message: TranscriptMessage }) {
  const { t } = useI18n();
  const { source, failed } = useThumbnail(message.fileId, oversightFileUrl);
  const isVideo = (message.fileMimeType ?? "").startsWith("video/");
  return (
    <span className="relative block w-[min(260px,52vw)] overflow-hidden rounded-[16px] bg-chat-ink/10">
      {source ? (
        <img
          src={source}
          alt={message.attachment ?? t("پیوست")}
          draggable={false}
          className="block max-h-[240px] w-full object-cover"
        />
      ) : (
        <span className="grid aspect-[4/3] w-full place-items-center text-chat-ink-soft">
          {failed ? (
            isVideo ? (
              <Film className="size-6" />
            ) : (
              <ImageIcon className="size-6" />
            )
          ) : (
            <span className="size-6 animate-pulse rounded-full bg-chat-ink/15" />
          )}
        </span>
      )}
      {isVideo ? (
        <span className="absolute inset-0 grid place-items-center bg-[oklch(0.15_0.03_280/0.25)]">
          <span className="grid size-10 place-items-center rounded-full bg-[oklch(0.15_0.03_280/0.55)] text-[oklch(0.99_0_0)]">
            <Play className="size-4 translate-x-px fill-current" />
          </span>
        </span>
      ) : null}
    </span>
  );
}

function AttachmentRow({ message, own }: { message: TranscriptMessage; own: boolean }) {
  const { t } = useI18n();
  const name = message.attachment ?? t("پیوست");
  const download = () =>
    downloadFile(monitoredFilePath(message.fileId as number), name).catch((error: unknown) =>
      toast.error(errorMessage(error, "دانلود فایل ناموفق بود")),
    );
  return (
    <span
      className={cn(
        "flex w-[min(260px,52vw)] items-center gap-2.5 rounded-[14px] p-2",
        own ? "bg-chat-on-accent/15" : "bg-chat-ink/5",
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-xl",
          own ? "bg-chat-on-accent/20 text-chat-on-accent" : "bg-chat-sky/18 text-chat-sky-deep",
        )}
      >
        <FileText className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-bold" dir="auto">
        {name}
      </span>
      <button
        type="button"
        onClick={() => void download()}
        aria-label={t("دانلود {name}", { name })}
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full transition-colors",
          own ? "hover:bg-chat-on-accent/20" : "text-chat-ink-soft hover:bg-chat-ink/8",
        )}
      >
        <Download className="size-3.5" />
      </button>
    </span>
  );
}

export function TranscriptChat({
  messages,
  showSenders,
}: {
  messages: TranscriptMessage[];
  showSenders: boolean;
}) {
  const { t, digits } = useI18n();

  const primarySender = useMemo(() => {
    const senders = [...new Set(messages.map((message) => message.senderId).filter(Boolean))];
    return senders.length === 2 ? senders[0] : null;
  }, [messages]);

  if (messages.length === 0) {
    return (
      <p className="py-14 text-center text-[12.5px] text-chat-ink-soft">
        {t("پیامی در این فضا نیست.")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const newDay = !previous || previous.at.slice(0, 10) !== message.at.slice(0, 10);
        const own = primarySender !== null && message.senderId === primarySender;
        const media =
          message.fileId &&
          message.fileMode === "compressed" &&
          isVisualMedia(message.fileMimeType);
        const showName = !own && (showSenders || primarySender !== null);
        const sameSenderAsPrevious = previous && previous.senderId === message.senderId && !newDay;

        return (
          <div key={message.id} className="flex flex-col gap-3">
            {newDay ? (
              <div className="flex justify-center">
                <span className="rounded-full border border-chat-panel-border bg-chat-surface/85 px-3 py-1 text-[10.5px] font-bold text-chat-ink-soft">
                  {message.at}
                </span>
              </div>
            ) : null}
            <div
              className={cn("flex w-full items-end gap-2", own ? "justify-start" : "justify-end")}
            >
              {!own ? (
                sameSenderAsPrevious ? (
                  <span className="size-8 shrink-0" />
                ) : (
                  <UserAvatar name={message.sender} seed={message.senderId ?? 0} size={32} />
                )
              ) : null}
              <div
                className={cn(
                  "flex min-w-0 max-w-[78%] flex-col",
                  own ? "items-start" : "items-end",
                )}
              >
                {showName && !sameSenderAsPrevious ? (
                  <span className="mb-1 px-1 text-[11px] font-bold text-chat-ink-soft">
                    {message.sender}
                  </span>
                ) : null}
                <div
                  className={cn(
                    "min-w-0 overflow-hidden rounded-[20px] shadow-[0_6px_18px_-14px_oklch(0.3_0.06_288/0.55)]",
                    own
                      ? "rounded-es-md bg-chat-sky text-chat-on-accent"
                      : "rounded-ee-md border border-chat-panel-border bg-white/80 text-chat-ink",
                    media && !message.body ? "p-1" : "px-3.5 py-2.5",
                  )}
                >
                  {message.confidential ? (
                    <span
                      className={cn(
                        "mb-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold",
                        own ? "bg-chat-on-accent/20" : "bg-chat-lemon/25 text-chat-ink",
                      )}
                    >
                      <Lock className="size-2.5" />
                      {t("محرمانه")}
                    </span>
                  ) : null}

                  {message.fileId ? (
                    <span className={cn("block", message.body ? "mb-2" : "")}>
                      {media ? (
                        <MediaPreview message={message} />
                      ) : (
                        <AttachmentRow message={message} own={own} />
                      )}
                    </span>
                  ) : null}

                  {message.body ? (
                    <p
                      dir="auto"
                      className="whitespace-pre-wrap break-words text-[13px] leading-relaxed"
                    >
                      {message.body}
                    </p>
                  ) : null}

                  <div
                    className={cn(
                      "mt-1 flex items-center justify-end gap-1.5 text-[10px]",
                      own ? "text-chat-on-accent/80" : "text-chat-ink-soft/80",
                    )}
                  >
                    {message.pinned ? <Pin className="size-3" /> : null}
                    {message.edited ? <span>{t("ویرایش‌شده")}</span> : null}
                    <span dir="ltr">{digits(message.clock)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
