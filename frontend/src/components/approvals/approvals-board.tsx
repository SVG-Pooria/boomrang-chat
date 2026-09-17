import {
  CheckCircle2,
  CornerUpLeft,
  FileSignature,
  Loader2,
  Plus,
  Printer,
  Search,
  Send,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { DatePicker } from "@/components/ui/date-picker";
import { GlassDialog } from "@/components/ui/glass-dialog";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  APPROVAL_PRIORITIES,
  APPROVAL_STATUS_LABELS,
  createApproval,
  decideApproval,
  fetchApprovals,
  fetchRequestReferrals,
  referApproval,
  type ApprovalItem,
  type ApprovalPriority,
  type ApprovalStatus,
  type Referral,
  type RequestType,
} from "@/lib/approvals";
import { readSession } from "@/lib/auth";
import { getSocket } from "@/lib/chat";
import { useI18n } from "@/lib/i18n";
import { printDocument } from "@/lib/print";
import type { TaskCapabilities } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { fetchDirectory, type Person } from "@/lib/workspace";

type TabId = "inbox" | "mine" | "referred" | "all";

const PRIORITY_TONE: Record<ApprovalPriority, string> = {
  فوری: "bg-chat-rose/15 text-chat-rose",
  بالا: "bg-chat-lemon/20 text-chat-lemon",
  عادی: "bg-chat-ink/8 text-chat-ink-soft",
};

const STATUS_TONE: Record<ApprovalStatus, string> = {
  pending: "bg-chat-sky/16 text-chat-sky-deep",
  approved: "bg-chat-mint/18 text-chat-mint-deep",
  rejected: "bg-chat-rose/12 text-chat-rose",
  referred: "bg-chat-lemon/20 text-chat-lemon",
};

function ApprovalCard({ item, onOpen }: { item: ApprovalItem; onOpen: () => void }) {
  const { t, digits } = useI18n();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-[22px] border border-chat-panel-border bg-white/65 p-3.5 text-start transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_18px_40px_-28px_oklch(0.3_0.06_288/0.8)]"
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 text-[13px] font-bold leading-snug text-chat-ink">{item.title}</p>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
            STATUS_TONE[item.status],
          )}
        >
          {t(APPROVAL_STATUS_LABELS[item.status])}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-chat-ink-soft">
        <span className="rounded-full bg-chat-violet/10 px-2 py-0.5 font-bold text-chat-violet">
          {item.type}
        </span>
        <span className={cn("rounded-full px-2 py-0.5 font-bold", PRIORITY_TONE[item.priority])}>
          {t(item.priority)}
        </span>
        <span>{item.date}</span>
        {item.amount ? <span className="font-bold text-chat-ink">{item.amount}</span> : null}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <UserAvatar name={item.requester} seed={item.requesterId ?? 0} size={24} />
        <span className="truncate text-[11px] text-chat-ink-soft">{item.requester}</span>
        <span className="ms-auto shrink-0 text-[10.5px] font-bold text-chat-ink-soft">
          {item.status === "pending"
            ? t("{step} از {total} — {name}", {
                step: digits(item.step),
                total: digits(item.totalSteps),
                name: t(item.stepName),
              })
            : item.deadline}
        </span>
      </div>
    </button>
  );
}

