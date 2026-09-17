import type { HTMLAttributes, ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type Tone = "mint" | "sky" | "violet" | "rose" | "lemon";

export const toneSoftBg: Record<Tone, string> = {
  mint: "bg-chat-mint/15",
  sky: "bg-chat-sky/15",
  violet: "bg-chat-violet/15",
  rose: "bg-chat-rose/15",
  lemon: "bg-chat-lemon/20",
};

export const toneText: Record<Tone, string> = {
  mint: "text-chat-mint-deep",
  sky: "text-chat-sky-deep",
  violet: "text-chat-violet",
  rose: "text-chat-rose",
  lemon: "text-chat-lemon",
};

export const toneDot: Record<Tone, string> = {
  mint: "bg-chat-mint",
  sky: "bg-chat-sky",
  violet: "bg-chat-violet",
  rose: "bg-chat-rose",
  lemon: "bg-chat-lemon",
};

export const toneGradient: Record<Tone, string> = {
  mint: "bg-gradient-to-br from-chat-mint to-chat-mint-deep",
  sky: "bg-gradient-to-br from-chat-sky to-chat-sky-deep",
  violet: "bg-gradient-to-br from-chat-violet to-chat-sky-deep",
  rose: "bg-gradient-to-br from-chat-rose to-chat-violet",
  lemon: "bg-gradient-to-br from-chat-lemon to-chat-mint",
};

export function Panel({
  className,
  children,
  ...rest
}: {
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <section
      {...rest}
      className={cn(
        "panel rounded-[26px] shadow-[0_18px_40px_-28px_oklch(0.4_0.075_288/0.45)]",
        className,
      )}
    >
      {children}
    </section>
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
    <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
      <div className="min-w-0">
        <h2 className="font-display text-[15px] font-semibold text-chat-ink">{t(title)}</h2>
        {subtitle ? (
          <p className="mt-1 text-[12.5px] leading-relaxed text-chat-ink-soft">{t(subtitle)}</p>
        ) : null}
      </div>
      {action}
    </header>
  );
}

export function Chip({
  children,
  tone = "sky",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium",
        toneSoftBg[tone],
        toneText[tone],
        className,
      )}
    >
      {typeof children === "string" ? t(children) : children}
    </span>
  );
}

export function Avatar({
  initials,
  tone = "sky",
  size = "md",
}: {
  initials: string;
  tone?: Tone;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-display font-semibold text-chat-on-accent",
        toneGradient[tone],
        size === "sm" ? "size-8 text-[11px]" : "size-10 text-[12.5px]",
      )}
    >
      {initials}
    </span>
  );
}

export function Meter({ value, tone = "mint" }: { value: number; tone?: Tone }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-chat-ink/8">
      <div className={cn("h-full rounded-full", toneDot[tone])} style={{ width: `${value}%` }} />
    </div>
  );
}

export function GhostButton({
  children,
  className,
  onClick,
  disabled,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-chat-panel-border bg-white/70 px-3.5 py-1.5 text-[12px] font-medium text-chat-ink-soft transition-colors hover:bg-white",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function SolidButton({
  children,
  className,
  onClick,
  disabled,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-chat-mint to-chat-sky-deep px-4 py-2 text-[12.5px] font-semibold text-chat-on-accent shadow-lg shadow-chat-mint/30 transition-opacity hover:opacity-95",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function fa(value: number | string) {
  return String(value).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!);
}
