import type { ChatPreferences } from "@/lib/account";

export const FONT_SIZES: Record<ChatPreferences["fontSize"], { label: string; value: string }> = {
  small: { label: "کوچک", value: "12.5px" },
  medium: { label: "متوسط", value: "13.5px" },
  large: { label: "بزرگ", value: "15px" },
};

export const BUBBLE_COLORS: { id: string; label: string; value: string | null }[] = [
  { id: "sky", label: "آبی بومرنگ", value: null },
  { id: "violet", label: "بنفش", value: "#8a6ff0" },
  { id: "mint", label: "نعنایی", value: "#35a98f" },
  { id: "rose", label: "گلبهی", value: "#d9688c" },
  { id: "amber", label: "کهربایی", value: "#c98c2e" },
  { id: "slate", label: "سربی", value: "#5a6b93" },
];

export function applyChatAppearance(
  preferences: Pick<ChatPreferences, "fontSize" | "bubbleColor">,
) {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  root.setProperty("--chat-message-size", FONT_SIZES[preferences.fontSize]?.value ?? "13.5px");
  if (preferences.bubbleColor) root.setProperty("--chat-bubble-own", preferences.bubbleColor);
  else root.removeProperty("--chat-bubble-own");
}
