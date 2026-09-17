import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Hash, Pin, Plus, Search, Shield, Users2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { ManagerShell } from "@/components/manager/ManagerShell";
import {
  Chip,
  GhostButton,
  Panel,
  PanelHeader,
  SolidButton,
  toneSoftBg,
  toneText,
} from "@/components/manager/ui";
import { RequireRole } from "@/components/require-role";
import { GlassDialog } from "@/components/ui/glass-dialog";
import { useI18n } from "@/lib/i18n";
import {
  createSpace,
  fetchSpaces,
  setSpacePinned,
  SPACE_EVENTS,
  useManagerResource,
  type Space,
} from "@/lib/manager";
import { cn } from "@/lib/utils";
import { T } from "@/components/ui/t";

export const Route = createFileRoute("/manager/spaces")({
  head: () => ({
    meta: [
      { title: "کانال‌ها و گروه‌های واحد — بومرنگ" },
      {
        name: "description",
        content: "مدیریت کانال‌ها، گروه‌ها و فضاهای گفتگوی واحد در چت سازمانی بومرنگ.",
      },
    ],
  }),
  component: SpacesRoute,
});

function SpacesRoute() {
  return (
    <RequireRole roles={["management", "manager"]}>
      <SpacesPage />
    </RequireRole>
  );
}

