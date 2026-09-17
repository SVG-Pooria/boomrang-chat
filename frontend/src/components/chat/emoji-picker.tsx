import {
  Apple,
  Car,
  Clock3,
  Flag,
  Hash,
  Lightbulb,
  PawPrint,
  Search,
  Smile,
  Trophy,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Emoji = {
  unicode: string;
  label: string;
  tags?: string[];
  group?: number;
  order?: number;
};

type GroupId = "recent" | 0 | 1 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

const GROUPS: { id: GroupId; label: string; icon: LucideIcon }[] = [
  { id: "recent", label: "پرکاربرد", icon: Clock3 },
  { id: 0, label: "شکلک‌ها و احساسات", icon: Smile },
  { id: 1, label: "آدم‌ها و بدن", icon: UserRound },
  { id: 3, label: "حیوانات و طبیعت", icon: PawPrint },
  { id: 4, label: "خوراکی و نوشیدنی", icon: Apple },
  { id: 5, label: "سفر و مکان‌ها", icon: Car },
  { id: 6, label: "فعالیت‌ها", icon: Trophy },
  { id: 7, label: "اشیا", icon: Lightbulb },
  { id: 8, label: "نمادها", icon: Hash },
  { id: 9, label: "پرچم‌ها", icon: Flag },
];

const PERSIAN_KEYWORDS: Record<string, string[]> = {
  خنده: ["joy", "laugh", "grin", "smile"],
  لبخند: ["smile", "grin"],
  قلب: ["heart"],
  عشق: ["heart", "love", "kiss"],
  تشکر: ["pray", "folded hands"],
  ممنون: ["pray", "folded hands"],
  لایک: ["thumbs up"],
  موافق: ["thumbs up", "ok hand", "check"],
  مخالف: ["thumbs down", "cross"],
  آتش: ["fire"],
  گریه: ["cry", "sob", "tear"],
  ناراحت: ["sad", "frown", "disappointed"],
  تعجب: ["astonished", "surprised", "open mouth"],
  عصبانی: ["angry", "rage", "pout"],
  بوس: ["kiss"],
  خورشید: ["sun"],
  ماه: ["moon"],
  گل: ["flower", "rose", "blossom"],
  ستاره: ["star"],
  تبریک: ["party", "tada", "confetti"],
  جشن: ["party", "tada", "confetti", "balloon"],
  کیک: ["cake"],
  قهوه: ["coffee", "hot beverage"],
  چای: ["tea", "hot beverage"],
  اوکی: ["ok hand"],
  دست: ["hand", "wave", "clap"],
  دست_زدن: ["clap"],
  صد: ["hundred"],
  پول: ["money", "dollar"],
  کار: ["briefcase", "office"],
  ساعت: ["clock", "watch"],
  تقویم: ["calendar"],
  فکر: ["thinking"],
  خواب: ["sleep", "zzz"],
  باران: ["rain", "umbrella"],
  برف: ["snow"],
  درست: ["check"],
  غلط: ["cross"],
  هشدار: ["warning"],
  سوال: ["question"],
  کتاب: ["book"],
  تلفن: ["phone", "telephone"],
  ایمیل: ["email", "envelope"],
  ماشین: ["car", "automobile"],
  هواپیما: ["airplane"],
  خانه: ["house", "home"],
  چشم: ["eye"],
  شیطون: ["wink", "smirk"],
  خجالت: ["blush", "flushed"],
  ترس: ["fear", "scream"],
  مریض: ["sick", "mask", "thermometer"],
  قدرت: ["muscle", "flexed"],
  هدف: ["target", "bullseye"],
  راکت: ["rocket"],
  نمودار: ["chart"],
  قفل: ["lock"],
  کلید: ["key"],
  ایران: ["iran"],
};

const RECENT_KEY = "boomrang.emoji.recent";
const RECENT_LIMIT = 32;

let emojiCache: Promise<Emoji[]> | null = null;

function loadEmojis() {
  if (!emojiCache) {
    emojiCache = import("emojibase-data/en/compact.json").then((module) =>
      (module.default as Emoji[])
        .filter((emoji) => emoji.group !== undefined && emoji.group !== 2)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    );
  }
  return emojiCache;
}

function readRecent(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function rememberEmoji(unicode: string) {
  const next = [unicode, ...readRecent().filter((item) => item !== unicode)].slice(0, RECENT_LIMIT);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    return;
  }
}

function matches(emoji: Emoji, term: string) {
  const haystack = [emoji.label, ...(emoji.tags ?? [])].join(" ").toLowerCase();
  if (/[؀-ۿ]/.test(term)) {
    const keywords = Object.entries(PERSIAN_KEYWORDS)
      .filter(([word]) => word.replace("_", " ").includes(term) || term.includes(word))
      .flatMap(([, english]) => english);
    return keywords.some((keyword) => haystack.includes(keyword));
  }
  return haystack.includes(term.toLowerCase());
}

export function EmojiPicker({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
}) {
  const { t } = useI18n();
  const [emojis, setEmojis] = useState<Emoji[]>([]);
  const [group, setGroup] = useState<GroupId>(0);
  const [term, setTerm] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const container = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    void loadEmojis().then(setEmojis);
    const stored = readRecent();
    setRecent(stored);
    setGroup(stored.length ? "recent" : 0);
    const onPointer = (event: MouseEvent) => {
      if (container.current && !container.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    grid.current?.scrollTo({ top: 0 });
  }, [group, term]);

  const visible = useMemo(() => {
    const cleaned = term.trim();
    if (cleaned) return emojis.filter((emoji) => matches(emoji, cleaned)).slice(0, 240);
    if (group === "recent") {
      return recent.map((unicode) => ({ unicode, label: unicode }));
    }
    return emojis.filter((emoji) => emoji.group === group);
  }, [emojis, group, recent, term]);

  if (!open) return null;

  const activeLabel = term.trim()
    ? t("نتیجهٔ جستجو")
    : t(GROUPS.find((item) => item.id === group)?.label ?? "");

  return (
    <div
      ref={container}
      className="absolute bottom-[calc(100%+10px)] start-0 z-30 flex h-[380px] w-[344px] flex-col overflow-hidden rounded-[22px] border border-chat-panel-border bg-chat-surface shadow-[0_24px_60px_-28px_oklch(0.2_0.05_288/0.6)]"
    >
      <div className="p-2.5 pb-2">
        <label className="flex items-center gap-2 rounded-2xl border border-chat-panel-border bg-white/60 px-3 py-2">
          <Search className="size-3.5 text-chat-ink-soft" />
          <input
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t("جستجوی شکلک...")}
            className="w-full bg-transparent text-[12px] text-chat-ink outline-none placeholder:text-chat-ink-soft"
          />
        </label>
      </div>
      <p className="px-3.5 pb-1 text-[10.5px] font-bold text-chat-ink-soft">{activeLabel}</p>
      <div ref={grid} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-2">
        {visible.length === 0 ? (
          <p className="py-10 text-center text-[11.5px] text-chat-ink-soft">
            {emojis.length === 0
              ? t("در حال بارگذاری...")
              : group === "recent" && !term.trim()
                ? t("هنوز شکلکی استفاده نکرده‌اید.")
                : t("شکلکی پیدا نشد.")}
          </p>
        ) : (
          <div className="grid grid-cols-8 gap-0.5 pb-2">
            {visible.map((emoji) => (
              <button
                key={emoji.unicode}
                type="button"
                title={emoji.label}
                onClick={() => {
                  rememberEmoji(emoji.unicode);
                  onSelect(emoji.unicode);
                }}
                className="grid aspect-square place-items-center rounded-xl text-[22px] leading-none transition-transform hover:scale-110 hover:bg-white/70"
              >
                {emoji.unicode}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-0.5 border-t border-chat-panel-border bg-white/40 px-1.5 py-1.5">
        {GROUPS.map((item) => (
          <button
            key={String(item.id)}
            type="button"
            title={t(item.label)}
            aria-label={t(item.label)}
            onClick={() => {
              setTerm("");
              setGroup(item.id);
            }}
            className={cn(
              "grid size-8 place-items-center rounded-xl transition-colors",
              group === item.id && !term.trim()
                ? "bg-white text-chat-violet shadow-sm"
                : "text-chat-ink-soft hover:bg-white/60 hover:text-chat-ink",
            )}
          >
            <item.icon className="size-4" />
          </button>
        ))}
      </div>
    </div>
  );
}