export function ApprovalsBoard() {
  const { t, digits, day } = useI18n();
  const session = readSession();
  const viewerId = session?.user.id ?? null;

  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [types, setTypes] = useState<RequestType[]>([]);
  const [capabilities, setCapabilities] = useState<TaskCapabilities | null>(null);
  const [pendingForMe, setPendingForMe] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>("inbox");
  const [openId, setOpenId] = useState<number | null>(null);
  const [detailReferrals, setDetailReferrals] = useState<Referral[]>([]);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [referOpen, setReferOpen] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [peopleQuery, setPeopleQuery] = useState("");
  const [referNote, setReferNote] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [draft, setDraft] = useState<{
    title: string;
    type: string;
    description: string;
    priority: ApprovalPriority;
    amount: string;
    periodStart: Date | null;
    periodEnd: Date | null;
  }>({
    title: "",
    type: "",
    description: "",
    priority: "عادی",
    amount: "",
    periodStart: null,
    periodEnd: null,
  });

  const load = useCallback(async () => {
    try {
      const result = await fetchApprovals();
      setApprovals(result.approvals);
      setReferrals(result.referrals);
      setTypes(result.types);
      setCapabilities(result.capabilities);
      setPendingForMe(result.pendingForMe);
    } catch {
      toast.error(t("بارگذاری کارتابل ناموفق بود"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onChanged = (payload: { section?: string }) => {
      if (!payload?.section || payload.section === "approvals") void load();
    };
    socket.on("workspace:changed", onChanged);
    return () => {
      socket.off("workspace:changed", onChanged);
    };
  }, [load]);

  useEffect(() => {
    if (!referOpen || people.length) return;
    fetchDirectory()
      .then(setPeople)
      .catch(() => toast.error(t("بارگذاری فهرست همکاران ناموفق بود")));
  }, [referOpen, people.length, t]);

  const item = useMemo(
    () => approvals.find((row) => row.requestId === openId) ?? null,
    [approvals, openId],
  );

  useEffect(() => {
    if (openId === null) {
      setDetailReferrals([]);
      return;
    }
    fetchRequestReferrals(openId)
      .then((result) => setDetailReferrals(result.referrals))
      .catch(() => undefined);
  }, [openId, approvals]);

  const myReferrals = referrals.filter((row) => row.assigneeId === viewerId);
  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "inbox", label: "در انتظار من", count: pendingForMe },
    {
      id: "mine",
      label: "درخواست‌های من",
      count: approvals.filter((row) => row.requesterId === viewerId).length,
    },
    { id: "referred", label: "ارجاع به من", count: myReferrals.length },
    { id: "all", label: "همه", count: approvals.length },
  ];

  const visible = approvals.filter((row) => {
    if (tab === "inbox") return row.canDecide;
    if (tab === "mine") return row.requesterId === viewerId;
    return tab === "all";
  });

  const selectedType = types.find((type) => type.name === draft.type) ?? null;

  const run = (action: () => Promise<unknown>, failure: string, close = false) => {
    setBusy(true);
    action()
      .then(() => {
        if (close) setOpenId(null);
        return load();
      })
      .catch(() => toast.error(t(failure)))
      .finally(() => setBusy(false));
  };

  const submitCreate = () => {
    if (!draft.title.trim() || !draft.type) {
      toast.error(t("عنوان و نوع درخواست الزامی است"));
      return;
    }
    setBusy(true);
    createApproval({
      title: draft.title.trim(),
      type: draft.type,
      description: draft.description.trim(),
      priority: draft.priority,
      amountRials: selectedType?.needsAmount && draft.amount ? Number(draft.amount) : null,
      periodStart: draft.periodStart ? draft.periodStart.toISOString() : null,
      periodEnd: draft.periodEnd ? draft.periodEnd.toISOString() : null,
    })
      .then(() => {
        toast.success(t("درخواست ثبت شد"));
        setCreateOpen(false);
        setDraft({
          title: "",
          type: "",
          description: "",
          priority: "عادی",
          amount: "",
          periodStart: null,
          periodEnd: null,
        });
        return load();
      })
      .catch(() => toast.error(t("ثبت درخواست ناموفق بود")))
      .finally(() => setBusy(false));
  };

  const printRequest = (request: ApprovalItem) => {
    printDocument({
      title: request.title,
      subtitle: t("برگهٔ درخواست {id}", { id: request.id }),
      meta: [
        t("نوع درخواست: {type}", { type: request.type }),
        t("ثبت‌شده توسط {name}", { name: request.requester }),
        request.date,
      ],
      blocks: [
        {
          kind: "table",
          heading: t("مشخصات درخواست"),
          columns: [t("عنوان"), t("مقدار")],
          rows: [
            [t("وضعیت"), t(APPROVAL_STATUS_LABELS[request.status])],
            [t("اولویت"), t(request.priority)],
            [
              t("مرحلهٔ جاری"),
              t("{step} از {total} — {name}", {
                step: digits(request.step),
                total: digits(request.totalSteps),
                name: t(request.stepName),
              }),
            ],
            ...(request.amount ? [[t("مبلغ"), request.amount]] : []),
            [t("مهلت"), request.deadline],
          ],
        },
        ...(request.description
          ? [{ kind: "text" as const, heading: t("توضیحات"), body: request.description }]
          : []),
        ...(detailReferrals.length
          ? [
              {
                kind: "table" as const,
                heading: t("ارجاع‌ها"),
                columns: [t("بررسی‌کننده"), t("وضعیت"), t("توضیح")],
                rows: detailReferrals.map((referral) => [
                  referral.assignee,
                  t(referral.statusLabel),
                  referral.resultNote ?? referral.note ?? "—",
                ]),
              },
            ]
          : []),
      ],
    });
  };

  const filteredPeople = people.filter(
    (person) =>
      person.userId !== viewerId &&
      (peopleQuery.trim() === "" || person.name.includes(peopleQuery.trim())),
  );

  return (
    <section className="panel flex h-full min-h-0 flex-col overflow-hidden rounded-[26px]">
      <header className="flex shrink-0 items-center gap-3 border-b border-chat-panel-border px-4 py-3">
        <span className="grid size-9 place-items-center rounded-2xl bg-chat-lemon/18 text-chat-lemon">
          <FileSignature className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[14.5px] font-semibold">{t("کارتابل")}</p>
          <p className="truncate text-[11px] text-chat-ink-soft">
            {t("ثبت، بررسی و تأیید درخواست‌های سازمانی")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 rounded-full bg-chat-ink px-3.5 py-2 text-[11.5px] font-bold text-chat-on-ink transition-opacity hover:opacity-90"
        >
          <Plus className="size-3.5" />
          {t("درخواست جدید")}
        </button>
      </header>

      <div className="flex shrink-0 gap-1.5 overflow-x-auto px-4 py-3">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={cn(
              "relative shrink-0 rounded-full px-3.5 py-1.5 text-[11.5px] font-bold transition-colors",
              tab === entry.id
                ? "bg-chat-ink text-chat-on-ink"
                : "border border-chat-panel-border bg-white/60 text-chat-ink-soft hover:bg-white hover:text-chat-ink",
            )}
          >
            {t(entry.label)}
            <span
              className={cn("ms-1.5", tab === entry.id ? "opacity-80" : "text-chat-ink-soft/80")}
            >
              {digits(entry.count)}
            </span>
            {entry.id === "inbox" && pendingForMe > 0 ? (
              <span className="absolute -top-0.5 end-0 size-2 rounded-full bg-chat-rose ring-2 ring-chat-surface" />
            ) : null}
          </button>
        ))}
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="grid h-full place-items-center">
            <Loader2 className="size-5 animate-spin text-chat-ink-soft" />
          </div>
        ) : tab === "referred" ? (
          <div className="grid gap-2.5">
            {myReferrals.length === 0 ? (
              <p className="py-16 text-center text-[12px] text-chat-ink-soft">
                {t("بررسی‌ای به شما ارجاع نشده است.")}
              </p>
            ) : null}
            {myReferrals.map((referral) => (
              <div
                key={referral.referralId}
                className="rounded-[22px] border border-chat-panel-border bg-white/65 p-3.5"
              >
                <div className="flex items-start gap-2">
                  <p className="flex-1 text-[13px] font-bold text-chat-ink">
                    {referral.requestTitle}
                  </p>
                  <span className="shrink-0 rounded-full bg-chat-ink/6 px-2 py-0.5 text-[10px] font-bold text-chat-ink-soft">
                    {t(referral.statusLabel)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-chat-ink-soft">
                  {t("ارجاع از {name}", { name: referral.referredBy })} — {referral.requestType}
                </p>
                {referral.note ? (
                  <p className="mt-2 text-[12px] leading-relaxed text-chat-ink" dir="auto">
                    {referral.note}
                  </p>
                ) : null}
                <p className="mt-2 text-[10.5px] text-chat-ink-soft">
                  {t("پاسخ در گفتگوی مربوط به همین ارجاع ثبت می‌شود.")}
                </p>
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="py-16 text-center text-[12px] text-chat-ink-soft">
            {t("موردی در این بخش نیست.")}
          </p>
        ) : (
          <div className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
            {visible.map((row) => (
              <ApprovalCard
                key={row.requestId}
                item={row}
                onOpen={() => setOpenId(row.requestId)}
              />
            ))}
          </div>
        )}
      </div>

      <GlassDialog
        open={item !== null}
        onClose={() => setOpenId(null)}
        title={item?.title ?? ""}
        description={item ? t("ثبت‌شده توسط {name}", { name: item.requester }) : ""}
        size="lg"
      >
        {item ? (
          <div className="custom-scrollbar grid max-h-[62dvh] gap-3.5 overflow-y-auto pe-1">
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-chat-ink-soft">
              <span className={cn("rounded-full px-2.5 py-1 font-bold", STATUS_TONE[item.status])}>
                {t(APPROVAL_STATUS_LABELS[item.status])}
              </span>
              <span className="rounded-full bg-chat-violet/10 px-2.5 py-1 font-bold text-chat-violet">
                {item.type}
              </span>
              <span
                className={cn("rounded-full px-2.5 py-1 font-bold", PRIORITY_TONE[item.priority])}
              >
                {t(item.priority)}
              </span>
              <span>{item.date}</span>
              {item.amount ? <span className="font-bold text-chat-ink">{item.amount}</span> : null}
            </div>

            {item.description ? (
              <p className="rounded-2xl border border-chat-panel-border bg-white/55 p-3 text-[12.5px] leading-relaxed text-chat-ink">
                {item.description}
              </p>
            ) : null}

            <p className="text-[11.5px] text-chat-ink-soft">
              {t("مرحلهٔ جاری: {name}", { name: t(item.stepName) })} —{" "}
              {t("{step} از {total}", { step: digits(item.step), total: digits(item.totalSteps) })}
            </p>

            {detailReferrals.length ? (
              <div className="grid gap-1.5">
                <p className="text-[11.5px] font-bold text-chat-ink-soft">{t("ارجاع‌ها")}</p>
                {detailReferrals.map((referral) => (
                  <div
                    key={referral.referralId}
                    className="flex items-center gap-2 rounded-2xl border border-chat-panel-border bg-white/55 px-3 py-2"
                  >
                    <UserAvatar name={referral.assignee} seed={referral.assigneeId} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-bold text-chat-ink">
                        {referral.assignee}
                      </span>
                      <span className="block truncate text-[10.5px] text-chat-ink-soft">
                        {day(referral.createdAt, { day: "numeric", month: "long" })}
                        {referral.resultNote ? ` — ${referral.resultNote}` : ""}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                        referral.status === "done"
                          ? "bg-chat-mint/18 text-chat-mint-deep"
                          : referral.status === "failed" || referral.status === "declined"
                            ? "bg-chat-rose/12 text-chat-rose"
                            : "bg-chat-lemon/20 text-chat-lemon",
                      )}
                    >
                      {t(referral.statusLabel)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => printRequest(item)}
                className="flex items-center gap-1.5 rounded-full border border-chat-panel-border bg-white/70 px-3.5 py-1.5 text-[11.5px] font-bold text-chat-ink transition-colors hover:bg-white"
              >
                <Printer className="size-3.5" />
                {t("خروجی PDF")}
              </button>
            </div>

            {item.canDecide ? (
              <>
                <textarea
                  rows={2}
                  value={decisionNote}
                  onChange={(event) => setDecisionNote(event.target.value)}
                  placeholder={t("توضیح تصمیم (اختیاری)")}
                  className="resize-none rounded-2xl border border-chat-panel-border bg-white/70 px-3 py-2.5 text-[12.5px] leading-relaxed text-chat-ink outline-none placeholder:text-chat-ink-soft focus:bg-white"
                  dir="auto"
                />
                <div className="flex flex-wrap items-center gap-2 border-t border-chat-panel-border pt-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const note = decisionNote.trim();
                      setDecisionNote("");
                      run(
                        () => decideApproval(item.requestId, "تأیید", note),
                        "ثبت تصمیم ناموفق بود",
                        true,
                      );
                    }}
                    className="flex items-center gap-1.5 rounded-full bg-chat-mint px-4 py-2 text-[12px] font-bold text-chat-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    <CheckCircle2 className="size-4" />
                    {t("تأیید")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const note = decisionNote.trim();
                      setDecisionNote("");
                      run(
                        () => decideApproval(item.requestId, "رد", note),
                        "ثبت تصمیم ناموفق بود",
                        true,
                      );
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-chat-panel-border bg-white/70 px-4 py-2 text-[12px] font-bold text-chat-rose transition-colors hover:bg-white disabled:opacity-50"
                  >
                    <XCircle className="size-4" />
                    {t("رد")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const note = decisionNote.trim();
                      setDecisionNote("");
                      run(
                        () => decideApproval(item.requestId, "ارجاع", note),
                        "ثبت تصمیم ناموفق بود",
                        true,
                      );
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-chat-panel-border bg-white/70 px-4 py-2 text-[12px] font-bold text-chat-ink transition-colors hover:bg-white disabled:opacity-50"
                  >
                    <CornerUpLeft className="size-4" />
                    {t("برگشت به درخواست‌دهنده")}
                  </button>
                  {capabilities?.executive ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setReferOpen(true)}
                      className="ms-auto flex items-center gap-1.5 rounded-full bg-chat-violet px-4 py-2 text-[12px] font-bold text-chat-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      <Send className="size-4 rtl:-scale-x-100" />
                      {t("ارجاع برای بررسی")}
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </GlassDialog>

      <GlassDialog
        open={referOpen}
        onClose={() => setReferOpen(false)}
        title={t("ارجاع برای بررسی")}
        description={t("همکار موردنظر در گفتگو پیام بررسی را دریافت می‌کند.")}
      >
        <div className="grid gap-3">
          <div className="flex items-center gap-2 rounded-2xl border border-chat-panel-border bg-white/70 px-3 py-2">
            <Search className="size-3.5 text-chat-ink-soft" />
            <input
              value={peopleQuery}
              onChange={(event) => setPeopleQuery(event.target.value)}
              placeholder={t("جستجوی همکار...")}
              className="w-full bg-transparent text-[12px] text-chat-ink outline-none placeholder:text-chat-ink-soft"
            />
          </div>
          <textarea
            rows={2}
            value={referNote}
            onChange={(event) => setReferNote(event.target.value)}
            placeholder={t("توضیح برای بررسی‌کننده")}
            className="resize-none rounded-2xl border border-chat-panel-border bg-white/70 px-3 py-2.5 text-[12.5px] leading-relaxed text-chat-ink outline-none placeholder:text-chat-ink-soft focus:bg-white"
            dir="auto"
          />
          <div className="custom-scrollbar grid max-h-56 gap-1 overflow-y-auto">
            {filteredPeople.map((person) => (
              <button
                key={person.userId}
                type="button"
                disabled={busy || !item}
                onClick={() => {
                  if (!item) return;
                  const note = referNote.trim();
                  setReferOpen(false);
                  setReferNote("");
                  setBusy(true);
                  referApproval(item.requestId, person.userId, note)
                    .then(() => {
                      toast.success(t("ارجاع ثبت شد و پیام بررسی در گفتگو فرستاده شد"));
                      return load();
                    })
                    .catch(() => toast.error(t("ثبت ارجاع ناموفق بود")))
                    .finally(() => setBusy(false));
                }}
                className="flex items-center gap-2 rounded-2xl border border-chat-panel-border bg-white/55 px-3 py-2 text-start transition-colors hover:bg-white disabled:opacity-50"
              >
                <UserAvatar
                  name={person.name}
                  src={person.avatarUrl}
                  seed={person.userId}
                  size={26}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-bold text-chat-ink">
                    {person.name}
                  </span>
                  <span className="block truncate text-[10.5px] text-chat-ink-soft">
                    {person.role} — {person.unit}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </GlassDialog>

      <GlassDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t("درخواست جدید")}
        description={t("نوع درخواست را انتخاب و اطلاعات لازم را وارد کنید.")}
      >
        <div className="custom-scrollbar grid max-h-[62dvh] gap-3 overflow-y-auto pe-1">
          <div className="grid gap-1.5">
            <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("نوع درخواست")}</span>
            <div className="flex flex-wrap gap-1.5">
              {types.map((type) => (
                <button
                  key={type.typeId}
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, type: type.name }))}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[11.5px] font-bold transition-colors",
                    draft.type === type.name
                      ? "bg-chat-violet text-chat-on-accent"
                      : "border border-chat-panel-border bg-white/60 text-chat-ink-soft hover:bg-white hover:text-chat-ink",
                  )}
                >
                  {type.name}
                </button>
              ))}
            </div>
            {selectedType?.description ? (
              <p className="text-[10.5px] text-chat-ink-soft">{selectedType.description}</p>
            ) : null}
          </div>

          <label className="grid gap-1.5">
            <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("عنوان")}</span>
            <input
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
              className="rounded-2xl border border-chat-panel-border bg-white/70 px-3 py-2.5 text-[12.5px] text-chat-ink outline-none focus:bg-white"
              dir="auto"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("توضیحات")}</span>
            <textarea
              rows={3}
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
              className="resize-none rounded-2xl border border-chat-panel-border bg-white/70 px-3 py-2.5 text-[12.5px] leading-relaxed text-chat-ink outline-none focus:bg-white"
              dir="auto"
            />
          </label>

          {selectedType?.needsAmount ? (
            <label className="grid gap-1.5">
              <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("مبلغ (ریال)")}</span>
              <input
                inputMode="numeric"
                value={draft.amount}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    amount: event.target.value.replace(/[^\d]/g, ""),
                  }))
                }
                className="rounded-2xl border border-chat-panel-border bg-white/70 px-3 py-2.5 text-[12.5px] text-chat-ink outline-none focus:bg-white"
                dir="ltr"
              />
            </label>
          ) : null}

          {selectedType?.needsPeriod ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("از تاریخ")}</span>
                <DatePicker
                  value={draft.periodStart}
                  onChange={(value) => setDraft((current) => ({ ...current, periodStart: value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("تا تاریخ")}</span>
                <DatePicker
                  value={draft.periodEnd}
                  onChange={(value) => setDraft((current) => ({ ...current, periodEnd: value }))}
                />
              </div>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("اولویت")}</span>
            <div className="flex flex-wrap gap-1.5">
              {APPROVAL_PRIORITIES.map((priority) => (
                <button
                  key={priority}
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, priority }))}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[11.5px] font-bold transition-colors",
                    draft.priority === priority
                      ? "bg-chat-ink text-chat-on-ink"
                      : "border border-chat-panel-border bg-white/60 text-chat-ink-soft hover:bg-white hover:text-chat-ink",
                  )}
                >
                  {t(priority)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={submitCreate}
              className="rounded-full bg-chat-ink px-4 py-2 text-[12px] font-bold text-chat-on-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t("ثبت درخواست")}
            </button>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-full border border-chat-panel-border bg-white/60 px-4 py-2 text-[12px] font-bold text-chat-ink-soft transition-colors hover:bg-white hover:text-chat-ink"
            >
              {t("انصراف")}
            </button>
          </div>
        </div>
      </GlassDialog>
    </section>
  );
}