function SpacesPage() {
  const { t, digits } = useI18n();
  const navigate = useNavigate();
  const { data, reload } = useManagerResource(fetchSpaces, SPACE_EVENTS);
  const spaces = data?.spaces ?? [];
  const rules = data?.rules ?? [];
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{
    kind: "channel" | "group";
    title: string;
    description: string;
    visibility: "public" | "private";
  }>({ kind: "channel", title: "", description: "", visibility: "private" });

  const visibleSpaces = spaces.filter(
    (space) => !query.trim() || space.name.includes(query.trim()),
  );

  const togglePin = useCallback(
    (space: Space) => {
      setSpacePinned(space, !space.pinned)
        .then(() => reload())
        .catch(() => toast.error(t("سنجاق کردن فضا ناموفق بود")));
    },
    [reload, t],
  );

  const submit = () => {
    if (!draft.title.trim()) {
      toast.error(t("نام فضا را بنویسید"));
      return;
    }
    setBusy(true);
    createSpace(draft.kind, {
      title: draft.title.trim(),
      description: draft.description.trim(),
      visibility: draft.visibility,
    })
      .then(() => {
        toast.success(draft.kind === "channel" ? t("کانال ساخته شد") : t("گروه ساخته شد"));
        setCreateOpen(false);
        setDraft({ kind: "channel", title: "", description: "", visibility: "private" });
        return reload();
      })
      .catch(() => toast.error(t("ساخت فضا ناموفق بود")))
      .finally(() => setBusy(false));
  };

  return (
    <ManagerShell
      fit
      title="کانال‌ها و گروه‌ها"
      subtitle="فضاهای گفتگویی که مدیریت آن‌ها بر عهده شماست"
      actions={
        <SolidButton onClick={() => setCreateOpen(true)}>
          <Plus className="size-3.5" strokeWidth={2.25} />
          <T>فضای جدید</T>
        </SolidButton>
      }
    >
      <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel className="flex min-h-0 flex-col overflow-hidden lg:col-span-8">
          <PanelHeader
            title="فضاهای شما"
            subtitle="کانال‌ها و گروه‌هایی که مدیریت آن‌ها بر عهده شماست"
            action={
              <label className="flex items-center gap-2 rounded-full border border-chat-panel-border bg-white/60 px-3 py-1.5">
                <Search className="size-3.5 shrink-0 text-chat-ink-soft" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("جستجوی فضا...")}
                  className="w-36 bg-transparent text-[12px] text-chat-ink outline-none placeholder:text-chat-ink-soft"
                />
              </label>
            }
          />
          <div className="custom-scrollbar grid min-h-0 flex-1 content-start gap-2 overflow-y-auto px-4 pb-4">
            {data && visibleSpaces.length === 0 ? (
              <p className="px-1 py-10 text-center text-[12.5px] text-chat-ink-soft">
                {query
                  ? t("فضایی با این جستجو پیدا نشد.")
                  : t("شما و تیمتان هنوز عضو کانال یا گروهی نیستید.")}
              </p>
            ) : null}
            {visibleSpaces.map((space) => (
              <div
                key={`${space.targetType}-${space.targetId}`}
                className="group flex flex-wrap items-center gap-3 rounded-[20px] border border-chat-panel-border bg-white/65 px-4 py-2.5 transition-colors hover:bg-white"
              >
                <span
                  className={`grid size-9 shrink-0 place-items-center rounded-2xl ${toneSoftBg[space.tone]} ${toneText[space.tone]}`}
                >
                  {space.type === "کانال" ? (
                    <Hash className="size-[17px]" strokeWidth={1.75} />
                  ) : (
                    <Users2 className="size-[17px]" strokeWidth={1.75} />
                  )}
                </span>
                <div className="min-w-[140px] flex-1">
                  <p className="truncate text-[13px] font-medium">{space.name}</p>
                  <p className="mt-0.5 truncate text-[11.5px] text-chat-ink-soft">
                    {t(space.type)} • {space.members} {t("عضو")} • {space.activity}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => togglePin(space)}
                  aria-label={
                    space.pinned
                      ? t("برداشتن سنجاق {name}", { name: space.name })
                      : t("سنجاق {name}", { name: space.name })
                  }
                  aria-pressed={space.pinned}
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full transition-opacity",
                    space.pinned ? "text-chat-violet" : "opacity-0 group-hover:opacity-70",
                  )}
                >
                  <Pin className="size-4" strokeWidth={1.75} />
                </button>
                <GhostButton
                  onClick={() =>
                    void navigate({
                      to: "/manager/chat",
                      search: { t: space.targetType, i: space.targetId },
                    })
                  }
                >
                  {t("باز کردن گفتگو")}
                </GhostButton>
              </div>
            ))}
          </div>
        </Panel>

        <div className="custom-scrollbar grid min-h-0 content-start gap-4 overflow-y-auto lg:col-span-4">
          <Panel>
            <PanelHeader title="قواعد محتوایی واحد" subtitle="اعمال‌شده روی فضاهای بالا" />
            <ul className="space-y-2 px-4 pb-5">
              {rules.map((rule) => (
                <li
                  key={rule.label}
                  className="flex items-center justify-between rounded-[20px] bg-white/60 px-4 py-3 text-[12.5px]"
                >
                  <span className="text-chat-ink-soft">{rule.label}</span>
                  <Chip tone="mint">{rule.value}</Chip>
                </li>
              ))}
            </ul>
            <p className="flex items-start gap-2 px-6 pb-6 text-[11.5px] leading-relaxed text-chat-ink-soft">
              <Shield className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
              {t("تغییر این قواعد در سطح سازمان توسط ادمین کل انجام می‌شود.")}
            </p>
          </Panel>

          <Panel>
            <PanelHeader title="فضاهای فعال" subtitle="خلاصهٔ وضعیت" />
            <div className="grid gap-2 px-4 pb-5">
              <div className="flex items-center justify-between rounded-[20px] bg-white/60 px-4 py-3 text-[12.5px]">
                <span className="text-chat-ink-soft">{t("کانال‌ها")}</span>
                <Chip tone="sky">
                  {digits(spaces.filter((space) => space.targetType === "channel").length)}
                </Chip>
              </div>
              <div className="flex items-center justify-between rounded-[20px] bg-white/60 px-4 py-3 text-[12.5px]">
                <span className="text-chat-ink-soft">{t("گروه‌ها")}</span>
                <Chip tone="violet">
                  {digits(spaces.filter((space) => space.targetType === "group").length)}
                </Chip>
              </div>
              <div className="flex items-center justify-between rounded-[20px] bg-white/60 px-4 py-3 text-[12.5px]">
                <span className="text-chat-ink-soft">{t("سنجاق‌شده")}</span>
                <Chip tone="mint">{digits(spaces.filter((space) => space.pinned).length)}</Chip>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <GlassDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t("فضای جدید")}
        description={t("کانال برای اطلاع‌رسانی و گروه برای گفتگوی تیمی است.")}
      >
        <div className="grid gap-3">
          <div className="flex gap-1.5">
            {(["channel", "group"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setDraft((current) => ({ ...current, kind }))}
                className={cn(
                  "flex-1 rounded-2xl px-3 py-2 text-[12px] font-bold transition-colors",
                  draft.kind === kind
                    ? "bg-chat-ink text-chat-on-ink"
                    : "border border-chat-panel-border bg-white/60 text-chat-ink-soft hover:bg-white hover:text-chat-ink",
                )}
              >
                {kind === "channel" ? t("کانال") : t("گروه")}
              </button>
            ))}
          </div>
          <label className="grid gap-1.5">
            <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("نام فضا")}</span>
            <input
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
              className="rounded-2xl border border-chat-panel-border bg-white/70 px-3 py-2.5 text-[12.5px] text-chat-ink outline-none focus:bg-white"
              dir="auto"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("توضیح کوتاه")}</span>
            <textarea
              rows={2}
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
              className="resize-none rounded-2xl border border-chat-panel-border bg-white/70 px-3 py-2.5 text-[12.5px] leading-relaxed text-chat-ink outline-none focus:bg-white"
              dir="auto"
            />
          </label>
          <div className="grid gap-1.5">
            <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("دسترسی")}</span>
            <div className="flex gap-1.5">
              {(["private", "public"] as const).map((visibility) => (
                <button
                  key={visibility}
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, visibility }))}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[11.5px] font-bold transition-colors",
                    draft.visibility === visibility
                      ? "bg-chat-violet text-chat-on-accent"
                      : "border border-chat-panel-border bg-white/60 text-chat-ink-soft hover:bg-white hover:text-chat-ink",
                  )}
                >
                  {visibility === "private" ? t("خصوصی") : t("باز برای همه")}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="rounded-full bg-chat-ink px-4 py-2 text-[12px] font-bold text-chat-on-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t("ساخت فضا")}
            </button>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-full border border-chat-panel-border bg-white/60 px-4 py-2 text-[12px] font-bold text-chat-ink-soft transition-colors hover:bg-white hover:text-chat-ink"
            >
              {t("انصراف")}
            </button>
          </div>
        </div>
      </GlassDialog>
    </ManagerShell>
  );
}
