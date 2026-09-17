import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LetterHeader({ letter }: { letter: string }) {
  return (
    <p
      data-letter={letter}
      className="sticky top-0 z-10 flex items-center gap-2 bg-chat-surface/85 px-2 pb-2 pt-3 text-[11.5px] font-bold text-chat-ink-soft backdrop-blur"
    >
      {letter}
      <span className="h-px flex-1 bg-chat-ink/8" />
    </p>
  );
}

export function AlphaIndex({
  letters,
  active,
  onJump,
}: {
  letters: string[];
  active: string | null;
  onJump: (letter: string) => void;
}) {
  const { t } = useI18n();
  if (letters.length < 2) return null;
  return (
    <nav
      aria-label={t("پرش به حرف")}
      className="flex w-8 shrink-0 flex-col items-center justify-center gap-0.5 border-s border-chat-panel-border py-2"
    >
      {letters.map((letter) => (
        <button
          key={letter}
          type="button"
          onClick={() => onJump(letter)}
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full text-[10.5px] font-bold transition-colors",
            active === letter
              ? "bg-chat-violet text-chat-on-accent"
              : "text-chat-ink-soft hover:bg-white/70 hover:text-chat-ink",
          )}
        >
          {letter}
        </button>
      ))}
    </nav>
  );
}
