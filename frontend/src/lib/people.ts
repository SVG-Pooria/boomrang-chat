import { useEffect, useState, type RefObject } from "react";

const PERSIAN_LETTERS = "آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی".split("");

export function letterOf(name: string) {
  const first = String(name || "")
    .trim()
    .charAt(0);
  if (!first) return "#";
  if (first === "ا" || first === "آ") return "ا";
  const normalized = first.replace("ك", "ک").replace("ي", "ی");
  if (PERSIAN_LETTERS.includes(normalized)) return normalized;
  const latin = normalized.toUpperCase();
  return /[A-Z]/.test(latin) ? latin : "#";
}

export type LetterGroup<T> = { letter: string; items: T[] };

export function groupByLetter<T>(items: T[], nameOf: (item: T) => string): LetterGroup<T>[] {
  const collator = new Intl.Collator(["fa", "en"]);
  const sorted = [...items].sort((a, b) => collator.compare(nameOf(a), nameOf(b)));
  const groups = new Map<string, T[]>();
  for (const item of sorted) {
    const letter = letterOf(nameOf(item));
    groups.set(letter, [...(groups.get(letter) ?? []), item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => collator.compare(a, b))
    .map(([letter, list]) => ({ letter, items: list }));
}

export function useActiveLetter(container: RefObject<HTMLElement | null>, signature: unknown) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;
    const onScroll = () => {
      const headers = Array.from(element.querySelectorAll<HTMLElement>("[data-letter]"));
      const top = element.getBoundingClientRect().top;
      let current = headers[0]?.dataset["letter"] ?? null;
      for (const header of headers) {
        if (header.getBoundingClientRect().top - top <= 12)
          current = header.dataset["letter"] ?? current;
      }
      setActive(current);
    };
    onScroll();
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [container, signature]);

  return active;
}

export function jumpToLetter(container: HTMLElement | null, letter: string) {
  const header = container?.querySelector<HTMLElement>(`[data-letter="${CSS.escape(letter)}"]`);
  if (!container || !header) return;
  container.scrollTo({ top: header.offsetTop - container.offsetTop, behavior: "smooth" });
}
