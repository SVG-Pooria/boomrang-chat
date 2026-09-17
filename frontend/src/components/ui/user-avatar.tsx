import { useAuthorizedImage } from "@/lib/images";
import { cn } from "@/lib/utils";

const TONES = [
  "from-chat-mint to-chat-sky-deep",
  "from-chat-rose to-chat-violet",
  "from-chat-sky to-chat-sky-deep",
  "from-chat-violet to-chat-rose",
  "from-chat-lemon to-chat-mint",
];

export function initialsFrom(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "؟";
  if (parts.length === 1) return parts[0]!.slice(0, 2);
  return `${parts[0]![0]}${parts[1]![0]}`;
}

export function UserAvatar({
  name,
  src,
  seed,
  size = 36,
  online,
  className,
}: {
  name: string;
  src?: string | null | undefined;
  seed?: number | undefined;
  size?: number;
  online?: boolean | undefined;
  className?: string;
}) {
  const image = useAuthorizedImage(src);
  const tone = TONES[Math.abs(Number(seed ?? name.length)) % TONES.length];
  const fontSize = Math.max(10, Math.round(size * 0.34));

  return (
    <span
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      {image ? (
        <img
          src={image}
          alt={name}
          draggable={false}
          className="size-full rounded-full object-cover ring-2 ring-white"
        />
      ) : (
        <span
          className={cn(
            "grid size-full place-items-center rounded-full bg-gradient-to-br font-display font-semibold text-chat-on-accent ring-2 ring-white",
            tone,
          )}
          style={{ fontSize }}
        >
          {initialsFrom(name)}
        </span>
      )}
      {online !== undefined ? (
        <span
          className={cn(
            "absolute bottom-0 end-0 size-[28%] min-h-2 min-w-2 rounded-full ring-2 ring-chat-surface",
            online ? "bg-chat-mint" : "bg-chat-ink-soft/50",
          )}
        />
      ) : null}
    </span>
  );
}
