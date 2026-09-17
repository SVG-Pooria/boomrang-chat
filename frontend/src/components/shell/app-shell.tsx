import { ChevronDown, LogOut, Moon, Settings2, Sun, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ProfileDialog } from "@/components/account/profile-dialog";
import { BrandMark } from "@/components/ui/brand-mark";
import { UserAvatar } from "@/components/ui/user-avatar";
import { fetchPreferences, useAccount } from "@/lib/account";
import { applyChatAppearance } from "@/lib/chat-appearance";
import { useI18n } from "@/lib/i18n";
import { ROLE_LABELS } from "@/lib/roles";
import { signOut } from "@/lib/session-actions";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export type RailItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onSelect: () => void;
  badge?: number;
  dot?: boolean;
};

function ProfileMenu() {
  const { t } = useI18n();
  const { user } = useAccount();
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      if (container.current && !container.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={t("منوی حساب")}
        className="flex items-center gap-1.5 rounded-full border border-chat-panel-border bg-chat-panel p-1 pe-2 backdrop-blur-xl transition-colors hover:bg-white/70"
      >
        <UserAvatar name={user.fullName} src={user.avatarUrl} seed={user.id} size={32} />
        <ChevronDown
          className={cn("size-3.5 text-chat-ink-soft transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div className="absolute end-0 top-[calc(100%+8px)] z-40 w-64 rounded-[22px] border border-chat-panel-border bg-chat-surface p-2 shadow-[0_24px_60px_-28px_oklch(0.2_0.05_288/0.6)]">
          <div className="flex items-center gap-2.5 rounded-2xl bg-white/55 p-2.5">
            <UserAvatar name={user.fullName} src={user.avatarUrl} seed={user.id} size={42} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-bold text-chat-ink">{user.fullName}</p>
              <p className="truncate text-[11px] text-chat-ink-soft">
                {t(ROLE_LABELS[user.role])}
                {user.tagName ? ` • ${user.tagName}` : ""}
              </p>
            </div>
          </div>
          <div className="mt-1.5 grid gap-0.5">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setDialogOpen(true);
              }}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] font-bold text-chat-ink transition-colors hover:bg-white/60"
            >
              <Settings2 className="size-4 text-chat-ink-soft" />
              {t("حساب کاربری و ظاهر")}
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] font-bold text-chat-ink transition-colors hover:bg-white/60"
            >
              {theme === "dark" ? (
                <Sun className="size-4 text-chat-ink-soft" />
              ) : (
                <Moon className="size-4 text-chat-ink-soft" />
              )}
              <span className="flex-1 text-start">
                {theme === "dark" ? t("حالت روشن") : t("حالت تیره")}
              </span>
            </button>
            <span className="mx-3 my-1 h-px bg-chat-ink/8" />
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] font-bold text-chat-rose transition-colors hover:bg-chat-rose/10"
            >
              <LogOut className="size-4" />
              {t("خروج از حساب")}
            </button>
          </div>
        </div>
      ) : null}

      <ProfileDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}

function Rail({ items }: { items: RailItem[] }) {
  const { t, digits } = useI18n();
  return (
    <nav className="panel custom-scrollbar flex shrink-0 gap-1.5 overflow-x-auto rounded-[26px] p-2 shadow-[0_18px_40px_-28px_oklch(0.4_0.075_288/0.45)] lg:w-[88px] lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={item.onSelect}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "relative grid w-[72px] shrink-0 place-items-center gap-1 rounded-[18px] px-1 py-2.5 transition-colors lg:w-full",
            item.active
              ? "bg-white text-chat-ink shadow-[0_10px_24px_-18px_oklch(0.4_0.075_288/0.8)]"
              : "text-chat-ink-soft hover:bg-white/60 hover:text-chat-ink",
          )}
        >
          <item.icon className="size-[18px]" strokeWidth={1.85} />
          <span className="max-w-full truncate text-[10.5px] font-bold">{t(item.label)}</span>
          {item.badge ? (
            <span className="absolute end-2 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-chat-rose px-1 text-[9.5px] font-bold text-chat-on-accent">
              {digits(item.badge > 99 ? "99+" : item.badge)}
            </span>
          ) : item.dot ? (
            <span className="absolute end-3 top-2.5 size-2 rounded-full bg-chat-rose ring-2 ring-chat-surface" />
          ) : null}
        </button>
      ))}
    </nav>
  );
}

export function AppShell({
  subtitle,
  rail,
  headerCenter,
  headerActions,
  children,
}: {
  subtitle: string | null;
  rail: RailItem[];
  headerCenter?: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  const { t, dir } = useI18n();

  useEffect(() => {
    fetchPreferences()
      .then(applyChatAppearance)
      .catch(() => undefined);
  }, []);

  return (
    <div dir={dir} className="app-canvas h-dvh w-full overflow-hidden font-body text-chat-ink">
      <div className="mx-auto flex h-full max-w-[1480px] flex-col gap-3 px-3 py-3 md:px-5 lg:gap-4 lg:py-4">
        <header className="flex h-11 shrink-0 items-center gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandMark size={40} className="rounded-[14px]" />
            <div className="min-w-0 leading-tight">
              <p className="font-display text-[16px] font-semibold">{t("بومرنگ")}</p>
              {subtitle === null ? (
                <span className="mt-1 block h-2.5 w-24 animate-pulse rounded-full bg-chat-ink/10" />
              ) : (
                <p className="truncate text-[11px] text-chat-ink-soft">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 justify-center px-2">{headerCenter}</div>
          <div className="flex shrink-0 items-center gap-2">
            {headerActions}
            <ProfileMenu />
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-4">
          <Rail items={rail} />
          <main className="min-h-0 min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </div>
  );
}
