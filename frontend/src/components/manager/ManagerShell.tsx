import type { ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Bell,
  CalendarDays,
  Hash,
  Inbox,
  LayoutGrid,
  ListChecks,
  Megaphone,
  MessageSquare,
  Users,
  UsersRound,
} from "lucide-react";

import { AppShell } from "@/components/shell/app-shell";
import { useI18n } from "@/lib/i18n";
import {
  fetchManagerProfile,
  knownManagerProfile,
  useManagerResource,
  WORKSPACE_EVENTS,
} from "@/lib/manager";

const NAV = [
  { to: "/manager", label: "نمای مدیریت", icon: LayoutGrid, badge: null },
  { to: "/manager/chat", label: "گفتگو", icon: MessageSquare, badge: null },
  { to: "/manager/users", label: "کاربران", icon: UsersRound, badge: null },
  { to: "/manager/inbox", label: "کارتابل", icon: Inbox, badge: "inbox" },
  { to: "/manager/tasks", label: "وظایف تیم", icon: ListChecks, badge: "tasks" },
  { to: "/manager/meetings", label: "جلسات", icon: CalendarDays, badge: null },
  { to: "/manager/team", label: "تیم من", icon: Users, badge: null },
  { to: "/manager/spaces", label: "کانال‌ها", icon: Hash, badge: null },
  { to: "/manager/announcements", label: "ابلاغیه‌ها", icon: Megaphone, badge: null },
  { to: "/manager/reports", label: "گزارش‌ها", icon: BarChart3, badge: null },
] as const;

export function ManagerShell({
  title,
  subtitle,
  actions,
  children,
  flush = false,
  fit = false,
  headerCenter,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  fit?: boolean;
  headerCenter?: ReactNode;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data } = useManagerResource(fetchManagerProfile, WORKSPACE_EVENTS);
  const profile = data ?? knownManagerProfile();

  const identity = profile
    ? profile.manager.jobTitle
      ? `${profile.manager.jobTitle} (${t(profile.manager.roleLabel)})`
      : (profile.manager.unit ?? t(profile.manager.roleLabel))
    : null;

  const current = pathname.replace(/\/+$/, "") || "/manager";
  const rail = NAV.map((item) => ({
    key: item.to,
    label: item.label,
    icon: item.icon,
    active: current === item.to,
    onSelect: () => void navigate({ to: item.to }),
    badge: item.badge && profile ? profile.badges[item.badge] : 0,
  }));

  return (
    <AppShell
      subtitle={identity}
      rail={rail}
      {...(headerCenter ? { headerCenter } : {})}
      headerActions={
        <button
          type="button"
          onClick={() => void navigate({ to: "/manager/inbox" })}
          aria-label={t("کارتابل")}
          className="relative grid size-10 place-items-center rounded-full border border-chat-panel-border bg-chat-panel text-chat-ink-soft backdrop-blur-xl transition-colors hover:bg-white/70"
        >
          <Bell className="size-[18px]" strokeWidth={1.75} />
          {(profile?.badges.inbox ?? 0) > 0 ? (
            <span className="absolute end-2 top-2 size-2.5 rounded-full bg-chat-rose ring-2 ring-chat-surface" />
          ) : null}
        </button>
      }
    >
      {flush ? (
        <div className="h-full min-h-0">{children}</div>
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-[20px] font-semibold tracking-tight">{t(title)}</h1>
              <p className="mt-0.5 text-[12.5px] text-chat-ink-soft">{t(subtitle)}</p>
            </div>
            {actions}
          </div>
          <div
            className={fit ? "min-h-0 flex-1" : "custom-scrollbar min-h-0 flex-1 overflow-y-auto"}
          >
            {children}
          </div>
        </div>
      )}
    </AppShell>
  );
}
