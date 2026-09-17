import {
  ChevronLeft,
  Download,
  FileArchive,
  FileText,
  Film,
  ImageIcon,
  Link2,
  Loader2,
  Play,
  Plus,
  Send,
  Sparkles,
  Vote,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import type { ViewerItem } from "@/components/chat/media-viewer";
import { GlassDialog } from "@/components/ui/glass-dialog";
import {
  fetchAttachments,
  sendSummaryToManagement,
  type AttachmentCategory,
  type AttachmentItem,
  type ChatTarget,
} from "@/lib/chat";
import { fileUrl, formatBytes, saveFile } from "@/lib/files";
import { useI18n } from "@/lib/i18n";
import { useThumbnail } from "@/lib/use-thumbnail";
import {
  addRelatedLink,
  clearManualSummary,
  publishSummary,
  votePoll,
  type ChannelPanel,
  type Digest,
  type PanelFile,
  type Poll,
} from "@/lib/workspace";
import { cn } from "@/lib/utils";

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <p className="text-[12px] font-bold text-chat-ink">{children}</p>
      {action}
    </div>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-0.5 text-[11px] font-bold text-chat-mint-deep transition-opacity hover:opacity-80"
    >
      {children}
      <ChevronLeft className="size-3.5 ltr:rotate-180" />
    </button>
  );
}

function MediaTile({
  fileId,
  name,
  video,
  onOpen,
}: {
  fileId: number;
  name: string;
  video: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const { source } = useThumbnail(fileId);
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
      className="group/tile relative aspect-square cursor-pointer overflow-hidden rounded-xl bg-chat-violet/10 outline-1 -outline-offset-1 outline-chat-ink/5"
    >
      {source ? (
        <img
          src={source}
          alt=""
          draggable={false}
          className="size-full object-cover transition-transform hover:scale-105"
        />
      ) : (
        <span className="grid size-full place-items-center text-chat-violet/70">
          {video ? <Film className="size-4" /> : <ImageIcon className="size-4" />}
        </span>
      )}
      {video ? (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-7 place-items-center rounded-full bg-[oklch(0.15_0.03_280/0.55)] text-[oklch(0.99_0_0)]">
            <Play className="size-3 translate-x-px fill-current" />
          </span>
        </span>
      ) : null}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void saveFile(fileUrl(fileId, "original"), name).catch(() =>
            toast.error(t("دانلود فایل ناموفق بود")),
          );
        }}
        aria-label={t("دانلود {name}", { name })}
        className="absolute end-1 top-1 grid size-6 place-items-center rounded-full bg-[oklch(0.15_0.03_280/0.55)] text-[oklch(0.99_0_0)] opacity-0 transition-opacity hover:bg-[oklch(0.15_0.03_280/0.75)] focus-visible:opacity-100 group-hover/tile:opacity-100"
      >
        <Download className="size-3" />
      </button>
    </div>
  );
}

function FileRow({
  name,
  meta,
  fileId,
  mimeType,
}: {
  name: string;
  meta: string;
  fileId: number;
  mimeType: string | null;
}) {
  const { t } = useI18n();
  const lower = name.toLowerCase();
  const archive = /\.(zip|rar|7z)$/.test(lower);
  const media = (mimeType ?? "").startsWith("image/") || (mimeType ?? "").startsWith("video/");
  const Icon = archive ? FileArchive : media ? ImageIcon : FileText;
  return (
    <button
      type="button"
      onClick={() =>
        void saveFile(fileUrl(fileId, "original"), name).catch(() =>
          toast.error(t("دانلود فایل ناموفق بود")),
        )
      }
      className="flex w-full items-center gap-2.5 rounded-2xl border border-chat-panel-border bg-white/55 p-2 text-start transition-colors hover:bg-white/85"
    >
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-xl",
          archive ? "bg-chat-lemon/20 text-chat-lemon" : "bg-chat-sky/18 text-chat-sky-deep",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-bold text-chat-ink" dir="auto">
          {name}
        </span>
        <span className="block truncate text-[10.5px] text-chat-ink-soft">{meta}</span>
      </span>
      <Download className="size-3.5 shrink-0 text-chat-ink-soft" />
    </button>
  );
}

