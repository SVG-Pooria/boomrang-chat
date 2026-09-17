import { Plus, SendHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";

import { GlassDialog } from "@/components/ui/glass-dialog";
import { useI18n } from "@/lib/i18n";

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

export function PollDialog({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (question: string, options: string[]) => void;
}) {
  const { t, digits } = useI18n();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);

  useEffect(() => {
    if (!open) return;
    setQuestion("");
    setOptions(["", ""]);
  }, [open]);

  const filled = options.map((option) => option.trim()).filter(Boolean);
  const ready = question.trim().length > 0 && filled.length >= MIN_OPTIONS;

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      title={t("نظرسنجی جدید")}
      description={t("پرسش و دست‌کم دو گزینه بنویسید؛ همه اعضای گفتگو می‌توانند رأی بدهند.")}
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onSubmit(question.trim(), filled);
        }}
      >
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-bold text-chat-ink-soft">{t("پرسش")}</span>
          <input
            autoFocus
            value={question}
            maxLength={255}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={t("مثلاً: جلسهٔ هفتگی چه روزی باشد؟")}
            className="w-full rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-[13px] text-chat-ink outline-none placeholder:text-chat-ink-soft focus:border-chat-violet/40 focus:bg-white"
          />
        </label>

        <div>
          <span className="mb-1.5 block text-[11px] font-bold text-chat-ink-soft">
            {t("گزینه‌ها")}
          </span>
          <div className="grid gap-2">
            {options.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-chat-violet/15 text-[11px] font-bold text-chat-violet">
                  {digits(index + 1)}
                </span>
                <input
                  value={option}
                  maxLength={160}
                  onChange={(event) =>
                    setOptions((current) =>
                      current.map((item, position) =>
                        position === index ? event.target.value : item,
                      ),
                    )
                  }
                  placeholder={t("گزینهٔ {number}", { number: digits(index + 1) })}
                  className="min-w-0 flex-1 rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2 text-[12.5px] text-chat-ink outline-none placeholder:text-chat-ink-soft focus:border-chat-violet/40 focus:bg-white"
                />
                {options.length > MIN_OPTIONS ? (
                  <button
                    type="button"
                    aria-label={t("حذف گزینه")}
                    onClick={() =>
                      setOptions((current) => current.filter((_, position) => position !== index))
                    }
                    className="grid size-8 shrink-0 place-items-center rounded-full text-chat-ink-soft transition-colors hover:bg-chat-rose/10 hover:text-chat-rose"
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {options.length < MAX_OPTIONS ? (
            <button
              type="button"
              onClick={() => setOptions((current) => [...current, ""])}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-bold text-chat-violet transition-colors hover:bg-chat-violet/10"
            >
              <Plus className="size-3.5" />
              {t("افزودن گزینه")}
            </button>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={!ready || busy}
          className="mt-1 flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-chat-mint to-chat-sky-deep px-4 py-2.5 text-[12.5px] font-bold text-chat-on-accent shadow-md shadow-chat-mint/25 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <SendHorizontal className="size-4 rtl:-scale-x-100" />
          {t("ارسال نظرسنجی")}
        </button>
      </form>
    </GlassDialog>
  );
}
