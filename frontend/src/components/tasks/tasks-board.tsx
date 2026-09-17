import {
  CheckCircle2,
  Clock,
  Download,
  ListChecks,
  MessageSquare,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { DatePicker } from "@/components/ui/date-picker";
import { GlassDialog } from "@/components/ui/glass-dialog";
import { UserAvatar } from "@/components/ui/user-avatar";
import { readSession } from "@/lib/auth";
import { getSocket } from "@/lib/chat";
import { fetchBlobUrl, fileUrl, formatBytes, saveFile } from "@/lib/files";
import { useI18n } from "@/lib/i18n";
import {
  acceptTask,
  addTaskReport,
  createTask,
  fetchTaskReports,
  fetchTasks,
  openTaskChat,
  reviewTask,
  setTaskProgress,
  submitTask,
  uploadTaskReportFile,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskCapabilities,
  type TaskCounts,
  type TaskItem,
  type TaskPriority,
  type TaskReport,
  type TaskStatus,
} from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { fetchDirectory, type Person } from "@/lib/workspace";

const PRIORITY_TONE: Record<TaskPriority, string> = {
  فوری: "bg-chat-rose/15 text-chat-rose",
  بالا: "bg-chat-lemon/20 text-chat-lemon",
  عادی: "bg-chat-ink/8 text-chat-ink-soft",
};

const STATUS_TONE: Record<TaskStatus, string> = {
  "در انتظار": "bg-chat-sky/16 text-chat-sky-deep",
  "در حال انجام": "bg-chat-violet/15 text-chat-violet",
  بررسی: "bg-chat-lemon/20 text-chat-lemon",
  "انجام شد": "bg-chat-mint/18 text-chat-mint-deep",
};

function FileChip({
  file,
}: {
  file: { id: number; originalName: string | null; sizeBytes: number | null };
}) {
  const { t, digits } = useI18n();
  return (
    <button
      type="button"
      onClick={() =>
        fetchBlobUrl(fileUrl(file.id, "original"))
          .then((url) => saveFile(url, file.originalName ?? "file"))
          .catch(() => toast.error(t("دریافت فایل ناموفق بود")))
      }
      className="flex max-w-full items-center gap-1.5 rounded-xl border border-chat-panel-border bg-white/70 px-2 py-1 text-[11px] text-chat-ink transition-colors hover:bg-white"
    >
      <Download className="size-3 shrink-0 text-chat-violet" />
      <span className="truncate">{file.originalName ?? t("پیوست")}</span>
      {file.sizeBytes ? (
        <span className="shrink-0 text-chat-ink-soft">{formatBytes(file.sizeBytes, digits)}</span>
      ) : null}
    </button>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-chat-ink/8">
      <span
        className="block h-full rounded-full bg-chat-violet transition-[width] duration-500"
        style={{ width: `${value}%` }}
      />
    </span>
  );
}

function TaskCard({ task, onOpen }: { task: TaskItem; onOpen: () => void }) {
  const { t, digits, language, day } = useI18n();
  const due =
    language === "fa"
      ? task.due
      : task.dueAt
        ? day(task.dueAt, { day: "numeric", month: "short" })
        : t("بدون مهلت");
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-[20px] border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-start transition-colors hover:bg-white"
    >
      <div className="flex items-center gap-2">
        <UserAvatar name={task.owner} seed={task.ownerId ?? 0} size={26} />
        <p className="min-w-0 flex-1 truncate text-[13px] font-bold text-chat-ink">{task.title}</p>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
            PRIORITY_TONE[task.priority],
          )}
        >
          {t(task.priority)}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10.5px] text-chat-ink-soft">
        <span className="truncate">{task.owner}</span>
        <span className="flex shrink-0 items-center gap-1 font-bold">
          <Clock className="size-3" />
          {due}
        </span>
        {task.reportCount ? (
          <span className="shrink-0">
            {t("{count} گزارش ثبت‌شده", { count: digits(task.reportCount) })}
          </span>
        ) : null}
        <span className="ms-auto w-20 shrink-0">
          <ProgressBar value={task.progress} />
        </span>
      </div>
    </button>
  );
}

