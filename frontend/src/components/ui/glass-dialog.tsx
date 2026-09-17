import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

export function GlassDialog({
  open,
  onClose,
  title,
  description,
  size = "md",
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: keyof typeof SIZES;
  className?: string;
  children: ReactNode;
}) {
  const { dir } = useI18n();
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
          "custom-scrollbar max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto rounded-[26px] border-chat-panel-border bg-chat-surface p-5 font-body text-chat-ink shadow-[0_30px_80px_-30px_oklch(0.2_0.05_288/0.6)] sm:rounded-[26px]",
          SIZES[size],
          className,
        )}
      >
        <DialogHeader className="pe-9">
          <DialogTitle className="font-display text-[15px] font-semibold text-chat-ink">
            {title}
          </DialogTitle>
          <DialogDescription
            className={cn(
              "text-[11.5px] leading-relaxed text-chat-ink-soft",
              description ? "" : "sr-only",
            )}
          >
            {description ?? title}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
