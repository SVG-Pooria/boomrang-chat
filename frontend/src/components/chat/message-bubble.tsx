import {
  CheckCheck,
  Download,
  FileArchive,
  FileText,
  Film,
  ImageIcon,
  Lock,
  Forward,
  Pencil,
  Pin,
  PinOff,
  Play,
  Trash2,
  Vote,
} from "lucide-react";
import { toast } from "sonner";

import { UserAvatar } from "@/components/ui/user-avatar";
import type { Attachment, ChatMessage } from "@/lib/chat";
import { fileUrl, saveFile } from "@/lib/files";
import { ReferralCard } from "@/components/chat/referral-card";
import { useI18n } from "@/lib/i18n";
import { useThumbnail } from "@/lib/use-thumbnail";
import type { Poll } from "@/lib/workspace";
import { cn } from "@/lib/utils";

function MediaThumb({ attachment, onOpen }: { attachment: Attachment; onOpen: () => void }) {
  const { t } = useI18n();
  const { source, failed } = useThumbnail(attachment.fileId);
  const isVideo = attachment.type === "video" || attachment.type === "mp4";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group/media relative block w-[min(300px,62vw)] cursor-pointer overflow-hidden rounded-[16px] bg-chat-ink/10"
      aria-label={isVideo ? t("پخش ویدیو") : t("نمایش تصویر")}
    >
      {source ? (
        <img
          src={source}
          alt={attachment.name}
          draggable={false}
          className="block max-h-[320px] w-full object-cover transition-transform duration-300 group-hover/media:scale-[1.02]"
        />
      ) : (
        <span className="grid aspect-[4/3] w-full place-items-center text-chat-ink-soft">
          {failed ? (
            isVideo ? (
              <Film className="size-7" />
            ) : (
              <ImageIcon className="size-7" />
            )
          ) : (
            <span className="size-7 animate-pulse rounded-full bg-chat-ink/15" />
          )}
        </span>
      )}
      {isVideo ? (
        <span className="absolute inset-0 grid place-items-center bg-[oklch(0.15_0.03_280/0.25)]">
          <span className="grid size-12 place-items-center rounded-full bg-[oklch(0.15_0.03_280/0.55)] text-[oklch(0.99_0_0)] backdrop-blur-sm">
            <Play className="size-5 translate-x-px fill-current" />
          </span>
        </span>
      ) : null}
      {attachment.fileId ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void saveFile(fileUrl(attachment.fileId!, "original"), attachment.name).catch(() =>
              toast.error(t("دانلود فایل ناموفق بود")),
            );
          }}
          aria-label={t("دانلود {name}", { name: attachment.name })}
          className="absolute end-2 top-2 grid size-9 place-items-center rounded-full bg-[oklch(0.15_0.03_280/0.55)] text-[oklch(0.99_0_0)] opacity-0 backdrop-blur-sm transition-opacity hover:bg-[oklch(0.15_0.03_280/0.75)] focus-visible:opacity-100 group-hover/media:opacity-100"
        >
          <Download className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

function FileCard({ attachment, own }: { attachment: Attachment; own: boolean }) {
  const { t } = useI18n();
  const isArchive = attachment.type === "zip";
  const isMedia = attachment.type === "image" || attachment.type === "video";
  const Icon = isArchive
    ? FileArchive
    : isMedia
      ? attachment.type === "video"
        ? Film
        : ImageIcon
      : FileText;

  return (
    <div
      className={cn(
        "flex w-[min(280px,60vw)] items-center gap-3 rounded-[14px] p-2",
        own ? "bg-chat-on-accent/15" : "bg-chat-ink/5",
      )}
    >
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-xl",
          own ? "bg-chat-on-accent/20 text-chat-on-accent" : "bg-chat-sky/18 text-chat-sky-deep",
        )}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-bold" dir="auto">
          {attachment.name}
        </p>
        <p
          className={cn(
            "mt-0.5 text-[10.5px]",
            own ? "text-chat-on-accent/80" : "text-chat-ink-soft",
          )}
        >
          {attachment.size}
        </p>
      </div>
      {attachment.fileId ? (
        <button
          type="button"
          onClick={() =>
            void saveFile(fileUrl(attachment.fileId!, "original"), attachment.name).catch(() =>
              toast.error(t("دانلود فایل ناموفق بود")),
            )
          }
          aria-label={t("دانلود {name}", { name: attachment.name })}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full transition-colors",
            own
              ? "hover:bg-chat-on-accent/20"
              : "text-chat-ink-soft hover:bg-chat-ink/8 hover:text-chat-ink",
          )}
        >
          <Download className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