export function TasksBoard({
  onOpenConversation,
}: {
  onOpenConversation?: (conversationId: number) => void;
}) {
  const { t, digits, day, clock } = useI18n();
  const session = readSession();
  const viewerId = session?.user.id ?? null;

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [counts, setCounts] = useState<TaskCounts | null>(null);
  const [capabilities, setCapabilities] = useState<TaskCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TaskStatus>("در انتظار");
  const [openId, setOpenId] = useState<number | null>(null);
  const [reports, setReports] = useState<TaskReport[]>([]);
  const [reportDraft, setReportDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [draft, setDraft] = useState<{
    title: string;
    description: string;
    ownerId: number | null;
    priority: TaskPriority;
    dueAt: Date | null;
  }>({ title: "", description: "", ownerId: null, priority: "عادی", dueAt: null });
  const attachInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchTasks();
      setTasks(result.tasks);
      setCounts(result.counts);
      setCapabilities(result.capabilities);
    } catch {
      toast.error(t("بارگذاری وظایف ناموفق بود"));
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
      if (!payload?.section || payload.section === "tasks") void load();
    };
    socket.on("workspace:changed", onChanged);
    return () => {
      socket.off("workspace:changed", onChanged);
    };
  }, [load]);

  const task = useMemo(() => tasks.find((item) => item.taskId === openId) ?? null, [tasks, openId]);

  useEffect(() => {
    if (openId === null) {
      setReports([]);
      return;
    }
    fetchTaskReports(openId)
      .then((result) => setReports(result.reports))
      .catch(() => undefined);
  }, [openId, tasks]);

  useEffect(() => {
    if (!createOpen || people.length) return;
    fetchDirectory()
      .then(setPeople)
      .catch(() => toast.error(t("بارگذاری فهرست همکاران ناموفق بود")));
  }, [createOpen, people.length, t]);

  const awaitingMine = tasks.some(
    (item) => item.status === "در انتظار" && item.ownerId === viewerId,
  );
  const visible = tasks.filter((item) => item.status === tab);
  const isOwner = task !== null && task.ownerId === viewerId;
  const isReviewer =
    task !== null &&
    (capabilities?.executive === true ||
      task.assignerId === viewerId ||
      (capabilities?.manageTeam === true && task.ownerId !== viewerId));

  const run = (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    action()
      .then(() => load())
      .catch(() => toast.error(t(failure)))
      .finally(() => setBusy(false));
  };

  const sendReport = async (files: File[]) => {
    if (openId === null) return;
    const body = reportDraft.trim();
    if (!body && files.length === 0) return;
    setBusy(true);
    try {
      const { report } = await addTaskReport(openId, body, files.length > 0);
      for (const file of files) {
        await uploadTaskReportFile(openId, report.reportId, file, "file");
      }
      setReportDraft("");
      const refreshed = await fetchTaskReports(openId);
      setReports(refreshed.reports);
      await load();
    } catch {
      toast.error(t("ثبت گزارش ناموفق بود"));
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = () => {
    if (!draft.title.trim() || !draft.ownerId) {
      toast.error(t("عنوان و مسئول وظیفه الزامی است"));
      return;
    }
    setBusy(true);
    createTask({
      title: draft.title.trim(),
      description: draft.description.trim(),
      ownerId: draft.ownerId,
      priority: draft.priority,
      dueAt: draft.dueAt ? draft.dueAt.toISOString() : null,
    })
      .then(() => {
        toast.success(t("وظیفه ثبت شد"));
        setCreateOpen(false);
        setDraft({ title: "", description: "", ownerId: null, priority: "عادی", dueAt: null });
        return load();
      })
      .catch(() => toast.error(t("ثبت وظیفه ناموفق بود")))
      .finally(() => setBusy(false));
  };

  return (
    <section className="panel flex h-full min-h-0 flex-col overflow-hidden rounded-[26px]">
      <header className="flex shrink-0 items-center gap-3 border-b border-chat-panel-border px-4 py-3">
        <span className="grid size-9 place-items-center rounded-2xl bg-chat-violet/12 text-chat-violet">
          <ListChecks className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[14.5px] font-semibold">{t("وظایف")}</p>
          <p className="truncate text-[11px] text-chat-ink-soft">
            {t("پیگیری کارها از پذیرش تا تأیید نهایی")}
          </p>
        </div>
        {capabilities?.assignTasks ? (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 rounded-full bg-chat-ink px-3.5 py-2 text-[11.5px] font-bold text-chat-on-ink transition-opacity hover:opacity-90"
          >
            <Plus className="size-3.5" />
            {t("وظیفهٔ جدید")}
          </button>
        ) : null}
      </header>

      <div className="flex shrink-0 gap-1.5 overflow-x-auto px-4 py-3">
        {TASK_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setTab(status)}
            className={cn(
              "relative shrink-0 rounded-full px-3.5 py-1.5 text-[11.5px] font-bold transition-colors",
              tab === status
                ? "bg-chat-ink text-chat-on-ink"
                : "border border-chat-panel-border bg-white/60 text-chat-ink-soft hover:bg-white hover:text-chat-ink",
            )}
          >
            {t(status)}
            {counts ? (
              <span
                className={cn("ms-1.5", tab === status ? "opacity-80" : "text-chat-ink-soft/80")}
              >
                {digits(counts[status])}
              </span>
            ) : null}
            {status === "در انتظار" && awaitingMine ? (
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
        ) : visible.length === 0 ? (
          <p className="py-16 text-center text-[12px] text-chat-ink-soft">
            {t("موردی در این وضعیت نیست.")}
          </p>
        ) : (
          <div className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
            {visible.map((item) => (
              <TaskCard key={item.taskId} task={item} onOpen={() => setOpenId(item.taskId)} />
            ))}
          </div>
        )}
      </div>

      <GlassDialog
        open={task !== null}
        onClose={() => setOpenId(null)}
        title={task?.title ?? ""}
        description={task ? t("سپرده‌شده از سوی {name}", { name: task.assigner }) : ""}
        size="lg"
      >
        {task ? (
          <div className="custom-scrollbar grid max-h-[62dvh] gap-3.5 overflow-y-auto pe-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-bold",
                  STATUS_TONE[task.status],
                )}
              >
                {t(task.status)}
              </span>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-bold",
                  PRIORITY_TONE[task.priority],
                )}
              >
                {t(task.priority)}
              </span>
              <span className="flex items-center gap-1 text-[11px] text-chat-ink-soft">
                <Clock className="size-3.5" />
                {task.due}
              </span>
              {task.tag ? (
                <span className="rounded-full bg-chat-sky/12 px-2.5 py-1 text-[11px] font-bold text-chat-sky-deep">
                  {task.tag}
                </span>
              ) : null}
            </div>

            {task.description ? (
              <p className="rounded-2xl border border-chat-panel-border bg-white/55 p-3 text-[12.5px] leading-relaxed text-chat-ink">
                {task.description}
              </p>
            ) : null}

            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold text-chat-ink-soft">
                <span>{t("پیشرفت")}</span>
                <span>{digits(task.progress)}٪</span>
              </div>
              <ProgressBar value={task.progress} />
              {isReviewer ? (
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={task.progress}
                  disabled={busy}
                  onChange={(event) =>
                    run(
                      () => setTaskProgress(task.taskId, Number(event.target.value)),
                      "ثبت پیشرفت ناموفق بود",
                    )
                  }
                  className="mt-2 w-full accent-[var(--chat-violet)]"
                />
              ) : null}
            </div>

            {task.reviewNote && task.status !== "انجام شد" ? (
              <p className="rounded-2xl border border-chat-lemon/40 bg-chat-lemon/10 p-3 text-[12px] leading-relaxed text-chat-ink">
                {t("بازخورد بررسی:")} {task.reviewNote}
              </p>
            ) : null}

            <div className="grid gap-2">
              <p className="text-[11.5px] font-bold text-chat-ink-soft">{t("گزارش‌های پیشرفت")}</p>
              {reports.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-chat-panel-border py-6 text-center text-[11.5px] text-chat-ink-soft">
                  {t("هنوز گزارشی ثبت نشده است.")}
                </p>
              ) : null}
              {reports.map((report) => (
                <div
                  key={report.reportId}
                  className={cn(
                    "rounded-2xl border p-3",
                    report.kind === "review"
                      ? "border-chat-lemon/40 bg-chat-lemon/8"
                      : "border-chat-panel-border bg-white/55",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <UserAvatar name={report.author} seed={report.authorId ?? 0} size={24} />
                    <span className="text-[11.5px] font-bold text-chat-ink">{report.author}</span>
                    <span className="ms-auto text-[10.5px] text-chat-ink-soft">
                      {day(report.createdAt, { day: "numeric", month: "long" })} —{" "}
                      {clock(report.createdAt)}
                    </span>
                  </div>
                  {report.body ? (
                    <p
                      className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-chat-ink"
                      dir="auto"
                    >
                      {report.body}
                    </p>
                  ) : null}
                  {report.files.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {report.files.map((file) => (
                        <FileChip key={file.id} file={file} />
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            {isOwner || isReviewer ? (
              <div className="rounded-2xl border border-chat-panel-border bg-white/60 p-2.5">
                <textarea
                  rows={2}
                  value={reportDraft}
                  onChange={(event) => setReportDraft(event.target.value)}
                  placeholder={t("گزارش پیشرفت یا توضیح خود را بنویسید...")}
                  className="w-full resize-none bg-transparent text-[12.5px] leading-relaxed text-chat-ink outline-none placeholder:text-chat-ink-soft"
                  dir="auto"
                />
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    ref={attachInput}
                    type="file"
                    multiple
                    hidden
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.target.value = "";
                      if (files.length) void sendReport(files);
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => attachInput.current?.click()}
                    aria-label={t("افزودن پیوست")}
                    className="grid size-8 place-items-center rounded-full border border-chat-panel-border text-chat-ink-soft transition-colors hover:bg-white hover:text-chat-ink"
                  >
                    <Paperclip className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={busy || !reportDraft.trim()}
                    onClick={() => void sendReport([])}
                    className="ms-auto flex items-center gap-1.5 rounded-full bg-chat-violet px-3.5 py-1.5 text-[11.5px] font-bold text-chat-on-accent transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    <Send className="size-3.5 rtl:-scale-x-100" />
                    {t("ثبت گزارش")}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t border-chat-panel-border pt-3">
              {isOwner && task.status === "در انتظار" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => acceptTask(task.taskId), "پذیرش وظیفه ناموفق بود")}
                  className="flex items-center gap-1.5 rounded-full bg-chat-mint px-4 py-2 text-[12px] font-bold text-chat-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <CheckCircle2 className="size-4" />
                  {t("پذیرش وظیفه")}
                </button>
              ) : null}
              {isOwner && task.status === "در حال انجام" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => submitTask(task.taskId), "اعلام اتمام ناموفق بود")}
                  className="flex items-center gap-1.5 rounded-full bg-chat-ink px-4 py-2 text-[12px] font-bold text-chat-on-ink transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <CheckCircle2 className="size-4" />
                  {t("اعلام اتمام کار")}
                </button>
              ) : null}
              {isReviewer && task.status === "بررسی" ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(() => reviewTask(task.taskId, true), "تأیید نهایی ناموفق بود")
                    }
                    className="flex items-center gap-1.5 rounded-full bg-chat-mint px-4 py-2 text-[12px] font-bold text-chat-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    <CheckCircle2 className="size-4" />
                    {t("تأیید نهایی")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const note = reportDraft.trim();
                      if (!note) {
                        toast.error(t("برای برگرداندن وظیفه، دلیل را بنویسید"));
                        return;
                      }
                      setReportDraft("");
                      run(() => reviewTask(task.taskId, false, note), "برگرداندن وظیفه ناموفق بود");
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-chat-panel-border bg-white/70 px-4 py-2 text-[12px] font-bold text-chat-ink transition-colors hover:bg-white disabled:opacity-50"
                  >
                    <RotateCcw className="size-4" />
                    {t("برگشت برای اصلاح")}
                  </button>
                </>
              ) : null}
              {task.assignerId !== null && task.assignerId !== viewerId ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    openTaskChat(task.taskId, reportDraft.trim())
                      .then((result) => {
                        if (result.conversationId) {
                          setOpenId(null);
                          onOpenConversation?.(result.conversationId);
                          return;
                        }
                        toast.success(t("تیکت برای مدیریت ثبت شد؛ پس از تأیید، گفتگو باز می‌شود"));
                      })
                      .catch(() => toast.error(t("ثبت تیکت ناموفق بود")))
                      .finally(() => setBusy(false));
                  }}
                  className="ms-auto flex items-center gap-1.5 rounded-full border border-chat-panel-border bg-white/70 px-4 py-2 text-[12px] font-bold text-chat-ink transition-colors hover:bg-white disabled:opacity-50"
                >
                  <MessageSquare className="size-4" />
                  {t("تیکت")}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </GlassDialog>

      <GlassDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t("وظیفهٔ جدید")}
        description={t("کار را برای یکی از همکاران تعریف کنید.")}
      >
        <div className="grid gap-3">
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
            <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("شرح کار")}</span>
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
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("مسئول")}</span>
              <select
                value={draft.ownerId ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    ownerId: Number(event.target.value) || null,
                  }))
                }
                className="rounded-2xl border border-chat-panel-border bg-white/70 px-3 py-2.5 text-[12.5px] text-chat-ink outline-none focus:bg-white"
              >
                <option value="">{t("انتخاب کنید")}</option>
                {people
                  .filter((person) => person.userId !== viewerId)
                  .map((person) => (
                    <option key={person.userId} value={person.userId}>
                      {person.name} — {person.unit}
                    </option>
                  ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("اولویت")}</span>
              <select
                value={draft.priority}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    priority: event.target.value as TaskPriority,
                  }))
                }
                className="rounded-2xl border border-chat-panel-border bg-white/70 px-3 py-2.5 text-[12.5px] text-chat-ink outline-none focus:bg-white"
              >
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {t(priority)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-1.5">
            <span className="text-[11.5px] font-bold text-chat-ink-soft">{t("مهلت انجام")}</span>
            <DatePicker
              value={draft.dueAt}
              onChange={(value) => setDraft((current) => ({ ...current, dueAt: value }))}
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={submitCreate}
              className="rounded-full bg-chat-ink px-4 py-2 text-[12px] font-bold text-chat-on-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t("ثبت وظیفه")}
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
