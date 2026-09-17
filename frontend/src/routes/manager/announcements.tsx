import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ManagerShell } from "@/components/manager/ManagerShell";
import { RequireRole } from "@/components/require-role";
import { AnnouncementsView } from "@/components/workspace/views";
import { GlassDialog } from "@/components/ui/glass-dialog";
import { readSession } from "@/lib/auth";
import { getSocket } from "@/lib/chat";
import { useI18n } from "@/lib/i18n";
import {
  acknowledgeAnnouncement,
  createAnnouncement,
  fetchAnnouncements,
  type Announcement,
} from "@/lib/workspace";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/manager/announcements")({
  component: AnnouncementsRoute,
});

function AnnouncementsRoute() {
  return (
    <RequireRole roles={["management", "manager"]}>
      <AnnouncementsPage />
    </RequireRole>
  );
}

const TONES = [
  { value: "عادی" as const, label: "عادی", hint: "اطلاع‌رسانی ساده" },
  { value: "رسمی" as const, label: "رسمی", hint: "ابلاغ سازمانی" },
  { value: "هشدار" as const, label: "هشدار", hint: "موضوع فوری" },
];

function AnnouncementsPage() {
  const { t } = useI18n();
  const session = readSession();
  const executive = session?.user.role === "management";
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [pendingAck, setPendingAck] = useState(0);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tone, setTone] = useState<Announcement["tone"]>("رسمی");
  const [mustAck, setMustAck] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await fetchAnnouncements();
      setAnnouncements(result.announcements);
      setPendingAck(result.pendingAck);
    } catch {
      toast.error(t("بارگذاری ابلاغیه‌ها ناموفق بود"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const refresh = () => void load();
    socket.on("workspace:changed", refresh);
    return () => {
      socket.off("workspace:changed", refresh);
    };
  }, [load]);

  const submit = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error(t("عنوان و متن ابلاغیه را کامل کنید"));
      return;
    }
    setBusy(true);
    try {
      await createAnnouncement({ title: title.trim(), body: body.trim(), tone, mustAck });
      toast.success(t("ابلاغیه منتشر شد"));
      setOpen(false);
      setTitle("");
      setBody("");
      await load();
    } catch {
      toast.error(t("انتشار ابلاغیه ناموفق بود"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ManagerShell flush title="ابلاغیه‌ها" subtitle="اطلاعیه‌های رسمی سازمان">
      <AnnouncementsView
        announcements={announcements}
        pendingAck={pendingAck}
        canPublish={executive}
        onPublish={() => setOpen(true)}
        onAcknowledge={(item) =>
          void acknowledgeAnnouncement(item.announcementId)
            .then(load)
            .catch(() => toast.error(t("ثبت تأیید دریافت ناموفق بود")))
        }
      />

      <GlassDialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("ابلاغیهٔ جدید")}
        description={t("این متن برای همهٔ کارکنان سازمان در بخش ابلاغیه‌ها منتشر می‌شود.")}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold text-chat-ink-soft">
              {t("عنوان")}
            </span>
            <input
              autoFocus
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-[13px] text-chat-ink outline-none focus:border-chat-violet/40 focus:bg-white"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold text-chat-ink-soft">
              {t("متن ابلاغیه")}
            </span>
            <textarea
              value={body}
              rows={5}
              maxLength={4000}
              onChange={(event) => setBody(event.target.value)}
              className="w-full resize-none rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-[13px] leading-relaxed text-chat-ink outline-none focus:border-chat-violet/40 focus:bg-white"
            />
          </label>
          <div className="grid gap-1.5">
            <span className="text-[11px] font-bold text-chat-ink-soft">{t("نوع ابلاغیه")}</span>
            <div className="flex flex-wrap gap-2">
              {TONES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTone(option.value)}
                  className={cn(
                    "rounded-2xl border px-3.5 py-2 text-start transition-colors",
                    tone === option.value
                      ? "border-chat-violet/40 bg-chat-violet/10"
                      : "border-chat-panel-border bg-white/60 hover:bg-white",
                  )}
                >
                  <span className="block text-[12px] font-bold text-chat-ink">
                    {t(option.label)}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] text-chat-ink-soft">
                    {t(option.hint)}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between rounded-2xl border border-chat-panel-border bg-white/60 px-3.5 py-2.5">
            <span className="text-[12.5px] font-bold text-chat-ink">
              {t("تأیید دریافت لازم است")}
            </span>
            <input
              type="checkbox"
              checked={mustAck}
              onChange={(event) => setMustAck(event.target.checked)}
              className="size-4 accent-[oklch(0.65_0.19_300)]"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-chat-ink px-4 py-2.5 text-[12.5px] font-bold text-chat-on-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {t("انتشار ابلاغیه")}
          </button>
        </form>
      </GlassDialog>
    </ManagerShell>
  );
}
