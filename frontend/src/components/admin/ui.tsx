import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cn(
        "rounded-3xl bg-chat-panel backdrop-blur-xl border border-chat-panel-border shadow-sm shadow-chat-ink/5",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelHead({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
      <div>
        <h2 className="font-display text-[15px] font-semibold text-chat-ink">{t(title)}</h2>
        {hint ? (
          <p className="text-[11.5px] text-chat-ink-soft mt-1 leading-relaxed">{t(hint)}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

const accentMap = {
  mint: "bg-chat-mint/20 text-chat-mint-deep border-chat-mint/25",
  sky: "bg-chat-sky/18 text-chat-sky-deep border-chat-sky/25",
  violet: "bg-chat-violet/18 text-chat-violet border-chat-sky/20",
  rose: "bg-chat-rose/15 text-chat-rose border-chat-rose/25",
  lemon: "bg-chat-lemon/25 text-chat-ink border-chat-lemon/30",
  ink: "bg-chat-ink/8 text-chat-ink-soft border-chat-panel-border",
} as const;

export type Accent = keyof typeof accentMap;

export function Pill({
  children,
  accent = "ink",
  className,
}: {
  children: ReactNode;
  accent?: Accent;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10.5px] font-bold whitespace-nowrap",
        accentMap[accent],
        className,
      )}
    >
      {typeof children === "string" ? t(children) : children}
    </span>
  );
}

const avatarMap = {
  mint: "from-chat-mint to-chat-sky-deep",
  sky: "from-chat-sky to-chat-sky-deep",
  violet: "from-chat-violet to-chat-rose",
  rose: "from-chat-rose to-chat-violet",
  lemon: "from-chat-lemon to-chat-mint",
} as const;

export function Avatar({
  initials,
  accent = "sky",
  size = 38,
}: {
  initials: string;
  accent?: keyof typeof avatarMap;
  size?: number;
}) {
  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        "shrink-0 rounded-full ring-2 ring-white bg-gradient-to-br grid place-items-center text-chat-on-accent font-display text-[12px] font-semibold",
        avatarMap[accent],
      )}
    >
      {initials}
    </span>
  );
}

export function Btn({
  children,
  variant = "ghost",
  className,
  onClick,
  type = "button",
  disabled = false,
  label,
}: {
  children: ReactNode;
  variant?: "solid" | "ghost" | "soft" | "danger";
  className?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  label?: string;
}) {
  const { t } = useI18n();
  const variants = {
    solid: "bg-chat-ink text-chat-on-ink hover:bg-chat-ink/90 shadow-sm shadow-chat-ink/20",
    soft: "bg-chat-mint/20 text-chat-mint-deep hover:bg-chat-mint/25 border border-chat-mint/25",
    ghost:
      "bg-white/60 text-chat-ink-soft hover:bg-white hover:text-chat-ink border border-chat-panel-border",
    danger: "bg-chat-rose/15 text-chat-rose hover:bg-chat-rose/25 border border-chat-rose/25",
  } as const;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={label ? t(label) : undefined}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-bold transition-colors disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        className,
      )}
    >
      {typeof children === "string" ? t(children) : children}
    </button>
  );
}

export function Field({
  label,
  placeholder,
  value,
  onChange,
  type = "text",
  dir,
}: {
  label: string;
  placeholder?: string;
  value?: string;
  onChange?: (v: string) => void;
  type?: string;
  dir?: "rtl" | "ltr";
}) {
  const { t } = useI18n();
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-bold text-chat-ink-soft">{t(label)}</span>
      <input
        type={type}
        dir={dir}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder ? t(placeholder) : undefined}
        className="w-full rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-[13px] text-chat-ink placeholder:text-chat-ink-soft outline-none transition-colors focus:border-chat-sky/30 focus:bg-white"
      />
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const { t } = useI18n();
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-bold text-chat-ink-soft">{t(label)}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-[13px] text-chat-ink outline-none focus:border-chat-sky/30 focus:bg-white"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.label)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Toggle({
  on,
  onChange,
  disabled = false,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
        on ? "bg-chat-mint" : "bg-chat-ink/10",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-all",
          on ? "end-[22px]" : "end-0.5",
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string }[];
}) {
  const { t } = useI18n();
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-white/50 border border-chat-panel-border p-1">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={cn(
            "rounded-full px-3 py-1.5 text-[11.5px] font-bold transition-colors",
            value === item.value
              ? "bg-white text-chat-ink shadow-sm"
              : "text-chat-ink-soft hover:text-chat-ink",
          )}
        >
          {t(item.label)}
        </button>
      ))}
    </div>
  );
}

