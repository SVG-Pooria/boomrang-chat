import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { RequireRole } from "@/components/require-role";
import { Inbox, Stamp, ListChecks, Users, ArrowLeft, CalendarDays, Video } from "lucide-react";
import { ManagerShell } from "@/components/manager/ManagerShell";
import {
  Panel,
  PanelHeader,
  Chip,
  Avatar,
  GhostButton,
  toneDot,
  toneSoftBg,
  toneText,
} from "@/components/manager/ui";
import { useI18n } from "@/lib/i18n";
import { fetchOverview, PRESENCE_EVENTS, statusLabels, useManagerResource } from "@/lib/manager";
import { T } from "@/components/ui/t";

export const Route = createFileRoute("/manager/")({
  head: () => ({
    meta: [
      { title: "پنل مدیریت بومرنگ — نمای کلی تیم" },
      {
        name: "description",
        content: "نمای مدیریتی کارتابل، وظایف تیم، تأییدها و حضور همکاران در چت سازمانی بومرنگ.",
      },
      { property: "og:title", content: "پنل مدیریت بومرنگ — نمای کلی تیم" },
      {
        property: "og:description",
        content: "نمای مدیریتی کارتابل، وظایف تیم، تأییدها و حضور همکاران در چت سازمانی بومرنگ.",
      },
    ],
  }),
  component: OverviewRoute,
});

function OverviewRoute() {
  return (
    <RequireRole roles={["management", "manager"]}>
      <OverviewPage />
    </RequireRole>
  );
}

const icons = { inbox: Inbox, stamp: Stamp, tasks: ListChecks, team: Users };

