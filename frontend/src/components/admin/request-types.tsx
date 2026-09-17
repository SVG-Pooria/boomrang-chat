import { FileSignature, Plus, Power, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Btn, Field, Panel, PanelHead, Pill, Toggle } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  createRequestType,
  deleteRequestType,
  fetchRequestTypes,
  updateRequestType,
  type RequestType,
} from "@/lib/approvals";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const EMPTY_FORM = { name: "", description: "", needsAmount: false, needsPeriod: false };

export function RequestTypesSection() {
  const { t, digits } = useI18n();
  const [types, setTypes] = useState<RequestType[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<RequestType | null>(null);

  const load = useCallback(() => {
    fetchRequestTypes(true)
      .then((result) => setTypes(result.types))
      .catch(() => toast.error(t("بارگذاری انواع درخواست ناموفق بود")));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = () => {
    if (!form.name.trim()) {
      toast.error(t("نام نوع درخواست را بنویسید"));
      return;
    }
    setBusy(true);
    createRequestType({
      name: form.name.trim(),
      description: form.description.trim(),
      needsAmount: form.needsAmount,
      needsPeriod: form.needsPeriod,
    })
      .then(() => {
        toast.success(t("نوع درخواست ساخته شد"));
        setForm(EMPTY_FORM);
        load();
      })
      .catch(() => toast.error(t("ساخت نوع درخواست ناموفق بود")))
      .finally(() => setBusy(false));
  };

  const patch = (type: RequestType, changes: Parameters<typeof updateRequestType>[1]) => {
    setBusy(true);
    updateRequestType(type.typeId, changes)
      .then(() => load())
      .catch(() => toast.error(t("به‌روزرسانی نوع درخواست ناموفق بود")))
      .finally(() => setBusy(false));
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
      <Panel>
        <PanelHead
          title="انواع درخواست کارتابل"
          hint="کارکنان فقط می‌توانند از این فهرست درخواست ثبت کنند؛ نوع غیرفعال دیگر در فرم نمایش داده نمی‌شود."
        />
        <div className="grid gap-2.5 px-5 pb-5">
          {types.map((type) => (
            <div
              key={type.typeId}
              className={cn(
                "flex items-center justify-between gap-3 rounded-2xl border px-4 py-3",
                type.isActive
                  ? "border-chat-panel-border bg-white/60"
                  : "border-chat-panel-border bg-chat-ink/4 opacity-70",
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-9 place-items-center rounded-2xl bg-chat-lemon/18 text-chat-lemon">
                  <FileSignature className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-bold text-chat-ink">{type.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-chat-ink-soft">
                    {type.description || t("بدون توضیح")} ·{" "}
                    {t("{count} درخواست ثبت‌شده", { count: digits(type.usageCount ?? 0) })}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {type.needsAmount ? <Pill accent="sky">{t("مبلغ")}</Pill> : null}
                {type.needsPeriod ? <Pill accent="violet">{t("بازهٔ زمانی")}</Pill> : null}
                <Toggle
                  on={type.isActive}
                  disabled={busy}
                  onChange={(value) => patch(type, { isActive: value })}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRemoving(type)}
                  aria-label={t("حذف {name}", { name: type.name })}
                  className="grid size-8 place-items-center rounded-full text-chat-ink-soft transition-colors hover:bg-chat-rose/15 hover:text-chat-rose"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
          {types.length === 0 ? (
            <p className="py-10 text-center text-[12px] text-chat-ink-soft">
              {t("هنوز نوع درخواستی تعریف نشده است.")}
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel className="p-5">
        <h3 className="font-display text-[15px] font-semibold text-chat-ink">
          {t("نوع درخواست جدید")}
        </h3>
        <div className="mt-4 grid gap-3">
          <Field
            label="نام"
            placeholder="مثلاً تنخواه"
            value={form.name}
            onChange={(value) => setForm((current) => ({ ...current, name: value }))}
          />
          <Field
            label="توضیح کوتاه"
            placeholder="در فرم ثبت درخواست نمایش داده می‌شود"
            value={form.description}
            onChange={(value) => setForm((current) => ({ ...current, description: value }))}
          />
          <div className="grid gap-2">
            <div className="flex items-center justify-between rounded-2xl border border-chat-panel-border bg-white/60 px-4 py-2.5">
              <span className="text-[12px] font-bold text-chat-ink">{t("نیاز به مبلغ")}</span>
              <Toggle
                on={form.needsAmount}
                onChange={(value) => setForm((current) => ({ ...current, needsAmount: value }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-chat-panel-border bg-white/60 px-4 py-2.5">
              <span className="text-[12px] font-bold text-chat-ink">
                {t("نیاز به بازهٔ زمانی")}
              </span>
              <Toggle
                on={form.needsPeriod}
                onChange={(value) => setForm((current) => ({ ...current, needsPeriod: value }))}
              />
            </div>
          </div>
          <Btn variant="solid" onClick={submit} disabled={busy}>
            <Plus className="size-4" />
            {t("ساخت نوع درخواست")}
          </Btn>
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-chat-ink-soft">
            <Power className="mt-0.5 size-3.5 shrink-0" />
            {t(
              "نوعی که درخواست ثبت‌شده دارد حذف نمی‌شود؛ به‌جای حذف، غیرفعال می‌شود تا سابقه حفظ بماند.",
            )}
          </p>
        </div>
      </Panel>

      <ConfirmDialog
        open={removing !== null}
        title={t("حذف نوع درخواست")}
        description={t(
          "اگر برای این نوع درخواستی ثبت شده باشد، به‌جای حذف غیرفعال می‌شود و سابقهٔ درخواست‌ها باقی می‌ماند.",
        )}
        confirmLabel={t("حذف")}
        busy={busy}
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (!target) return;
          setBusy(true);
          deleteRequestType(target.typeId)
            .then(() => load())
            .catch(() => toast.error(t("حذف نوع درخواست ناموفق بود")))
            .finally(() => setBusy(false));
        }}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
