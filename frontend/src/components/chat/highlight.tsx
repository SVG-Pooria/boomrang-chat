import { Fragment } from "react";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function Highlight({ text, term }: { text: string; term: string }) {
  const cleaned = term.trim();
  if (!cleaned) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExp(cleaned)})`, "gi"));
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === cleaned.toLowerCase() ? (
          <mark key={index} className="rounded-sm bg-chat-lemon/45 px-0.5 text-chat-ink">
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export function snippetAround(text: string, term: string, radius = 42) {
  const cleaned = term.trim().toLowerCase();
  const index = cleaned ? text.toLowerCase().indexOf(cleaned) : -1;
  if (index < 0 || text.length <= radius * 2) return text;
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + cleaned.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
