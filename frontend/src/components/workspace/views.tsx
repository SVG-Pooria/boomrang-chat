import { BellRing, CheckCheck, Megaphone } from "lucide-react";

import { GlassPanel, PanelHeader, Chip } from "@/components/workspace/panel";
import { useI18n } from "@/lib/i18n";
import type { Announcement } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const TONE_STYLE: Record<Announcement["tone"], string> = {
  هشدار: "bg-chat-rose/12 border-chat-rose/25",
  رسمی: "bg-chat-sky/10 border-chat-sky/25",
  عادی: "bg-white/60 border-chat-panel-border",
};

export function WorkspaceStatus({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <GlassPanel className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-[13px] font-bold text-chat-ink">
        {failed ? t("بارگذاری فضای کاری ناموفق بود") : t("در حال بارگذاری فضای کاری…")}
      </p>
      {failed ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-xl bg-chat-ink px-3.5 py-1.5 text-[11px] font-bold text-chat-on-ink hover:bg-chat-ink/90"
        >
          {t("تلاش دوباره")}
        </button>
      ) : null}
    </GlassPanel>
  );
}

export function AnnouncementsView({
  announcements,
  pendingAck,
  onAcknowledge,
  canPublish,
  onPublish,
}: {
  announcements: Announcement[];
  pendingAck: number;
  onAcknowledge: (item: Announcement) => void;
  canPublish: boolean;
  onPublish: () => void;
}) {
  const { t, digits } = useI18n();
  return (
    <GlassPanel className="flex h-full flex-col overflow-hidden">
      <PanelHeader
        title="ابلاغیه‌های رسمی"
        subtitle="اطلاعیه‌هایی که هیئت مدیره برای همهٔ کارکنان منتشر می‌کند؛ مواردی که تأیید دریافت لازم دارند بالاتر نشان داده می‌شوند"
        action={
          <div className="flex items-center gap-2">
            {pendingAck > 0 ? (
              <Chip tone="rose">
                {t("{count} مورد در انتظار تأیید شما", { count: digits(pendingAck) })}
              </Chip>
            ) : null}
            {canPublish ? (
              <button
                type="button"
                onClick={onPublish}
                className="flex items-center gap-1.5 rounded-full bg-chat-ink px-3.5 py-1.5 text-[11.5px] font-bold text-chat-on-ink transition-opacity hover:opacity-90"
              >
                <Megaphone className="size-3.5" />
                {t("ابلاغیهٔ جدید")}
              </button>
            ) : null}
          </div>
        }
      />
      <div className="custom-scrollbar min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
        {announcements.map((item) => (
          <article
            key={item.id}
            className={cn("rounded-2xl border p-4", TONE_STYLE[item.tone] ?? TONE_STYLE["عادی"])}
          >
            <div className="flex items-start gap-2">
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-chat-violet/12 text-chat-violet">
                <BellRing className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold leading-snug text-chat-ink">{item.title}</p>
                <p className="mt-0.5 text-[11px] text-chat-ink-soft">
                  {item.author} — {item.time}
                </p>
              </div>
              <Chip tone={item.tone === "هشدار" ? "rose" : item.tone === "رسمی" ? "sky" : "ink"}>
                {item.tone}
              </Chip>
            </div>
            <p
              className="mt-2.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-chat-ink"
              dir="auto"
            >
              {item.body}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[10.5px] text-chat-ink-soft">{item.seen}</span>
              {item.mustAck ? (
                item.acked ? (
                  <span className="ms-auto flex items-center gap-1 rounded-full bg-chat-mint/16 px-2.5 py-1 text-[10.5px] font-bold text-chat-mint-deep">
                    <CheckCheck className="size-3" />
                    {t("دریافت را تأیید کرده‌اید")}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onAcknowledge(item)}
                    className="ms-auto flex items-center gap-1.5 rounded-full bg-chat-mint px-3.5 py-1.5 text-[11.5px] font-bold text-chat-on-accent transition-opacity hover:opacity-90"
                  >
                    <CheckCheck className="size-3.5" />
                    {t("تأیید دریافت")}
                  </button>
                )
              ) : null}
            </div>
          </article>
        ))}
        {announcements.length === 0 ? (
          <div className="grid gap-1.5 py-16 text-center">
            <p className="text-[12.5px] font-bold text-chat-ink">
              {t("ابلاغیه‌ای منتشر نشده است.")}
            </p>
            <p className="mx-auto max-w-sm text-[11.5px] leading-relaxed text-chat-ink-soft">
              {t(
                "ابلاغیه‌ها اطلاعیه‌های رسمی سازمان هستند؛ هیئت مدیره آن‌ها را منتشر می‌کند و هر ابلاغیه‌ای که تأیید دریافت لازم داشته باشد، اینجا برای شما دکمهٔ تأیید نشان می‌دهد.",
              )}
            </p>
          </div>
        ) : null}
      </div>
    </GlassPanel>
  );
}