function PollCard({
  poll,
  own,
  onVote,
}: {
  poll: Poll;
  own: boolean;
  onVote: (pollId: number, optionId: number) => void;
}) {
  const { t, digits } = useI18n();
  return (
    <div className="w-[min(300px,64vw)]">
      <p className="flex items-center gap-1.5 text-[11px] font-bold opacity-80">
        <Vote className="size-3.5" />
        {poll.isClosed ? t("نظرسنجی بسته‌شده") : t("نظرسنجی")}
      </p>
      <p className="mt-1 text-[13.5px] font-bold leading-relaxed" dir="auto">
        {poll.question}
      </p>
      <div className="mt-2.5 grid gap-1.5">
        {poll.options.map((option) => {
          const mine = poll.myOptionId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              disabled={poll.isClosed}
              onClick={() => onVote(poll.pollId, option.id)}
              className={cn(
                "relative overflow-hidden rounded-xl px-3 py-2 text-start transition-colors disabled:cursor-default",
                own
                  ? mine
                    ? "bg-chat-on-accent/30"
                    : "bg-chat-on-accent/12 hover:bg-chat-on-accent/20"
                  : mine
                    ? "bg-chat-violet/18 text-chat-ink"
                    : "bg-chat-ink/5 hover:bg-chat-ink/8",
              )}
            >
              <span
                className={cn(
                  "absolute inset-y-0 start-0",
                  own ? "bg-chat-on-accent/15" : "bg-chat-violet/12",
                )}
                style={{ width: option.percent }}
              />
              <span className="relative flex items-center gap-2 text-[12px] font-bold">
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  {option.label}
                </span>
                <span className="shrink-0 text-[11px] opacity-80">{digits(option.percent)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[10.5px] opacity-75">
        {t("{count} رأی", { count: digits(poll.totalVotes) })}
      </p>
    </div>
  );
}

export function MessageBubble({
  message,
  showSender,
  poll,
  highlighted,
  editing,
  editDraft,
  canPin,
  onEditDraftChange,
  onEditSubmit,
  onEditCancel,
  onPin,
  onEdit,
  onDelete,
  onVote,
  onOpenMedia,
  onForward,
  viewerId = null,
}: {
  message: ChatMessage;
  showSender: boolean;
  viewerId?: number | null;
  poll?: Poll | undefined;
  highlighted: boolean;
  editing: boolean;
  editDraft: string;
  canPin: boolean;
  onEditDraftChange: (value: string) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
  onPin: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onVote: (pollId: number, optionId: number) => void;
  onOpenMedia: (fileId: number) => void;
  onForward: (message: ChatMessage) => void;
}) {
  const { t } = useI18n();
  const own = message.role === "user";
  const attachment = message.attachments?.[0];
  const visualMedia =
    attachment &&
    attachment.mode === "compressed" &&
    (attachment.type === "image" || attachment.type === "video");
  const isPoll = message.kind === "poll" && poll;
  const referral = message.referral;
  const text = isPoll || referral ? "" : message.content;
  const canEdit = own && !attachment && !isPoll && !referral;

  const actions = [
    !isPoll && !referral
      ? {
          key: "forward",
          icon: Forward,
          label: t("هدایت پیام"),
          run: () => onForward(message),
        }
      : null,
    canPin
      ? {
          key: "pin",
          icon: message.pinned ? PinOff : Pin,
          label: message.pinned ? t("برداشتن سنجاق") : t("سنجاق کردن"),
          run: () => onPin(message),
        }
      : null,
    canEdit ? { key: "edit", icon: Pencil, label: t("ویرایش"), run: () => onEdit(message) } : null,
    own ? { key: "delete", icon: Trash2, label: t("حذف"), run: () => onDelete(message) } : null,
  ].filter((action) => action !== null);

  return (
    <div
      id={`message-${message.id}`}
      className={cn("group flex w-full items-end gap-2", own ? "justify-start" : "justify-end")}
    >
      {!own && showSender ? (
        <UserAvatar name={message.sender} seed={message.senderId} size={32} className="mb-5" />
      ) : null}

      <div className={cn("flex min-w-0 max-w-[78%] flex-col", own ? "items-start" : "items-end")}>
        {!own && showSender ? (
          <span className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-bold text-chat-ink-soft">
            {message.sender}
          </span>
        ) : null}

        <div className={cn("flex items-center gap-1.5", own ? "flex-row" : "flex-row-reverse")}>
          <div
            className={cn(
              "relative min-w-0 overflow-hidden rounded-[20px] shadow-[0_6px_18px_-14px_oklch(0.3_0.06_288/0.55)] transition-shadow",
              own
                ? "rounded-es-md text-chat-on-accent"
                : "rounded-ee-md border border-chat-panel-border bg-white/80 text-chat-ink",
              visualMedia && !text ? "p-1" : "px-3.5 py-2.5",
              highlighted && "ring-2 ring-chat-lemon ring-offset-2 ring-offset-chat-surface",
            )}
            style={own ? { background: "var(--chat-bubble-own, var(--chat-sky))" } : undefined}
          >
            {message.forwardFrom ? (
              <span
                className={cn(
                  "mb-1.5 flex items-center gap-1 text-[10.5px] font-bold",
                  own ? "text-chat-on-accent/85" : "text-chat-violet",
                )}
              >
                <Forward className="size-3 rtl:-scale-x-100" />
                {t("هدایت‌شده از {name}", { name: message.forwardFrom })}
              </span>
            ) : null}

            {message.classification ? (
              <span
                className={cn(
                  "mb-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold",
                  own ? "bg-chat-on-accent/20" : "bg-chat-lemon/25 text-chat-ink",
                )}
              >
                <Lock className="size-2.5" />
                {message.classification}
              </span>
            ) : null}

            {attachment ? (
              visualMedia ? (
                <div className={cn(text ? "-mx-2 -mt-1 mb-2" : "")}>
                  <MediaThumb
                    attachment={attachment}
                    onOpen={() => attachment.fileId && onOpenMedia(attachment.fileId)}
                  />
                </div>
              ) : (
                <div className={cn(text ? "mb-2" : "")}>
                  <FileCard attachment={attachment} own={own} />
                </div>
              )
            ) : null}

            {isPoll && poll ? <PollCard poll={poll} own={own} onVote={onVote} /> : null}

            {referral ? <ReferralCard referral={referral} own={own} viewerId={viewerId} /> : null}

            {editing ? (
              <textarea
                value={editDraft}
                autoFocus
                rows={2}
                onChange={(event) => onEditDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    onEditSubmit();
                  }
                  if (event.key === "Escape") onEditCancel();
                }}
                onBlur={onEditSubmit}
                className="block w-[min(420px,60vw)] resize-none bg-transparent leading-relaxed outline-none"
                style={{ fontSize: "var(--chat-message-size, 13.5px)" }}
              />
            ) : text ? (
              <p
                dir="auto"
                className="whitespace-pre-wrap break-words leading-relaxed"
                style={{ fontSize: "var(--chat-message-size, 13.5px)" }}
              >
                {text}
              </p>
            ) : null}

            <div
              className={cn(
                "mt-1 flex items-center justify-end gap-1.5 text-[10px] font-medium",
                own ? "text-chat-on-accent/80" : "text-chat-ink-soft/80",
                visualMedia &&
                  !text &&
                  "absolute bottom-2 end-2 mt-0 rounded-full bg-[oklch(0.15_0.03_280/0.55)] px-2 py-0.5 text-[oklch(0.99_0_0)]",
              )}
            >
              {message.pinned ? <Pin className="size-3" /> : null}
              {message.edited ? <span>{t("ویرایش‌شده")}</span> : null}
              <span dir="ltr">{message.time}</span>
              {own && message.seenBy ? (
                <span title={message.seenBy}>
                  <CheckCheck className="size-3.5" />
                </span>
              ) : null}
            </div>
          </div>

          {actions.length ? (
            <div className="flex shrink-0 flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {actions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  title={action.label}
                  aria-label={action.label}
                  onClick={action.run}
                  className="grid size-7 place-items-center rounded-full border border-chat-panel-border bg-chat-surface/90 text-chat-ink-soft shadow-sm transition-colors hover:text-chat-ink"
                >
                  <action.icon className="size-3.5" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
