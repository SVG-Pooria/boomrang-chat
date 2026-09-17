import { CheckCircle2, ClipboardCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { GlassDialog } from "@/components/ui/glass-dialog";
import { reportReferral, respondReferral, type ReferralStatus } from "@/lib/approvals";
import type { MessageReferral } from "@/lib/chat";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<ReferralStatus, string> = {
  pending: "در انتظار پذیرش",
  accepted: "در حال بررسی",
  declined: "رد شده",
  done: "انجام شد",
  failed: "انجام نشد — نیاز به بررسی دارد",
};

export function ReferralCard({
  referral,
  own,
  viewerId,
}: {
  referral: MessageReferral;
  own: boolean;
  viewerId: number | null;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<ReferralStatus>(referral.status);
  const [busy, setBusy] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  const [reason, setReason] = useState("");
  const isAssignee = viewerId !== null && referral.assigneeId === viewerId;

  const run = (
    action: () => Promise<{ referral: { status: ReferralStatus } }>,
    failure: string,
  ) => {
    setBusy(true);
    action()
      .then((result) => setStatus(result.referral.status))
      .catch(() => toast.error(t(failure)))
      .finally(() => setBusy(false));
  };

  const actionButton = (
    label: string,
    tone: "mint" | "ink" | "ghost",
    icon: typeof CheckCircle2,
    onClick: () => void,
  ) => {
    const Icon = icon;
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onClick}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-bold transition-opacity hover:opacity-90 disabled:opacity-50",
          tone === "mint" && "bg-chat-mint text-chat-on-accent",
          tone === "ink" && "bg-chat-ink text-chat-on-ink",
          tone === "ghost" && "border border-chat-panel-border bg-white/70 text-chat-ink",
        )}
      >
        <Icon className="size-3.5" />
        {label}
      </button>
    );
  };

  return (
    <div
      className={cn(
        "w-[min(320px,68vw)] rounded-2xl p-3",
        own ? "bg-chat-on-accent/12" : "bg-chat-violet/8",
      )}
    >
      <p
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-bold",
          own ? "text-chat-on-accent" : "text-chat-violet",
        )}
      >
        <ClipboardCheck className="size-3.5" />
        {t("ارجاع بررسی درخواست")}
      </p>
      <p className="mt-1.5 text-[13px] font-bold leading-snug" dir="auto">
        {referral.requestTitle}
      </p>
      {referral.requestType ? (
        <p className={cn("mt-0.5 text-[11px]", own ? "opacity-80" : "text-chat-ink-soft")}>
          {t("نوع درخواست: {type}", { type: referral.requestType })}
        </p>
      ) : null}
      {referral.note ? (
        <p className="mt-2 text-[12px] leading-relaxed" dir="auto">
          {referral.note}
        </p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {isAssignee && status === "pending"
          ? [
              actionButton(t("پذیرش بررسی"), "mint", CheckCircle2, () =>
                run(() => respondReferral(referral.referralId, true), "ثبت پاسخ ناموفق بود"),
              ),
              actionButton(t("رد"), "ghost", XCircle, () =>
                run(() => respondReferral(referral.referralId, false), "ثبت پاسخ ناموفق بود"),
              ),
            ].map((node, index) => <span key={index}>{node}</span>)
          : null}

        {isAssignee && status === "accepted"
          ? [
              actionButton(t("انجام شد"), "mint", CheckCircle2, () =>
                run(() => reportReferral(referral.referralId, true), "ثبت نتیجه ناموفق بود"),
              ),
              actionButton(t("انجام نشد (نیاز به بررسی دارد)"), "ghost", XCircle, () =>
                setFailOpen(true),
              ),
            ].map((node, index) => <span key={index}>{node}</span>)
          : null}

        {!isAssignee || (status !== "pending" && status !== "accepted") ? (
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-bold",
              own ? "bg-chat-on-accent/20" : "bg-chat-ink/6 text-chat-ink-soft",
            )}
          >
            {t(STATUS_LABEL[status])}
          </span>
        ) : null}
      </div>

      {referral.resultNote ? (
        <p
          className={cn("mt-2 text-[11.5px]", own ? "opacity-85" : "text-chat-ink-soft")}
          dir="auto"
        >
          {referral.resultNote}
        </p>
      ) : null}

      <GlassDialog
        open={failOpen}
        onClose={() => setFailOpen(false)}
        title={t("انجام نشد")}
        description={t("دلیل را بنویسید تا مدیریت پیگیری کند.")}
      >
        <div className="grid gap-3">
          <textarea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="resize-none rounded-2xl border border-chat-panel-border bg-white/70 px-3 py-2.5 text-[12.5px] leading-relaxed text-chat-ink outline-none focus:bg-white"
            dir="auto"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !reason.trim()}
              onClick={() => {
                setFailOpen(false);
                run(
                  () => reportReferral(referral.referralId, false, reason.trim()),
                  "ثبت نتیجه ناموفق بود",
                );
                setReason("");
              }}
              className="rounded-full bg-chat-ink px-4 py-2 text-[12px] font-bold text-chat-on-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t("ثبت نتیجه")}
            </button>
            <button
              type="button"
              onClick={() => setFailOpen(false)}
              className="rounded-full border border-chat-panel-border bg-white/60 px-4 py-2 text-[12px] font-bold text-chat-ink-soft transition-colors hover:bg-white hover:text-chat-ink"
            >
              {t("انصراف")}
            </button>
          </div>
        </div>
      </GlassDialog>
    </div>
  );
}