export function Combo({
  label,
  value,
  onChange,
  options,
  searchable = false,
  emptyLabel = "موردی یافت نشد",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  searchable?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
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

  const selected = options.find((option) => option.value === value);
  const cleaned = term.trim().toLowerCase();
  const visible = cleaned
    ? options.filter((option) => option.label.toLowerCase().includes(cleaned))
    : options;

  return (
    <div className="block" ref={container}>
      <span className="mb-1.5 block text-[11.5px] font-bold text-chat-ink-soft">{t(label)}</span>
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setTerm("");
            setOpen((current) => !current);
          }}
          aria-expanded={open}
          className="flex w-full items-center gap-2 rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-start text-[13px] text-chat-ink transition-colors hover:bg-white disabled:opacity-50"
        >
          <span className="min-w-0 flex-1 truncate">
            {selected ? t(selected.label) : t("انتخاب کنید")}
          </span>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-chat-ink-soft transition-transform",
              open && "rotate-180",
            )}
          />
        </button>

        {open ? (
          <div className="absolute inset-x-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-[20px] border border-chat-panel-border bg-chat-surface shadow-[0_24px_60px_-28px_oklch(0.2_0.05_288/0.6)]">
            {searchable ? (
              <div className="flex items-center gap-2 border-b border-chat-panel-border px-3 py-2">
                <Search className="size-3.5 shrink-0 text-chat-ink-soft" />
                <input
                  autoFocus
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder={t("جستجو...")}
                  className="w-full bg-transparent text-[12.5px] text-chat-ink outline-none placeholder:text-chat-ink-soft"
                />
              </div>
            ) : null}
            <div className="custom-scrollbar max-h-56 overflow-y-auto p-1.5">
              {visible.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start text-[12.5px] transition-colors",
                    option.value === value
                      ? "bg-chat-violet/12 font-bold text-chat-ink"
                      : "text-chat-ink hover:bg-white/70",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{t(option.label)}</span>
                  {option.value === value ? (
                    <Check className="size-3.5 shrink-0 text-chat-violet" />
                  ) : null}
                </button>
              ))}
              {visible.length === 0 ? (
                <p className="px-3 py-6 text-center text-[12px] text-chat-ink-soft">
                  {t(emptyLabel)}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ClockField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [hours = "", minutes = ""] = value.split(":");

  const commit = (nextHours: string, nextMinutes: string) =>
    onChange(`${nextHours}:${nextMinutes}`);

  const clampField = (raw: string, max: number) => {
    const digitsOnly = raw.replace(/[^0-9۰-۹]/g, "").slice(0, 2);
    const latin = digitsOnly.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
    if (!latin) return "";
    return String(Math.min(Number(latin), max));
  };

  const pad = (raw: string) => (raw === "" ? "" : raw.padStart(2, "0"));

  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-bold text-chat-ink-soft">{t(label)}</span>
      <span
        dir="ltr"
        className="flex items-center justify-center gap-1 rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2 transition-colors focus-within:border-chat-sky/30 focus-within:bg-white"
      >
        <input
          value={hours}
          inputMode="numeric"
          aria-label={t("ساعت")}
          placeholder="16"
          onChange={(event) => commit(clampField(event.target.value, 23), minutes)}
          onBlur={() => commit(pad(hours), pad(minutes))}
          className="w-10 bg-transparent text-center font-mono text-[15px] text-chat-ink outline-none placeholder:text-chat-ink-soft/60"
        />
        <span className="text-[15px] font-bold text-chat-ink-soft">:</span>
        <input
          value={minutes}
          inputMode="numeric"
          aria-label={t("دقیقه")}
          placeholder="30"
          onChange={(event) => commit(hours, clampField(event.target.value, 59))}
          onBlur={() => commit(pad(hours), pad(minutes))}
          className="w-10 bg-transparent text-center font-mono text-[15px] text-chat-ink outline-none placeholder:text-chat-ink-soft/60"
        />
      </span>
    </label>
  );
}

export function CountedSegmented<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string; count?: number | undefined }[];
}) {
  const { t, digits } = useI18n();
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-chat-panel-border bg-white/50 p-1">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-bold transition-colors",
            value === item.value
              ? "bg-white text-chat-ink shadow-sm"
              : "text-chat-ink-soft hover:text-chat-ink",
          )}
        >
          {t(item.label)}
          {item.count === undefined ? null : (
            <span
              className={cn(
                "grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9.5px]",
                value === item.value
                  ? "bg-chat-violet/15 text-chat-violet"
                  : "bg-chat-ink/8 text-chat-ink-soft",
              )}
            >
              {digits(item.count)}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

const dialogSurface =
  "rounded-3xl border-chat-panel-border bg-chat-surface p-5 font-body text-chat-ink shadow-xl sm:rounded-3xl";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  variant = "danger",
  busy = false,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  variant?: "solid" | "soft" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { t, dir } = useI18n();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <AlertDialogContent dir={dir} className={cn(dialogSurface, "max-w-md")}>
        <AlertDialogHeader className="text-start sm:text-start">
          <AlertDialogTitle className="font-display text-[15px] font-semibold text-chat-ink">
            {t(title)}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[12px] leading-relaxed text-chat-ink-soft">
            {t(description)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter className="gap-2 sm:justify-start sm:space-x-0">
          <Btn variant={variant} onClick={onConfirm} disabled={busy}>
            {t(confirmLabel)}
          </Btn>
          <Btn onClick={onClose} disabled={busy}>
            {t("انصراف")}
          </Btn>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function PanelDialog({
  open,
  title,
  hint,
  wide = false,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  hint: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t, dir } = useI18n();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        dir={dir}
        className={cn(
          dialogSurface,
          wide ? "max-w-2xl" : "max-w-md",
          "[&>button]:start-4 [&>button]:end-auto",
        )}
      >
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle className="font-display text-[15px] font-semibold text-chat-ink">
            {t(title)}
          </DialogTitle>
          <DialogDescription className="text-[11.5px] leading-relaxed text-chat-ink-soft">
            {t(hint)}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