function PollSummary({
  poll,
  onVote,
}: {
  poll: Poll;
  onVote: (pollId: number, optionId: number) => void;
}) {
  const { t, digits } = useI18n();
  return (
    <div className="space-y-2 rounded-2xl border border-chat-panel-border bg-white/55 p-3">
      <p className="flex items-start gap-2 text-[12px] font-bold leading-relaxed text-chat-ink">
        <Vote className="mt-0.5 size-3.5 shrink-0 text-chat-violet" />
        <span className="min-w-0 flex-1" dir="auto">
          {poll.question}
        </span>
      </p>
      {poll.options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={poll.isClosed}
          onClick={() => onVote(poll.pollId, option.id)}
          className={cn(
            "relative w-full overflow-hidden rounded-xl border px-2.5 py-1.5 text-start transition-colors",
            poll.myOptionId === option.id
              ? "border-chat-violet/30 bg-chat-violet/12"
              : "border-chat-panel-border bg-white/60 hover:bg-white",
          )}
        >
          <span
            className="absolute inset-y-0 start-0 bg-chat-violet/10"
            style={{ width: option.percent }}
          />
          <span className="relative flex items-center gap-2 text-[11px] font-bold text-chat-ink">
            <span className="min-w-0 flex-1 truncate" dir="auto">
              {option.label}
            </span>
            <span className="text-chat-ink-soft">{digits(option.percent)}</span>
          </span>
        </button>
      ))}
      <p className="text-[10.5px] text-chat-ink-soft">
        {poll.isClosed ? `${t("بسته‌شده")} • ` : ""}
        {t("{count} رأی", { count: digits(poll.totalVotes) })}
      </p>
    </div>
  );
}

