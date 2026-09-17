import { useState } from "react";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function BrandMark({ size = 40, className }: { size?: number; className?: string }) {
  const { t, language } = useI18n();
  const [missing, setMissing] = useState(false);

  if (missing) {
    return (
      <span
        style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
        className={cn(
          "relative grid shrink-0 place-items-center overflow-hidden rounded-[28%] bg-gradient-to-br from-chat-mint to-chat-sky-deep font-display font-bold text-chat-on-accent shadow-[0_10px_22px_-12px_oklch(0.57_0.18_255/0.7)]",
          className,
        )}
        aria-hidden="true"
      >
        {language === "fa" ? "ب" : "B"}
      </span>
    );
  }

  return (
    <img
      src="/logo.png"
      width={size}
      height={size}
      alt={t("بومرنگ")}
      onError={() => setMissing(true)}
      className={cn(
        "shrink-0 rounded-[28%] object-cover shadow-[0_10px_22px_-12px_oklch(0.57_0.18_255/0.7)]",
        className,
      )}
    />
  );
}
