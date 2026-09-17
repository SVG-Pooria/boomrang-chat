import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Download, FileText, TrendingUp } from "lucide-react";

import { ManagerShell } from "@/components/manager/ManagerShell";
import {
  Panel,
  PanelHeader,
  Meter,
  fa,
  SolidButton,
  toneSoftBg,
  toneText,
} from "@/components/manager/ui";
import { RequireRole } from "@/components/require-role";
import { useI18n } from "@/lib/i18n";
import { fetchReports, useManagerResource, WORKSPACE_EVENTS } from "@/lib/manager";
import { printDocument } from "@/lib/print";
import { T } from "@/components/ui/t";

export const Route = createFileRoute("/manager/reports")({
  head: () => ({
    meta: [
      { title: "گزارش‌های مدیریتی — بومرنگ" },
      {
        name: "description",
        content: "گزارش عملکرد واحد: زمان پاسخ کارتابل، نرخ بستن وظایف و فعالیت هفتگی تیم.",
      },
    ],
  }),
  component: ReportsRoute,
});

function ReportsRoute() {
  return (
    <RequireRole roles={["management", "manager"]}>
      <ReportsPage />
    </RequireRole>
  );
}

function ReportsPage() {
  const { t, digits } = useI18n();
  const navigate = useNavigate();
  const { data } = useManagerResource(fetchReports, WORKSPACE_EVENTS);
  const weekly = data?.weekly ?? [];
  const metrics = data?.metrics ?? [];
  const contributions = data?.contributions ?? [];
  const summaries = data?.summaries ?? [];
  const max = Math.max(1, ...weekly.map((entry) => entry.value));

  const exportPdf = () => {
    if (!data) return;
    printDocument({
      title: t("گزارش عملکرد {unit}", { unit: data.unit }),
      subtitle: t("بازهٔ ۳۰ روز گذشته"),
      meta: [
        t("تعداد گزارش‌های دریافتی: {count}", { count: digits(summaries.length) }),
        t("اعضای فعال: {count}", { count: digits(contributions.length) }),
      ],
      blocks: [
        {
          kind: "table",
          heading: t("شاخص‌های کلیدی"),
          columns: [t("شاخص"), t("مقدار"), t("تغییر")],
          rows: metrics.map((metric) => [metric.label, metric.value, metric.delta]),
        },
        {
          kind: "table",
          heading: t("فعالیت هفتگی واحد"),
          columns: [t("روز"), t("تعداد")],
          rows: weekly.map((entry) => [entry.label, digits(entry.value)]),
        },
        {
          kind: "table",
          heading: t("سهم اعضا از کارهای بسته‌شده"),
          columns: [t("عضو"), t("سهم")],
          rows: contributions.map((person) => [person.name, `${digits(person.value)}٪`]),
        },
        {
          kind: "table",
          heading: t("گزارش‌های ارسال‌شده به مدیریت"),
          columns: [t("عنوان"), t("فرستنده"), t("زمان")],
          rows: summaries.map((report) => [report.targetName, report.sender, report.time]),
        },
      ],
    });
  };

  return (
    <ManagerShell
      fit
      title="گزارش‌ها"
      subtitle={data ? `عملکرد ${data.unit} در بازه ۳۰ روز گذشته` : ""}
      actions={
        <SolidButton onClick={exportPdf}>
          <Download className="size-3.5" strokeWidth={2.25} />
          <T>دریافت PDF</T>
        </SolidButton>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="grid shrink-0 grid-cols-1 gap-4 md:grid-cols-3">
          {metrics.map((metric) => (
            <Panel key={metric.label} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-display text-[24px] font-semibold leading-none">
                    {digits(metric.value)}
                  </p>
                  <p className="mt-2 text-[13px] font-medium">{t(metric.label)}</p>
                  <p className="mt-1 text-[11.5px] text-chat-ink-soft">{t(metric.delta)}</p>
                </div>
                <span
                  className={`grid size-9 place-items-center rounded-2xl ${toneSoftBg[metric.tone]} ${toneText[metric.tone]}`}
                >
                  <TrendingUp className="size-[18px]" strokeWidth={1.75} />
                </span>
              </div>
            </Panel>
          ))}
        </div>

        <div className="grid shrink-0 grid-cols-1 items-start gap-4 lg:grid-cols-12">
          <Panel className="lg:col-span-7">
            <PanelHeader
              title="فعالیت هفتگی واحد"
              subtitle="تعداد پیام و اقدام ثبت‌شده در هر روز"
            />
            <div className="flex h-44 items-end gap-3 px-6 pb-5">
              {weekly.map((entry) => (
                <div
                  key={entry.label}
                  className="flex h-full flex-1 flex-col items-center justify-end gap-2"
                >
                  <span className="text-[11px] text-chat-ink-soft">{fa(entry.value)}</span>
                  <div
                    className="w-full rounded-t-2xl bg-gradient-to-t from-chat-sky-deep/70 to-chat-mint/70"
                    style={{ height: `${Math.max(8, (entry.value / max) * 78)}%` }}
                  />
                  <span className="text-[11px] text-chat-ink-soft">{entry.label}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="lg:col-span-5">
            <PanelHeader title="سهم اعضا از کارهای بسته‌شده" subtitle="۳۰ روز گذشته" />
            <ul className="custom-scrollbar max-h-56 space-y-3 overflow-y-auto px-6 pb-6">
              {data && contributions.length === 0 ? (
                <li className="text-[12.5px] text-chat-ink-soft">
                  <T>هنوز همکاری به‌عنوان زیرمجموعهٔ مستقیم شما ثبت نشده است.</T>
                </li>
              ) : null}
              {contributions.map((person) => (
                <li key={person.userId}>
                  <div className="mb-1.5 flex items-center justify-between text-[12px]">
                    <span>{person.name}</span>
                    <span className="text-chat-ink-soft">{fa(person.value)}٪</span>
                  </div>
                  <Meter value={person.value} tone={person.tone} />
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <PanelHeader
            title="گزارش‌های ارسال‌شده به مدیریت"
            subtitle="خلاصهٔ گفتگوها و کانال‌هایی که همکاران برای شما فرستاده‌اند"
          />
          <div className="custom-scrollbar grid min-h-0 flex-1 content-start gap-2.5 overflow-y-auto px-6 pb-6">
            {data && summaries.length === 0 ? (
              <p className="text-[12.5px] text-chat-ink-soft">
                {t("هنوز خلاصه‌ای برای مدیریت ارسال نشده است.")}
              </p>
            ) : null}
            {summaries.map((report) => (
              <button
                key={report.reportId}
                type="button"
                onClick={() =>
                  void navigate({
                    to: "/manager/chat",
                    search: { t: report.targetType, i: report.targetId },
                  })
                }
                className="rounded-2xl border border-chat-panel-border bg-white/60 p-3.5 text-start transition-colors hover:bg-white"
              >
                <div className="flex items-start gap-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-chat-violet/12 text-chat-violet">
                    <FileText className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-bold text-chat-ink">{report.title}</p>
                    <p className="mt-0.5 text-[11px] text-chat-ink-soft">
                      {report.time} — {t("{count} پیام", { count: digits(report.messageCount) })}
                    </p>
                  </div>
                </div>
                <ul className="mt-2 space-y-1 ps-10 text-[11.5px] leading-relaxed text-chat-ink-soft">
                  {report.bullets.slice(0, 4).map((bullet, index) => (
                    <li key={index}>• {bullet}</li>
                  ))}
                </ul>
              </button>
            ))}
          </div>
        </Panel>
      </div>
    </ManagerShell>
  );
}
