import { createFileRoute } from "@tanstack/react-router";
import { RequireRole } from "@/components/require-role";
import { useMemo, useState } from "react";
import {
  Activity,
  BellRing,
  Database,
  Eye,
  FileArchive,
  FileSignature,
  Megaphone,
  Settings,
  ShieldCheck,
  Tag,
  Users,
} from "lucide-react";
import { RequestTypesSection } from "@/components/admin/request-types";
import {
  ActivitySection,
  ArchivesSection,
  BackupSection,
  EntitiesSection,
  OverviewSection,
  OversightSection,
  RemindersSection,
  SettingsSection,
  TagsSection,
  UsersSection,
} from "@/components/admin/sections";
import { AppShell } from "@/components/shell/app-shell";
import {
  AdminNavigationContext,
  BADGE_EVENTS,
  fetchBadges,
  useAdminResource,
  type AdminSection,
} from "@/lib/admin";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "پنل ادمین کل — بومرنگ" },
      {
        name: "description",
        content:
          "کنسول ادمین کل بومرنگ: مدیریت کاربران و نقش‌ها، کانال‌ها و گروه‌ها، تگ‌ها، نظارت، لاگ فعالیت و بکاپ.",
      },
    ],
  }),
  component: AdminRoute,
});

function AdminRoute() {
  return (
    <RequireRole roles={["super_admin"]}>
      <AdminConsole />
    </RequireRole>
  );
}

const RAIL = [
  { id: "overview", label: "نمای کلی", icon: ShieldCheck, badge: "overview" },
  { id: "users", label: "کاربران", icon: Users, badge: "users" },
  { id: "entities", label: "کانال‌ها", icon: Megaphone },
  { id: "requests", label: "کارتابل", icon: FileSignature },
  { id: "tags", label: "تگ‌ها", icon: Tag },
  { id: "settings", label: "تنظیمات", icon: Settings },
  { id: "oversight", label: "نظارت", icon: Eye, badge: "oversight" },
  { id: "activity", label: "لاگ", icon: Activity },
  { id: "backup", label: "بکاپ", icon: Database },
  { id: "archives", label: "آرشیو", icon: FileArchive },
  { id: "reminders", label: "بات", icon: BellRing },
] as const;

type SectionId = (typeof RAIL)[number]["id"];

const SECTIONS: Record<SectionId, () => React.JSX.Element> = {
  overview: OverviewSection,
  users: UsersSection,
  entities: EntitiesSection,
  requests: RequestTypesSection,
  tags: TagsSection,
  settings: SettingsSection,
  oversight: OversightSection,
  activity: ActivitySection,
  backup: BackupSection,
  archives: ArchivesSection,
  reminders: RemindersSection,
};

function AdminConsole() {
  const { t } = useI18n();
  const [active, setActive] = useState<SectionId>("overview");
  const [intent, setIntent] = useState<"create" | null>(null);
  const { data: badges } = useAdminResource(fetchBadges, BADGE_EVENTS);
  const Current = SECTIONS[active];

  const navigation = useMemo(
    () => ({
      open: (section: AdminSection, next?: "create") => {
        setActive(section);
        setIntent(next ?? null);
      },
      intent,
      consumeIntent: () => setIntent(null),
    }),
    [intent],
  );

  const rail = RAIL.map((item) => ({
    key: item.id,
    label: item.label,
    icon: item.icon,
    active: active === item.id,
    onSelect: () => navigation.open(item.id),
    badge: "badge" in item ? (badges?.[item.badge] ?? 0) : 0,
  }));

  return (
    <AdminNavigationContext.Provider value={navigation}>
      <AppShell subtitle={t("پنل ادمین کل")} rail={rail}>
        <div className="h-full min-h-0">
          <Current />
        </div>
      </AppShell>
    </AdminNavigationContext.Provider>
  );
}
