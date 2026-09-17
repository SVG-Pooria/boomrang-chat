import type { ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = "danger",
  busy = false,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { t, dir } = useI18n();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <AlertDialogContent
        dir={dir}
        className="w-[calc(100vw-2rem)] max-w-md rounded-[26px] border-chat-panel-border bg-chat-surface p-5 font-body text-chat-ink shadow-[0_30px_80px_-30px_oklch(0.2_0.05_288/0.6)] sm:rounded-[26px]"
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-[15px] font-semibold text-chat-ink">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[12px] leading-relaxed text-chat-ink-soft">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter className="gap-2 sm:justify-start sm:space-x-0">
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={cn(
              "rounded-full px-4 py-2 text-[12px] font-bold transition-opacity hover:opacity-90 disabled:opacity-50",
              tone === "danger"
                ? "bg-chat-rose text-chat-on-accent"
                : "bg-chat-ink text-chat-on-ink",
            )}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-full border border-chat-panel-border bg-white/60 px-4 py-2 text-[12px] font-bold text-chat-ink-soft transition-colors hover:bg-white hover:text-chat-ink"
          >
            {t("انصراف")}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
