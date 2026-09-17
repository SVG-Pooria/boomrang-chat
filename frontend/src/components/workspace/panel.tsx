import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function GlassPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-3xl bg-chat-panel backdrop-blur-xl border border-chat-panel-border shadow-sm shadow-chat-sky/10",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 px-5 py-4 border-b border-white/60 bg-white/25 shrink-0">
      <div className="min-w-0">
        <p className="text-[15px] font-semibold leading-none font-display">{t(title)}</p>
        {subtitle ? <p className="text-[11px] text-chat-ink-soft mt-1.5">{t(subtitle)}</p> : null}
      </div>
      {action ? <div className="ms-auto flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Chip({
  children,
  tone = "ink",
  className,
}: {
  children: ReactNode;
  tone?: "ink" | "mint" | "sky" | "rose" | "lemon" | "violet";
  className?: string;
}) {
  const tones: Record<string, string> = {
    ink: "bg-chat-ink/8 text-chat-ink-soft",
    mint: "bg-chat-mint/18 text-chat-mint-deep",
    sky: "bg-chat-sky/18 text-chat-sky-deep",
    rose: "bg-chat-rose/20 text-chat-rose",
    lemon: "bg-chat-lemon/25 text-chat-lemon",
    violet: "bg-chat-violet/18 text-chat-violet",
  };
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold",
        tones[tone],
        className,
      )}
    >
      {typeof children === "string" ? t(children) : children}
    </span>
  );
}

export function Avatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <div
      className={cn(
        "size-8 rounded-full grid place-items-center text-[10px] font-bold bg-gradient-to-br from-chat-mint to-chat-sky-deep text-chat-on-accent shrink-0",
        className,
      )}
    >
      {initials}
    </div>
  );
}
