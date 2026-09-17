import { Check, Forward, Hash, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { GlassDialog } from "@/components/ui/glass-dialog";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useI18n } from "@/lib/i18n";
import type { ChatTarget } from "@/lib/chat";
import { cn } from "@/lib/utils";

const MAX_DESTINATIONS = 10;

export function ForwardDialog({
  open,
  targets,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  targets: ChatTarget[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (destinations: ChatTarget[]) => void;
}) {
  const { t, digits } = useI18n();
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const keyOf = (target: ChatTarget) => `${target.type}-${target.id}`;

  const visible = useMemo(() => {
    const cleaned = term.trim().toLowerCase();
    return targets.filter((target) => !cleaned || target.name.toLowerCase().includes(cleaned));
  }, [targets, term]);

  const toggle = (target: ChatTarget) => {
    const key = keyOf(target);
    setPicked((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : current.length >= MAX_DESTINATIONS
          ? current
          : [...current, key],
    );
  };

  return (
    <GlassDialog
      open={open}
      onClose={() => {
        setPicked([]);
        setTerm("");
        onClose();
      }}
      title={t("هدایت پیام")}
      description={t("گفتگوهایی را انتخاب کنید که این پیام برایشان فرستاده شود.")}
    >
      <div className="grid gap-3">
        <label className="flex items-center gap-2 rounded-full border border-chat-panel-border bg-white/70 px-3.5 py-2">
          <Search className="size-4 shrink-0 text-chat-ink-soft" />
          <input
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t("جستجوی گفتگو، گروه یا کانال...")}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-chat-ink outline-none placeholder:text-chat-ink-soft"
          />
        </label>

        <div className="custom-scrollbar grid max-h-[46dvh] content-start gap-1 overflow-y-auto">
          {visible.map((target) => {
            const key = keyOf(target);
            const selected = picked.includes(key);
            const Badge = target.type === "channel" ? Hash : target.type === "group" ? Users : null;
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggle(target)}
                className={cn(
                  "flex items-center gap-2.5 rounded-[18px] border px-3 py-2 text-start transition-colors",
                  selected
                    ? "border-chat-violet/40 bg-chat-violet/10"
                    : "border-transparent hover:bg-white/60",
                )}
              >
                <UserAvatar
                  name={target.name}
                  src={target.avatarUrl}
                  seed={
                    target.id + (target.type === "group" ? 3 : target.type === "channel" ? 7 : 0)
                  }
                  size={34}
                />
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  {Badge ? <Badge className="size-3 shrink-0 text-chat-ink-soft" /> : null}
                  <span className="truncate text-[12.5px] font-bold text-chat-ink">
                    {target.name}
                  </span>
                </span>
                <span
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-full border transition-colors",
                    selected
                      ? "border-chat-violet bg-chat-violet text-chat-on-accent"
                      : "border-chat-panel-border",
                  )}
                >
                  {selected ? <Check className="size-3" /> : null}
                </span>
              </button>
            );
          })}
          {visible.length === 0 ? (
            <p className="py-10 text-center text-[12px] text-chat-ink-soft">
              {t("گفتگویی با این نام پیدا نشد.")}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          disabled={picked.length === 0 || busy}
          onClick={() => {
            onSubmit(targets.filter((target) => picked.includes(keyOf(target))));
            setPicked([]);
            setTerm("");
          }}
          className="flex items-center justify-center gap-1.5 rounded-full bg-chat-ink px-4 py-2.5 text-[12.5px] font-bold text-chat-on-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Forward className="size-4 rtl:-scale-x-100" />
          {picked.length
            ? t("هدایت به {count} گفتگو", { count: digits(picked.length) })
            : t("هدایت پیام")}
        </button>
      </div>
    </GlassDialog>
  );
}