function OverviewPage() {
  const { t, digits } = useI18n();
  const navigate = useNavigate();
  const { data } = useManagerResource(fetchOverview, PRESENCE_EVENTS);
  const kpis = data?.kpis ?? [];
  const requests = data?.requests ?? [];
  const timeline = data?.timeline ?? [];
  const meetings = data?.meetings ?? [];
  const team = data?.team ?? [];

  return (
    <ManagerShell
      fit
      title="نمای مدیریت"
      subtitle="خلاصه‌ای از کارتابل، تیم و جریان کارهای امروز"
      actions={
        <GhostButton onClick={() => void navigate({ to: "/manager/reports" })}>
          <T>گزارش هفتگی</T>
        </GhostButton>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="grid shrink-0 grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((kpi) => {
            const Icon = icons[kpi.icon];
            return (
              <Panel key={kpi.key} className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-display text-[24px] font-semibold leading-none">
                      {digits(kpi.value)}
                    </p>
                    <p className="mt-1.5 text-[12.5px] font-medium">{t(kpi.label)}</p>
                    <p className="mt-0.5 text-[11px] text-chat-ink-soft">{t(kpi.hint)}</p>
                  </div>
                  <span
                    className={`grid size-9 place-items-center rounded-2xl ${toneSoftBg[kpi.tone]} ${toneText[kpi.tone]}`}
                  >
                    <Icon className="size-[18px]" strokeWidth={1.75} />
                  </span>
                </div>
              </Panel>
            );
          })}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-12">
          <Panel className="flex min-h-0 flex-col overflow-hidden lg:col-span-7">
            <PanelHeader
              title="کارتابل مدیریتی"
              subtitle="درخواست‌هایی که منتظر تصمیم شما هستند"
              action={
                <Link
                  to="/manager/inbox"
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-chat-sky-deep"
                >
                  <T>همه موارد</T>
                  <ArrowLeft className="size-3.5" strokeWidth={2} />
                </Link>
              }
            />
            <ul className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-4">
              {data && requests.length === 0 ? (
                <li className="px-3 py-3 text-[12.5px] text-chat-ink-soft">
                  <T>درخواستی منتظر تصمیم شما نیست.</T>
                </li>
              ) : null}
              {requests.map((r) => (
                <li
                  key={r.requestId}
                  className="flex items-center gap-3 rounded-[20px] px-3 py-3 transition-colors hover:bg-white/70"
                >
                  <span className={`size-2 shrink-0 rounded-full ${toneDot[r.tone]}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">{r.title}</p>
                    <p className="mt-1 text-[11.5px] text-chat-ink-soft">
                      {r.person} • {r.unit} • {r.stage}
                    </p>
                  </div>
                  <Chip tone={r.tone}>{r.priority}</Chip>
                  <span className="hidden shrink-0 text-[11.5px] text-chat-ink-soft sm:block">
                    {r.time}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <div className="grid min-h-0 gap-4 lg:col-span-5 lg:grid-rows-2">
            <Panel className="flex min-h-0 flex-col overflow-hidden">
              <PanelHeader
                title="جریان کار تیم"
                subtitle="آنچه امروز در واحد شما اتفاق افتاده است"
              />
              <ul className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pb-5">
                {data && timeline.length === 0 ? (
                  <li className="text-[12.5px] text-chat-ink-soft">
                    <T>هنوز رویدادی از تیم شما ثبت نشده است.</T>
                  </li>
                ) : null}
                {timeline.map((t, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="relative mt-1.5 flex flex-col items-center">
                      <span className={`size-2 rounded-full ${toneDot[t.tone]}`} />
                      {i < timeline.length - 1 ? (
                        <span className="mt-1 h-full w-px flex-1 bg-chat-ink/10" />
                      ) : null}
                    </span>
                    <div className="pb-1">
                      <p className="text-[12.5px] leading-relaxed">
                        <span className="font-semibold">{t.who}</span>{" "}
                        <span className="text-chat-ink-soft">{t.what}</span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-chat-ink-soft">{t.when}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel className="flex min-h-0 flex-col overflow-hidden">
              <PanelHeader title="جلسات پیش‌رو" subtitle="از تقویم مشترک واحد" />
              <ul className="custom-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-5">
                {data && meetings.length === 0 ? (
                  <li className="px-3 py-3 text-[12.5px] text-chat-ink-soft">
                    <T>جلسهٔ پیش‌رویی برای شما و تیمتان ثبت نشده است.</T>
                  </li>
                ) : null}
                {meetings.map((m) => (
                  <li
                    key={m.meetingId}
                    className="flex items-center gap-3 rounded-[20px] bg-white/60 px-3 py-3"
                  >
                    <span
                      className={`grid size-9 place-items-center rounded-2xl ${toneSoftBg[m.tone]} ${toneText[m.tone]}`}
                    >
                      {m.tone === "sky" ? (
                        <Video className="size-[17px]" strokeWidth={1.75} />
                      ) : (
                        <CalendarDays className="size-[17px]" strokeWidth={1.75} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{m.title}</p>
                      <p className="mt-0.5 text-[11.5px] text-chat-ink-soft">
                        {m.time} • {m.people}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>

        <Panel className="shrink-0">
          <PanelHeader
            title="وضعیت لحظه‌ای تیم"
            subtitle="حضور و بار کاری اعضای واحد شما"
            action={
              <Link
                to="/manager/team"
                className="inline-flex items-center gap-1 text-[12px] font-medium text-chat-sky-deep"
              >
                <T>پرونده تیم</T>
                <ArrowLeft className="size-3.5" strokeWidth={2} />
              </Link>
            }
          />
          <div className="custom-scrollbar flex gap-2 overflow-x-auto px-4 pb-4">
            {data && team.length === 0 ? (
              <p className="px-3 py-2 text-[12.5px] text-chat-ink-soft">
                <T>هنوز همکاری به‌عنوان زیرمجموعهٔ مستقیم شما ثبت نشده است.</T>
              </p>
            ) : null}
            {team.map((p) => (
              <div
                key={p.userId}
                className="flex w-[168px] shrink-0 items-center gap-2.5 rounded-[18px] bg-white/60 px-3 py-2.5"
              >
                <Avatar initials={p.initials} tone={p.tone} />
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-medium">{p.name}</p>
                  <p className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] text-chat-ink-soft">
                    <span
                      className={`size-1.5 rounded-full ${p.status === "online" ? "bg-chat-mint" : p.status === "meeting" ? "bg-chat-sky" : p.status === "away" ? "bg-chat-lemon" : "bg-chat-rose"}`}
                    />
                    {t(statusLabels[p.status])}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </ManagerShell>
  );
}