function AttachmentsDialog({
  target,
  category,
  onClose,
  onOpenMedia,
}: {
  target: ChatTarget;
  category: AttachmentCategory | null;
  onClose: () => void;
  onOpenMedia: (items: ViewerItem[], index: number) => void;
}) {
  const { t, digits, day } = useI18n();
  const [items, setItems] = useState<AttachmentItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (next?: number) => {
      if (!category) return;
      setLoading(true);
      try {
        const page = await fetchAttachments(target, category, next);
        setItems((current) => (next ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
      } catch {
        toast.error(t("بارگذاری فهرست ناموفق بود"));
      } finally {
        setLoading(false);
      }
    },
    [category, target, t],
  );

  useEffect(() => {
    if (!category) return;
    setItems([]);
    void load();
  }, [category, load]);

  const media = items.filter((item) => item.file);
  const viewerItems: ViewerItem[] = media.map((item) => ({
    fileId: item.file!.id,
    name: item.file!.originalName ?? t("رسانه"),
    mimeType: item.file!.mimeType,
    sender: item.senderName,
    createdAt: item.createdAt,
    ...(item.body ? { caption: item.body } : {}),
  }));

  return (
    <GlassDialog
      open={category !== null}
      onClose={onClose}
      size="lg"
      title={category === "media" ? t("گالری رسانه‌ها") : t("فایل‌ها")}
      description={
        category === "media"
          ? t("همهٔ عکس‌ها و ویدیوهای فشرده‌ای که در این گفتگو فرستاده شده است.")
          : t("همهٔ فایل‌هایی که بدون فشرده‌سازی در این گفتگو فرستاده شده است.")
      }
    >
      <div className="grid gap-3">
        {items.length === 0 && !loading ? (
          <p className="py-10 text-center text-[12px] text-chat-ink-soft">
            {t("هنوز موردی ثبت نشده است.")}
          </p>
        ) : null}
        {category === "media" ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {media.map((item, index) => (
              <MediaTile
                key={item.id}
                fileId={item.file!.id}
                name={item.file!.originalName ?? t("پیوست")}
                video={(item.file!.mimeType ?? "").startsWith("video/")}
                onOpen={() => onOpenMedia(viewerItems, index)}
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-2">
            {media.map((item) => (
              <FileRow
                key={item.id}
                fileId={item.file!.id}
                name={item.file!.originalName ?? t("پیوست")}
                mimeType={item.file!.mimeType}
                meta={`${item.senderName} • ${day(item.createdAt, { day: "numeric", month: "short", year: "numeric" })} • ${formatBytes(item.file!.sizeBytes, digits)}`}
              />
            ))}
          </div>
        )}
        {loading ? <Loader2 className="mx-auto size-5 animate-spin text-chat-ink-soft" /> : null}
        {hasMore && !loading ? (
          <button
            type="button"
            onClick={() => cursor && void load(cursor)}
            className="mx-auto rounded-full border border-chat-panel-border bg-white/60 px-4 py-2 text-[11.5px] font-bold text-chat-ink-soft transition-colors hover:bg-white hover:text-chat-ink"
          >
            {t("موارد بیشتر")}
          </button>
        ) : null}
      </div>
    </GlassDialog>
  );
}

export function ChatPanel({
  target,
  panel,
  digest,
  canPublishSummary,
  onDigestChange,
  onReloadPanel,
  onOpenMessage,
  onOpenMedia,
  mediaRequest,
}: {
  target: ChatTarget;
  panel: ChannelPanel | null;
  digest: Digest | null;
  canPublishSummary: boolean;
  onDigestChange: (digest: Digest | null) => void;
  onReloadPanel: () => void;
  onOpenMessage: (messageId: number) => void;
  onOpenMedia: (items: ViewerItem[], index: number) => void;
  mediaRequest: number;
}) {
  const { t, day, clock } = useI18n();
  const [allFor, setAllFor] = useState<AttachmentCategory | null>(null);

  useEffect(() => {
    if (mediaRequest > 0) setAllFor("media");
  }, [mediaRequest]);
  const [pollsOpen, setPollsOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const polls = panel?.polls ?? [];
  const media = panel?.media ?? [];
  const files = panel?.vault ?? [];
  const links = panel?.links ?? [];

  const title =
    target.type === "channel"
      ? t("پروندهٔ کانال")
      : target.type === "group"
        ? t("پروندهٔ گروه")
        : t("پروندهٔ گفتگو");

  const vote = (pollId: number, optionId: number) =>
    void votePoll(pollId, optionId)
      .then(onReloadPanel)
      .catch(() => toast.error(t("ثبت رأی ناموفق بود")));

  const panelMediaItems: ViewerItem[] = media.map((item: PanelFile) => ({
    fileId: item.fileId,
    name: item.name,
    mimeType: item.mimeType,
    sender: "",
    createdAt: new Date().toISOString(),
  }));

  const sendSummary = async () => {
    if (!digest || digest.bullets.length === 0) {
      toast(t("هنوز خلاصه‌ای برای ارسال آماده نیست"));
      return;
    }
    setBusy(true);
    try {
      await sendSummaryToManagement(target);
      toast.success(t("خلاصه در گزارش‌های مدیریت ثبت شد"));
    } catch {
      toast.error(t("ارسال خلاصه ناموفق بود"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="panel flex h-full min-h-0 flex-col overflow-hidden rounded-[26px]">
      <div className="shrink-0 border-b border-chat-panel-border px-4 py-3.5">
        <p className="font-display text-[14.5px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[11px] text-chat-ink-soft">
          {t("خلاصه، رسانه‌ها، فایل‌ها، لینک‌ها و نظرسنجی‌های همین گفتگو")}
        </p>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <section className="rounded-2xl border border-chat-panel-border bg-gradient-to-br from-chat-violet/12 to-chat-sky/12 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[12px] font-bold text-chat-ink">
              <Sparkles className="size-3.5 text-chat-violet" />
              {t("خلاصهٔ هوشمند")}
            </p>
            {canPublishSummary ? (
              <button
                type="button"
                onClick={() => {
                  if (digest?.isManual) {
                    void clearManualSummary(target)
                      .then((result) => onDigestChange(result.summary))
                      .catch(() => toast.error(t("لغو سنجاق خلاصه ناموفق بود")));
                    return;
                  }
                  setSummaryDraft((digest?.bullets ?? []).map((bullet) => bullet.text).join("\n"));
                  setSummaryOpen(true);
                }}
                className="text-[11px] font-bold text-chat-mint-deep hover:opacity-80"
              >
                {digest?.isManual ? t("لغو خلاصهٔ دستی") : t("ویرایش خلاصه")}
              </button>
            ) : null}
          </div>
          <ul className="custom-scrollbar mt-2 max-h-[190px] space-y-1.5 overflow-y-auto pe-1 text-[11.5px] leading-relaxed text-chat-ink-soft">
            {digest && digest.bullets.length > 0 ? (
              digest.bullets.map((bullet, index) => (
                <li key={`${bullet.kind}-${index}`} className="flex gap-1.5">
                  <span className="text-chat-violet">•</span>
                  {bullet.refMessageId ? (
                    <button
                      type="button"
                      onClick={() => onOpenMessage(bullet.refMessageId!)}
                      className="text-start transition-colors hover:text-chat-ink"
                      dir="auto"
                    >
                      {bullet.text}
                    </button>
                  ) : (
                    <span dir="auto">{bullet.text}</span>
                  )}
                </li>
              ))
            ) : (
              <li>{t("هنوز خلاصه‌ای برای این گفتگو ساخته نشده است.")}</li>
            )}
          </ul>
          {digest ? (
            <p className="mt-2 text-[10px] text-chat-ink-soft">
              {digest.isManual ? t("خلاصهٔ دستی") : t("به‌روزرسانی خودکار")} •{" "}
              {day(digest.generatedAt, { day: "numeric", month: "short" })} •{" "}
              {clock(digest.generatedAt)}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void sendSummary()}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-chat-panel-border bg-white/75 py-1.5 text-[11px] font-bold text-chat-ink transition-colors hover:bg-white disabled:opacity-60"
          >
            <Send className="size-3.5 rtl:-scale-x-100" />
            {t("ارسال خلاصه برای مدیریت")}
          </button>
        </section>

        <section>
          <SectionTitle
            action={
              media.length ? (
                <LinkButton onClick={() => setAllFor("media")}>{t("مشاهده همه")}</LinkButton>
              ) : null
            }
          >
            {t("گالری رسانه‌ها")}
          </SectionTitle>
          {media.length ? (
            <div className="grid grid-cols-3 gap-1.5">
              {media.slice(0, 6).map((item, index) => (
                <MediaTile
                  key={item.fileId}
                  fileId={item.fileId}
                  name={item.name}
                  video={(item.mimeType ?? "").startsWith("video/")}
                  onOpen={() => onOpenMedia(panelMediaItems, index)}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-chat-ink/5 py-3 text-center text-[11px] text-chat-ink-soft">
              {t("هنوز عکس یا ویدیویی فرستاده نشده است")}
            </p>
          )}
        </section>

        <section>
          <SectionTitle
            action={
              files.length ? (
                <LinkButton onClick={() => setAllFor("files")}>{t("مشاهده همه")}</LinkButton>
              ) : null
            }
          >
            {t("فایل‌ها")}
          </SectionTitle>
          <div className="grid gap-1.5">
            {files.slice(0, 4).map((file) => (
              <FileRow
                key={file.fileId}
                fileId={file.fileId}
                name={file.name}
                meta={file.size}
                mimeType={file.mimeType}
              />
            ))}
            {files.length === 0 ? (
              <p className="text-[11px] text-chat-ink-soft">{t("هنوز فایلی فرستاده نشده است.")}</p>
            ) : null}
          </div>
        </section>

        <section>
          <SectionTitle
            action={
              <button
                type="button"
                onClick={() => {
                  setLinkTitle("");
                  setLinkUrl("");
                  setLinkOpen(true);
                }}
                className="flex items-center gap-1 text-[11px] font-bold text-chat-mint-deep hover:opacity-80"
              >
                <Plus className="size-3.5" />
                {t("افزودن")}
              </button>
            }
          >
            {t("لینک‌ها")}
          </SectionTitle>
          <div className="grid gap-1.5">
            {links.map((link) => (
              <a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2.5 rounded-2xl border border-chat-panel-border bg-white/55 p-2 transition-colors hover:bg-white/85"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-chat-mint/15 text-chat-mint-deep">
                  <Link2 className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-bold text-chat-ink" dir="auto">
                    {link.title}
                  </span>
                  <span className="block truncate text-[10.5px] text-chat-ink-soft" dir="ltr">
                    {link.url}
                  </span>
                </span>
              </a>
            ))}
            {links.length === 0 ? (
              <p className="text-[11px] text-chat-ink-soft">{t("لینکی ثبت نشده است.")}</p>
            ) : null}
          </div>
        </section>

        <section>
          <SectionTitle
            action={
              polls.length > 1 ? (
                <LinkButton onClick={() => setPollsOpen(true)}>{t("مشاهده همه")}</LinkButton>
              ) : null
            }
          >
            {t("نظرسنجی‌ها")}
          </SectionTitle>
          {polls[0] ? (
            <PollSummary poll={polls[0]} onVote={vote} />
          ) : (
            <p className="text-[11px] text-chat-ink-soft">
              {t("نظرسنجی‌ای در این گفتگو ساخته نشده است.")}
            </p>
          )}
        </section>
      </div>

      <AttachmentsDialog
        target={target}
        category={allFor}
        onClose={() => setAllFor(null)}
        onOpenMedia={onOpenMedia}
      />

      <GlassDialog
        open={pollsOpen}
        onClose={() => setPollsOpen(false)}
        size="lg"
        title={t("همهٔ نظرسنجی‌ها")}
        description={t("نظرسنجی‌های این گفتگو، از جدیدترین به قدیمی‌ترین.")}
      >
        <div className="grid gap-2.5 sm:grid-cols-2">
          {polls.map((poll) => (
            <PollSummary key={poll.pollId} poll={poll} onVote={vote} />
          ))}
        </div>
      </GlassDialog>

      <GlassDialog
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        title={t("افزودن لینک")}
        description={t("لینک‌های مهم این گفتگو را برای دسترسی سریع همه ثبت کنید.")}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            void addRelatedLink(target, linkTitle.trim(), linkUrl.trim())
              .then(() => {
                setLinkOpen(false);
                onReloadPanel();
              })
              .catch(() =>
                toast.error(t("افزودن لینک ناموفق بود؛ نشانی باید با http یا https شروع شود")),
              )
              .finally(() => setBusy(false));
          }}
        >
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold text-chat-ink-soft">
              {t("عنوان")}
            </span>
            <input
              autoFocus
              value={linkTitle}
              maxLength={160}
              onChange={(event) => setLinkTitle(event.target.value)}
              className="w-full rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-[13px] text-chat-ink outline-none focus:border-chat-violet/40 focus:bg-white"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold text-chat-ink-soft">
              {t("نشانی")}
            </span>
            <input
              value={linkUrl}
              dir="ltr"
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder="https://"
              className="w-full rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-[13px] text-chat-ink outline-none focus:border-chat-violet/40 focus:bg-white"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !linkTitle.trim() || !linkUrl.trim()}
            className="rounded-full bg-chat-ink px-4 py-2.5 text-[12.5px] font-bold text-chat-on-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {t("ثبت لینک")}
          </button>
        </form>
      </GlassDialog>

      <GlassDialog
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        title={t("ویرایش خلاصه")}
        description={t("هر نکته را در یک خط بنویسید؛ حداکثر پنج نکته نمایش داده می‌شود.")}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const bullets = summaryDraft
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .slice(0, 5);
            if (!bullets.length) return;
            setBusy(true);
            void publishSummary(target, bullets)
              .then((result) => {
                onDigestChange(result.summary);
                setSummaryOpen(false);
              })
              .catch(() => toast.error(t("ثبت خلاصه ناموفق بود")))
              .finally(() => setBusy(false));
          }}
        >
          <textarea
            autoFocus
            rows={6}
            value={summaryDraft}
            onChange={(event) => setSummaryDraft(event.target.value)}
            className="w-full resize-none rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-[13px] leading-relaxed text-chat-ink outline-none focus:border-chat-violet/40 focus:bg-white"
          />
          <button
            type="submit"
            disabled={busy || !summaryDraft.trim()}
            className="rounded-full bg-chat-ink px-4 py-2.5 text-[12.5px] font-bold text-chat-on-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {t("ثبت خلاصهٔ دستی")}
          </button>
        </form>
      </GlassDialog>
    </aside>
  );
}
