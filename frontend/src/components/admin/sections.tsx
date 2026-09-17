import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  ArchiveRestore,
  BellRing,
  CheckCheck,
  Database,
  Download,
  Eye,
  FileArchive,
  Hash,
  KeyRound,
  ChevronDown,
  FileText,
  ImagePlus,
  Link2,
  Link2Off,
  Megaphone,
  Paperclip,
  RefreshCw,
  Settings2,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  AdminNavigationContext,
  PERMISSION_FIELDS,
  VISIBILITY_OPTIONS,
  deleteSpace,
  deleteSystemFile,
  discardForward,
  fetchForwardQueue,
  fetchImageUrl,
  fetchSpaceDetails,
  fetchSystemFiles,
  linkSpace,
  removeSpaceAvatar,
  retryForward,
  setMemberPermissions,
  unlinkSpace,
  updateSpaceInfo,
  uploadSpaceAvatar,
  type FileScope,
  type SpaceDetails,
  type SystemFile,
  type Visibility,
  APPROVAL_EVENTS,
  AUDIT_EVENTS,
  BACKUP_EVENTS,
  REPEAT_OPTIONS,
  ROLE_LABELS,
  ROLE_OPTIONS,
  SESSION_EVENTS,
  SETTINGS_EVENTS,
  USER_EVENTS,
  addSpaceMember,
  archiveUser,
  auditExportPath,
  createReminder,
  setReminderAttachment,
  createSpace,
  createTag,
  createUser,
  decideApproval,
  deleteReminder,
  deleteTag,
  deleteUser,
  downloadFile,
  errorMessage,
  fetchAnnouncementTargets,
  fetchApprovals,
  fetchArchives,
  fetchAudit,
  fetchBackups,
  fetchConversations,
  fetchOverview,
  fetchReminders,
  fetchSessions,
  fetchSettings,
  fetchSpaceMembers,
  fetchSpaces,
  fetchTags,
  fetchTranscript,
  fetchUsers,
  latinDigits,
  monitoredFilePath,
  normalizeClock,
  removeSpaceMember,
  repeatOptionFor,
  resetUserPassword,
  revokeSession,
  runBackup,
  saveSettings,
  setReminderActive,
  setSpaceArchived,
  setSpaceMemberRole,
  setUserActive,
  setUserRole,
  setUserTag,
  transferSpaceOwner,
  updateReminder,
  useAdminResource,
  verifyOwnPassword,
  viewUserPassword,
  type ActiveSession,
  type AdminApproval,
  type AdminUser,
  type ApprovalDecision,
  type AuditLevel,
  type Backup,
  type Gauge,
  type MonitoredConversation,
  type PolicyFlag,
  type Reminder,
  type ReminderTargetType,
  type Role,
  type Settings,
  type Space,
  type SpaceKind,
  type SpaceMember,
  type SpaceMembers,
  type Stat,
  type AdminUser as AdminUserRecord,
  type Tag,
  type Transcript,
  type TranscriptKind,
  type UserCounts,
  type UserFilter,
} from "@/lib/admin";
import { setMemberPermission, setMemberTitle } from "@/lib/manager";
import { AlphaIndex, LetterHeader } from "@/components/ui/alpha-index";
import { groupByLetter, jumpToLetter, useActiveLetter } from "@/lib/people";
import {
  Avatar,
  Btn,
  ClockField,
  Combo,
  ConfirmDialog,
  CountedSegmented,
  Field,
  Panel,
  PanelDialog,
  PanelHead,
  Pill,
  Segmented,
  SelectField,
  Toggle,
} from "./ui";
import { useI18n } from "@/lib/i18n";
import { translate } from "@/lib/i18n-core";
import { cn } from "@/lib/utils";
import { T } from "@/components/ui/t";
import { isVisualMedia } from "@/lib/files";
import { TranscriptChat } from "@/components/admin/transcript-chat";

const fa = (value: number) => value.toLocaleString("fa-IR");

function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function useCreateIntent(onCreate: () => void) {
  const { intent, consumeIntent } = useContext(AdminNavigationContext);
  useEffect(() => {
    if (intent !== "create") return;
    onCreate();
    consumeIntent();
  }, [intent, consumeIntent, onCreate]);
}

async function attempt(action: () => Promise<unknown>, success: string, failure: string) {
  try {
    await action();
    if (success) toast.success(success);
    return true;
  } catch (error) {
    toast.error(errorMessage(error, failure));
    return false;
  }
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-[12.5px] text-chat-ink-soft">{children}</p>;
}

const activeSpaces = () =>
  fetchSpaces("all").then((list) => list.filter((space) => !space.archived));

/* ---------------------------------- نمای کلی --------------------------------- */

const STAT_STYLE = {
  users: { icon: Users, accent: "mint" },
  spaces: { icon: Megaphone, accent: "sky" },
  messages: { icon: TrendingUp, accent: "violet" },
  alerts: { icon: ShieldAlert, accent: "rose" },
} as const;

const PENDING_STATS: Stat[] = [
  { key: "users", label: "کاربران فعال", value: "—", delta: "" },
  { key: "spaces", label: "کانال و گروه", value: "—", delta: "" },
  { key: "messages", label: "پیام امروز", value: "—", delta: "" },
  { key: "alerts", label: "هشدار امنیتی", value: "—", delta: "" },
];

const PENDING_GAUGES: Gauge[] = [
  { key: "database", label: "پایگاه‌داده", value: null },
  { key: "storage", label: "فضای ذخیره‌سازی", value: null },
  { key: "queue", label: "صف پیام‌ها", value: null },
];

const GAUGE_TONES = {
  database: "bg-chat-mint",
  storage: "bg-chat-sky",
  queue: "bg-chat-violet",
} as const;

const iconWrap = {
  mint: "bg-chat-mint/20 text-chat-mint-deep",
  sky: "bg-chat-sky/18 text-chat-sky-deep",
  violet: "bg-chat-violet/18 text-chat-violet",
  rose: "bg-chat-rose/15 text-chat-rose",
  lemon: "bg-chat-lemon/25 text-chat-ink",
} as const;

const levelDot = (level: AuditLevel) =>
  level === "danger" ? "bg-chat-rose" : level === "warn" ? "bg-chat-lemon" : "bg-chat-mint";

const DECISION_COPY = {
  رد: {
    title: "رد درخواست",
    confirm: "رد کن",
    variant: "danger",
    success: "درخواست رد شد",
    describe: (item: AdminApproval) =>
      `درخواست «${item.title}» از ${item.person} رد می‌شود و نتیجه در کارتابل متقاضی نمایش داده می‌شود.`,
  },
  ارجاع: {
    title: "ارجاع به متقاضی",
    confirm: "ارجاع بده",
    variant: "solid",
    success: "درخواست برای اصلاح به متقاضی برگشت",
    describe: (item: AdminApproval) =>
      `درخواست «${item.title}» برای اصلاح به ${item.person} برگشت داده می‌شود.`,
  },
} as const;

function ApprovalQueue() {
  const { data, reload } = useAdminResource(fetchApprovals, APPROVAL_EVENTS);
  const [pending, setPending] = useState<{
    item: AdminApproval;
    decision: keyof typeof DECISION_COPY;
  } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const items = data ?? [];

  const closeDialog = () => {
    setPending(null);
    setNote("");
  };

  const decide = async (item: AdminApproval, decision: ApprovalDecision, text: string) => {
    setBusy(true);
    const ok = await attempt(
      () => decideApproval(item.requestId, decision, text),
      decision === "تأیید" ? "درخواست تأیید شد" : DECISION_COPY[decision].success,
      "ثبت تصمیم ناموفق بود",
    );
    setBusy(false);
    if (ok) {
      closeDialog();
      await reload();
    }
  };

  const copy = pending ? DECISION_COPY[pending.decision] : null;

  return (
    <Panel className="shrink-0">
      <PanelHead
        title="کارتابل ادمین کل"
        hint="درخواست‌هایی که مرحله فعلی آن‌ها با تأیید ادمین کل است؛ تصمیم با امضای شما ثبت می‌شود."
        action={
          items.length ? (
            <Pill accent="rose">{translate("{count} در انتظار", { count: fa(items.length) })}</Pill>
          ) : null
        }
      />
      <div className="custom-scrollbar max-h-[24vh] overflow-y-auto px-2 pb-3">
        {items.map((item) => (
          <div
            key={item.requestId}
            className="rounded-2xl px-3 py-2.5 hover:bg-white/60 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] text-chat-ink truncate">
                  <span className="font-bold">{item.title}</span> — {item.person}
                </p>
                <p className="text-[11px] text-chat-ink-soft truncate">
                  {item.stepName ?? item.stage} · {item.details}
                </p>
              </div>
              <Pill accent={item.tone}>{item.priority}</Pill>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn variant="soft" onClick={() => void decide(item, "تأیید", "")} disabled={busy}>
                <CheckCheck className="size-4" />
                <T>تأیید</T>
              </Btn>
              <Btn
                variant="danger"
                onClick={() => setPending({ item, decision: "رد" })}
                disabled={busy}
              >
                <T>رد</T>
              </Btn>
              <Btn onClick={() => setPending({ item, decision: "ارجاع" })} disabled={busy}>
                <T>ارجاع</T>
              </Btn>
            </div>
          </div>
        ))}
        {data && items.length === 0 ? (
          <EmptyNote>
            <T>درخواستی در انتظار تصمیم ادمین کل نیست.</T>
          </EmptyNote>
        ) : null}
      </div>
      <ConfirmDialog
        open={pending !== null}
        title={copy?.title ?? ""}
        description={pending && copy ? copy.describe(pending.item) : ""}
        confirmLabel={copy?.confirm ?? ""}
        variant={copy?.variant ?? "danger"}
        busy={busy}
        onConfirm={() => {
          if (pending) void decide(pending.item, pending.decision, note.trim());
        }}
        onClose={closeDialog}
      >
        <Field label="توضیح برای متقاضی (اختیاری)" value={note} onChange={setNote} />
      </ConfirmDialog>
    </Panel>
  );
}

export function OverviewSection() {
  const { t, digits } = useI18n();
  const { data } = useAdminResource(fetchOverview, AUDIT_EVENTS);
  const { open } = useContext(AdminNavigationContext);
  const stats = data?.stats ?? PENDING_STATS;
  const gauges = data?.health ?? PENDING_GAUGES;
  const events = data?.events ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="grid shrink-0 grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((s) => {
          const style = STAT_STYLE[s.key];
          return (
            <Panel key={s.key} className="p-4">
              <div
                className={cn("size-9 rounded-2xl grid place-items-center", iconWrap[style.accent])}
              >
                <style.icon className="size-[17px]" />
              </div>
              <p className="mt-3 font-display text-2xl font-semibold text-chat-ink">
                {digits(s.value)}
              </p>
              <p className="text-[12px] text-chat-ink-soft mt-0.5">{t(s.label)}</p>
              <p className="text-[10.5px] text-chat-ink-soft/70 mt-2">{t(s.delta)}</p>
            </Panel>
          );
        })}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex min-h-0 flex-col gap-4">
          <ApprovalQueue />
          <Panel className="flex min-h-0 flex-1 flex-col">
            <PanelHead
              title="آخرین رویدادهای سامانه"
              hint="هر اقدام حساس با نام انجام‌دهنده و زمان دقیق ثبت می‌شود."
              action={
                <Pill accent="mint">
                  <T>زنده</T>
                </Pill>
              }
            />
            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {events.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-white/60 transition-colors"
                >
                  <span className={cn("size-2 rounded-full shrink-0", levelDot(l.level))} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] text-chat-ink truncate">
                      <span className="font-bold">{l.actor}</span> — {l.action}
                    </p>
                    <p className="text-[11px] text-chat-ink-soft truncate">{l.target}</p>
                  </div>
                  <span className="text-[10.5px] text-chat-ink-soft/70 shrink-0">{l.at}</span>
                </div>
              ))}
              {data && events.length === 0 ? (
                <EmptyNote>
                  <T>هنوز رویدادی ثبت نشده است.</T>
                </EmptyNote>
              ) : null}
            </div>
          </Panel>
        </div>

        <div className="grid min-h-0 content-start gap-4">
          <Panel className="p-5">
            <h3 className="font-display text-[15px] font-semibold text-chat-ink">
              <T>سلامت سرویس</T>
            </h3>
            <div className="mt-4 grid gap-3.5">
              {gauges.map((m) => (
                <div key={m.key}>
                  <div className="flex items-center justify-between text-[11.5px] text-chat-ink-soft">
                    <span>{t(m.label)}</span>
                    {m.value === null ? (
                      <span>
                        <T>در حال محاسبه</T>
                      </span>
                    ) : (
                      <span dir="ltr">{m.value}%</span>
                    )}
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-chat-ink/8 overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", GAUGE_TONES[m.key])}
                      style={{ width: `${m.value ?? 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- کاربران ---------------------------------- */

const roleAccent: Record<Role, "violet" | "sky" | "mint" | "lemon"> = {
  super_admin: "violet",
  management: "sky",
  manager: "lemon",
  employee: "mint",
};

const EMPTY_USER_FORM = {
  fullName: "",
  phone: "",
  role: "employee" as Role,
  tagId: "",
  password: "",
};

type UserDialog =
  | { kind: "reset" | "view" | "archive" | "delete" | "disable"; user: AdminUser }
  | { kind: "role"; user: AdminUser; role: Role };

const USER_DIALOG_COPY = {
  role: { title: "تغییر نقش کاربر", confirm: "تغییر نقش", variant: "solid" },
  disable: { title: "غیرفعال‌سازی حساب", confirm: "غیرفعال کن", variant: "danger" },
  reset: { title: "تعیین رمز جدید", confirm: "ثبت رمز", variant: "solid" },
  view: { title: "مشاهده رمز عبور", confirm: "نمایش رمز", variant: "danger" },
  archive: { title: "آرشیو داده‌ها", confirm: "تهیه و دانلود", variant: "solid" },
  delete: { title: "حذف کاربر", confirm: "حذف کاربر", variant: "danger" },
} as const;

function userDialogDescription(dialog: UserDialog) {
  const name = dialog.user.fullName;
  switch (dialog.kind) {
    case "role":
      return `نقش ${name} از «${ROLE_LABELS[dialog.user.role]}» به «${ROLE_LABELS[dialog.role]}» تغییر می‌کند و همه نشست‌های فعال او بسته می‌شود.`;
    case "disable":
      return `ورود ${name} مسدود می‌شود و همه نشست‌های فعال او همین حالا پایان می‌یابد.`;
    case "reset":
      return `برای تعیین رمز جدید ${name}، ابتدا رمز عبور خودتان را وارد کنید. نشست‌های فعلی این کاربر بسته می‌شود.`;
    case "view":
      return `برای مشاهده رمز ${name}، ابتدا رمز عبور خودتان را وارد کنید. این مشاهده با نام شما در لاگ فعالیت ثبت می‌شود.`;
    case "archive":
      return `یک فایل فشرده از گفتگوها و فایل‌های ${name} ساخته و دانلود می‌شود. این اقدام در لاگ فعالیت ثبت می‌شود.`;
    case "delete":
      return `حساب ${name} برای همیشه حذف می‌شود. پیش از حذف، آرشیو داده‌هایش ساخته و ۹۰ روز نگهداری می‌شود. برای تأیید، نام کامل کاربر را بنویسید.`;
  }
}

const PRESENCE_LABELS = { online: "آنلاین", away: "غایب", offline: "آفلاین" } as const;

const GRANTS = [
  { key: "schedule_meetings", label: "تعریف جلسه" },
  { key: "assign_tasks", label: "تعریف وظیفه" },
];

function TitleField({
  value,
  busy,
  onChange,
  onSubmit,
}: {
  value: string | null;
  busy: boolean;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value ?? "");
  const [touched, setTouched] = useState(false);
  const shown = touched ? draft : (value ?? "");
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-bold text-chat-ink-soft">
        {t("عنوان سازمانی")}
      </span>
      <span className="flex items-center gap-2">
        <input
          value={shown}
          onChange={(event) => {
            setTouched(true);
            setDraft(event.target.value);
            onChange(event.target.value);
          }}
          maxLength={80}
          placeholder={t("مثلاً مدیر فروش")}
          className="min-w-0 flex-1 rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-[13px] text-chat-ink outline-none transition-colors placeholder:text-chat-ink-soft focus:border-chat-sky/30 focus:bg-white"
        />
        <Btn
          variant="soft"
          disabled={busy || shown.trim() === (value ?? "").trim()}
          onClick={() => {
            setTouched(false);
            onSubmit(shown.trim());
          }}
        >
          <T>ثبت</T>
        </Btn>
      </span>
      <span className="mt-1.5 block text-[10.5px] leading-relaxed text-chat-ink-soft">
        {t("این عنوان کنار نقش کاربر در بالای پنل خودش نمایش داده می‌شود.")}
      </span>
    </label>
  );
}

function GrantList({
  user,
  busy,
  onToggle,
}: {
  user: AdminUser;
  busy: boolean;
  onToggle: (permission: string, enabled: boolean) => void;
}) {
  const { t } = useI18n();
  const inherited = user.role !== "employee";
  return (
    <div className="rounded-2xl border border-chat-panel-border bg-white/60 p-3.5">
      <p className="flex items-center gap-1.5 text-[11.5px] font-bold text-chat-ink-soft">
        <KeyRound className="size-3.5" />
        {t("دسترسی‌ها")}
      </p>
      {inherited ? (
        <p className="mt-2 text-[11px] leading-relaxed text-chat-ink-soft">
          {t("این نقش همهٔ دسترسی‌های زیر را به‌صورت پیش‌فرض دارد.")}
        </p>
      ) : (
        <div className="mt-2.5 grid gap-2">
          {GRANTS.map((grant) => (
            <div key={grant.key} className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-chat-ink">{t(grant.label)}</span>
              <Toggle
                on={user.permissions.includes(grant.key)}
                disabled={busy}
                onChange={(next) => onToggle(grant.key, next)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function UsersSection() {
  const { t, digits } = useI18n();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<UserFilter>("all");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_USER_FORM);
  const [selected, setSelected] = useState<number | null>(null);
  const [dialog, setDialog] = useState<UserDialog | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [ownPassword, setOwnPassword] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  const search = useDebounced(query);
  const loadUsers = useCallback(() => fetchUsers(search, role), [search, role]);
  const { data, reload } = useAdminResource(loadUsers, USER_EVENTS);
  const { data: tags } = useAdminResource(fetchTags, AUDIT_EVENTS);
  const users = data?.users ?? [];
  const counts = data?.counts;
  const tagList = tags ?? [];

  const startCreating = useCallback(() => setCreating(true), []);
  useCreateIntent(startCreating);

  const groups = useMemo(() => groupByLetter(users, (user) => user.fullName), [users]);
  const activeLetter = useActiveLetter(list, groups.length);

  const current = users.find((u) => u.id === selected) ?? users[0];

  const perform = async (action: () => Promise<unknown>, success: string, failure: string) => {
    setBusy(true);
    const ok = await attempt(action, success, failure);
    setBusy(false);
    if (ok) await reload();
    return ok;
  };

  const closeDialog = () => {
    setDialog(null);
    setNewPassword("");
    setOwnPassword("");
    setRevealed(null);
    setConfirmName("");
  };

  const submitUser = async () => {
    if (!form.fullName.trim()) {
      toast.error(translate("نام کامل را وارد کنید"));
      return;
    }
    const ok = await perform(
      async () => {
        const result = await createUser({
          fullName: form.fullName.trim(),
          phone: latinDigits(form.phone),
          role: form.role,
          tagId: form.tagId ? Number(form.tagId) : null,
          password: form.password.trim() || null,
        });
        setSelected(result.user.id);
      },
      "کاربر ساخته شد",
      "ساخت کاربر ناموفق بود",
    );
    if (ok) {
      setCreating(false);
      setForm(EMPTY_USER_FORM);
    }
  };

  const confirmUserDialog = async () => {
    if (!dialog) return;
    const { user } = dialog;
    switch (dialog.kind) {
      case "role": {
        const nextRole = dialog.role;
        if (
          await perform(
            () => setUserRole(user.id, nextRole),
            "نقش کاربر تغییر کرد",
            "تغییر نقش ناموفق بود",
          )
        ) {
          closeDialog();
        }
        return;
      }
      case "disable":
        if (
          await perform(
            () => setUserActive(user.id, false),
            "حساب غیرفعال شد و نشست‌های آن بسته شد",
            "غیرفعال‌سازی حساب ناموفق بود",
          )
        ) {
          closeDialog();
        }
        return;
      case "reset":
        if (!ownPassword) {
          toast.error(translate("رمز عبور خودتان را وارد کنید"));
          return;
        }
        if (newPassword.trim().length < 6) {
          toast.error(translate("رمز عبور باید دست‌کم ۶ نویسه باشد"));
          return;
        }
        if (
          await perform(
            async () => {
              await verifyOwnPassword(ownPassword);
              await resetUserPassword(user.id, newPassword.trim());
            },
            "رمز جدید ثبت شد",
            "ثبت رمز جدید ناموفق بود",
          )
        ) {
          closeDialog();
        }
        return;
      case "view":
        if (revealed !== null) {
          closeDialog();
          return;
        }
        if (!ownPassword) {
          toast.error(translate("رمز عبور خودتان را وارد کنید"));
          return;
        }
        setBusy(true);
        try {
          await verifyOwnPassword(ownPassword);
          setRevealed(await viewUserPassword(user.id));
        } catch (error) {
          toast.error(errorMessage(error, "مشاهده رمز ناموفق بود"));
        } finally {
          setBusy(false);
        }
        return;
      case "archive":
        if (
          await perform(
            async () => {
              const { archive } = await archiveUser(user.id);
              await downloadFile(`/admin/exports/${archive.id}/download`, `${user.fullName}.zip`);
            },
            "آرشیو داده‌ها ساخته و دانلود شد",
            "تهیه آرشیو ناموفق بود",
          )
        ) {
          closeDialog();
        }
        return;
      case "delete":
        if (
          await perform(
            () => deleteUser(user.id, confirmName.trim()),
            "کاربر حذف شد و داده‌هایش به آرشیو رفت",
            "حذف کاربر ناموفق بود",
          )
        ) {
          setSelected(null);
          closeDialog();
        }
        return;
    }
  };

  const filters: { value: UserFilter; label: string; count: number | undefined }[] = [
    { value: "all", label: "همه", count: counts?.all },
    ...ROLE_OPTIONS.map((option) => ({
      value: option.value as UserFilter,
      label: option.label,
      count: counts?.[option.value],
    })),
    { value: "never", label: "وارد نشده", count: counts?.neverSignedIn },
  ];

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_356px]">
      <Panel className="flex min-h-0 flex-col overflow-hidden">
        <PanelHead
          title="کاربران و نقش‌ها"
          hint="ساخت کاربر، تعیین عنوان و نقش، تگ سازمانی، دسترسی‌ها و مدیریت حساب."
          action={
            <Btn variant="solid" onClick={() => setCreating((v) => !v)}>
              <Plus className="size-4" />
              <T>کاربر جدید</T>
            </Btn>
          }
        />

        {creating ? (
          <div className="mx-5 mb-4 shrink-0 rounded-2xl border border-chat-mint/25 bg-chat-mint/10 p-4">
            <p className="mb-3 font-display text-[13px] font-semibold text-chat-mint-deep">
              <T>افزودن کاربر جدید</T>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="نام کامل"
                placeholder="مثلاً علی رضایی"
                value={form.fullName}
                onChange={(v) => setForm((f) => ({ ...f, fullName: v }))}
              />
              <Field
                label="شماره موبایل"
                placeholder="09120000011"
                dir="ltr"
                value={form.phone}
                onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
              />
              <SelectField
                label="نقش"
                value={form.role}
                onChange={(v) => setForm((f) => ({ ...f, role: v as Role }))}
                options={ROLE_OPTIONS}
              />
              <SelectField
                label="تگ سازمانی"
                value={form.tagId}
                onChange={(v) => setForm((f) => ({ ...f, tagId: v }))}
                options={[
                  { value: "", label: "بدون تگ" },
                  ...tagList.map((tag) => ({ value: String(tag.id), label: tag.name })),
                ]}
              />
              <Field
                label="رمز عبور (اختیاری)"
                placeholder="خالی بگذارید تا کاربر خودش بسازد"
                dir="ltr"
                value={form.password}
                onChange={(v) => setForm((f) => ({ ...f, password: v }))}
              />
              <div className="flex items-end gap-2">
                <Btn variant="solid" className="flex-1" onClick={submitUser} disabled={busy}>
                  <T>ثبت کاربر</T>
                </Btn>
                <Btn onClick={() => setCreating(false)}>
                  <T>انصراف</T>
                </Btn>
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pb-4">
          <div className="flex min-w-[180px] flex-1 items-center gap-2 rounded-full border border-chat-panel-border bg-white/60 px-3.5 py-2 text-[12.5px]">
            <Search className="size-4 text-chat-ink-soft" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("جستجوی نام، شماره یا تگ...")}
              className="w-full bg-transparent text-chat-ink outline-none placeholder:text-chat-ink-soft"
            />
          </div>
          <CountedSegmented value={role} onChange={setRole} items={filters} />
        </div>

        <div className="flex min-h-0 flex-1 bg-chat-sky/[0.06]">
          <div ref={list} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {groups.map((group) => (
              <div key={group.letter}>
                <LetterHeader letter={group.letter} />
                <div className="grid gap-1.5">
                  {group.items.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setSelected(u.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-start transition-colors",
                        current?.id === u.id
                          ? "border-chat-violet/35 bg-white shadow-sm"
                          : "border-chat-panel-border bg-white/70 hover:bg-white",
                      )}
                    >
                      <Avatar initials={u.initials} accent={u.accent} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-[13px] font-bold text-chat-ink">
                            {u.fullName}
                          </p>
                          {!u.isActive ? (
                            <Pill accent="rose">
                              <T>غیرفعال</T>
                            </Pill>
                          ) : null}
                          {!u.hasPassword ? (
                            <Pill accent="lemon">
                              <T>بدون رمز</T>
                            </Pill>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-chat-ink-soft">
                          <span dir="ltr">{digits(u.phone)}</span>
                          {u.jobTitle ? ` · ${u.jobTitle}` : ""}
                        </p>
                      </div>
                      <Pill accent={roleAccent[u.role]}>{ROLE_LABELS[u.role]}</Pill>
                      <span className="hidden w-24 text-left text-[11px] text-chat-ink-soft/70 sm:inline">
                        {t(u.lastSeen)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {data && users.length === 0 ? (
              <EmptyNote>
                <T>نتیجه‌ای یافت نشد.</T>
              </EmptyNote>
            ) : null}
          </div>
          <AlphaIndex
            letters={groups.map((group) => group.letter)}
            active={activeLetter}
            onJump={(letter) => jumpToLetter(list.current, letter)}
          />
        </div>
      </Panel>

      {current ? (
        <Panel className="custom-scrollbar min-h-0 overflow-y-auto p-5">
          <div className="flex items-center gap-3">
            <Avatar initials={current.initials} accent={current.accent} size={48} />
            <div className="min-w-0">
              <p className="truncate font-display text-[15px] font-semibold text-chat-ink">
                {current.fullName}
              </p>
              <p className="text-[11.5px] text-chat-ink-soft" dir="ltr">
                {digits(current.phone)}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            <TitleField
              key={`title-${current.id}`}
              value={titleDraft ?? current.jobTitle}
              busy={busy}
              onChange={setTitleDraft}
              onSubmit={(value) =>
                void perform(
                  () => setMemberTitle(current.id, value),
                  "عنوان کاربر ثبت شد",
                  "ثبت عنوان ناموفق بود",
                ).then(() => setTitleDraft(null))
              }
            />
            <SelectField
              label="نقش"
              value={current.role}
              onChange={(v) => {
                if (v !== current.role) setDialog({ kind: "role", user: current, role: v as Role });
              }}
              options={ROLE_OPTIONS}
            />
            <SelectField
              label="تگ سازمانی"
              value={current.tagId ? String(current.tagId) : ""}
              onChange={(v) =>
                void perform(
                  () => setUserTag(current.id, v ? Number(v) : null),
                  "تگ کاربر به‌روزرسانی شد",
                  "تغییر تگ ناموفق بود",
                )
              }
              options={[
                { value: "", label: "بدون تگ" },
                ...tagList.map((tag) => ({ value: String(tag.id), label: tag.name })),
              ]}
            />

            <GrantList
              user={current}
              busy={busy}
              onToggle={(permission, enabled) =>
                void perform(
                  () => setMemberPermission(current.id, permission, enabled),
                  enabled ? "دسترسی داده شد" : "دسترسی برداشته شد",
                  "تغییر دسترسی ناموفق بود",
                )
              }
            />

            <div className="flex items-center justify-between rounded-2xl border border-chat-panel-border bg-white/60 px-3.5 py-2.5">
              <span className="text-[12.5px] font-bold text-chat-ink">
                {current.isActive ? t("حساب فعال است") : t("حساب غیرفعال است")}
              </span>
              <Toggle
                on={current.isActive}
                disabled={busy}
                onChange={(v) => {
                  if (v) {
                    void perform(
                      () => setUserActive(current.id, true),
                      "حساب فعال شد",
                      "فعال‌سازی حساب ناموفق بود",
                    );
                  } else {
                    setDialog({ kind: "disable", user: current });
                  }
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Btn variant="soft" onClick={() => setDialog({ kind: "reset", user: current })}>
                <KeyRound className="size-4" />
                <T>رمز جدید</T>
              </Btn>
              <Btn
                onClick={() => setDialog({ kind: "view", user: current })}
                disabled={!current.hasPassword}
              >
                <Eye className="size-4" />
                <T>مشاهده رمز</T>
              </Btn>
              <Btn onClick={() => setDialog({ kind: "archive", user: current })}>
                <ArchiveRestore className="size-4" />
                <T>آرشیو داده‌ها</T>
              </Btn>
              <Btn variant="danger" onClick={() => setDialog({ kind: "delete", user: current })}>
                <Trash2 className="size-4" />
                <T>حذف کاربر</T>
              </Btn>
            </div>

            <div className="rounded-2xl bg-chat-ink/5 px-3.5 py-3 text-[11.5px] leading-relaxed text-chat-ink-soft">
              {t("آخرین فعالیت: {value}", { value: t(current.lastSeen) })} ·{" "}
              {t("وضعیت: {value}", { value: t(PRESENCE_LABELS[current.presence]) })}
            </div>
          </div>
        </Panel>
      ) : null}

      {dialog ? (
        <ConfirmDialog
          open
          title={USER_DIALOG_COPY[dialog.kind].title}
          description={userDialogDescription(dialog)}
          confirmLabel={
            dialog.kind === "view" && revealed !== null
              ? "بستن"
              : USER_DIALOG_COPY[dialog.kind].confirm
          }
          variant={
            dialog.kind === "view" && revealed !== null
              ? "solid"
              : USER_DIALOG_COPY[dialog.kind].variant
          }
          busy={busy}
          onConfirm={() => void confirmUserDialog()}
          onClose={closeDialog}
        >
          {dialog.kind === "reset" || (dialog.kind === "view" && revealed === null) ? (
            <Field
              label="رمز عبور خودتان"
              type="password"
              dir="ltr"
              value={ownPassword}
              onChange={setOwnPassword}
            />
          ) : null}
          {dialog.kind === "reset" ? (
            <Field label="رمز عبور جدید" dir="ltr" value={newPassword} onChange={setNewPassword} />
          ) : null}
          {dialog.kind === "delete" ? (
            <Field
              label="نام کامل کاربر"
              placeholder={dialog.user.fullName}
              value={confirmName}
              onChange={setConfirmName}
            />
          ) : null}
          {dialog.kind === "view" && revealed !== null ? (
            <p
              dir="ltr"
              className="select-all rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-center font-mono text-[14px] text-chat-ink"
            >
              {revealed}
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/* ------------------------------ کانال‌ها و گروه‌ها ----------------------------- */

const EMPTY_SPACE_FORM = { kind: "channel" as SpaceKind, title: "", ownerId: "" };

function SpaceMembersDialog({ space, onClose }: { space: Space; onClose: () => void }) {
  const [data, setData] = useState<SpaceMembers | null>(null);
  const [candidate, setCandidate] = useState("");
  const [removing, setRemoving] = useState<SpaceMember | null>(null);
  const [transferring, setTransferring] = useState<SpaceMember | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await fetchSpaceMembers(space);
      setData(result);
      setCandidate((value) =>
        result.candidates.some((c) => String(c.userId) === value)
          ? value
          : String(result.candidates[0]?.userId ?? ""),
      );
    } catch (error) {
      toast.error(errorMessage(error, "بارگذاری اعضا ناموفق بود"));
    }
  }, [space]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!candidate) return;
    setBusy(true);
    if (
      await attempt(
        () => addSpaceMember(space, Number(candidate)),
        "عضو اضافه شد",
        "افزودن عضو ناموفق بود",
      )
    ) {
      await load();
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    if (
      await attempt(
        () => removeSpaceMember(space, removing.userId),
        "عضو از فضا حذف شد",
        "حذف عضو ناموفق بود",
      )
    ) {
      setRemoving(null);
      await load();
    }
    setBusy(false);
  };

  const changeRole = async (member: SpaceMember) => {
    const nextRole = member.role === "admin" ? "member" : "admin";
    setBusy(true);
    if (
      await attempt(
        () => setSpaceMemberRole(space, member.userId, nextRole),
        nextRole === "admin" ? `${member.name} مدیر فضا شد` : `${member.name} عضو عادی شد`,
        "تغییر نقش عضو ناموفق بود",
      )
    ) {
      await load();
    }
    setBusy(false);
  };

  const togglePermission = async (member: SpaceMember, key: string, value: boolean) => {
    setBusy(true);
    if (
      await attempt(
        () => setMemberPermissions(space, member.userId, { [key]: value }),
        "",
        "تغییر دسترسی ناموفق بود",
      )
    ) {
      await load();
    }
    setBusy(false);
  };

  const transfer = async () => {
    if (!transferring) return;
    setBusy(true);
    if (
      await attempt(
        () => transferSpaceOwner(space, transferring.userId),
        `مالکیت ${space.name} به ${transferring.name} واگذار شد`,
        "واگذاری مالکیت ناموفق بود",
      )
    ) {
      setTransferring(null);
      await load();
    }
    setBusy(false);
  };

  return (
    <PanelDialog
      open
      title={`مدیریت اعضای ${space.name}`}
      hint="افزودن یا حذف عضو، تغییر نقش و واگذاری مالکیت بلافاصله برای همان کاربر اعمال می‌شود."
      onClose={onClose}
    >
      <div className="grid gap-3">
        {data && !data.space.archived ? (
          <div className="flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <SelectField
                label="افزودن عضو"
                value={candidate}
                onChange={setCandidate}
                options={
                  data.candidates.length
                    ? data.candidates.map((c) => ({ value: String(c.userId), label: c.name }))
                    : [{ value: "", label: "کاربر دیگری برای افزودن نیست" }]
                }
              />
            </div>
            <Btn variant="solid" onClick={() => void add()} disabled={busy || !candidate}>
              <Plus className="size-4" />
              <T>افزودن</T>
            </Btn>
          </div>
        ) : null}
        <div className="grid max-h-80 grid-cols-[minmax(0,1fr)] gap-1.5 overflow-y-auto">
          {data?.members.map((m) => (
            <div
              key={m.userId}
              className="rounded-2xl border border-chat-panel-border bg-white/60 px-3 py-2"
            >
              <div className="flex items-center gap-3">
                <Avatar initials={m.initials} accent={m.accent} size={32} />
                <p className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-chat-ink">
                  {m.name}
                </p>
                <Pill accent={m.role === "owner" ? "violet" : m.role === "admin" ? "sky" : "ink"}>
                  {m.roleLabel}
                </Pill>
                {m.role === "owner" ? null : (
                  <>
                    <Btn
                      className="px-2.5 py-1.5 text-[11px]"
                      onClick={() => void changeRole(m)}
                      disabled={busy}
                    >
                      {m.role === "admin" ? "عضو عادی" : "مدیر فضا"}
                    </Btn>
                    {data?.space.archived ? null : (
                      <Btn
                        className="px-2.5 py-1.5 text-[11px]"
                        onClick={() => setTransferring(m)}
                        disabled={busy}
                      >
                        <T>مالک کن</T>
                      </Btn>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((current) => (current === m.userId ? null : m.userId))
                      }
                      className="size-8 rounded-full grid place-items-center text-chat-ink-soft hover:bg-white hover:text-chat-ink transition-colors"
                      aria-label={`دسترسی‌های ${m.name}`}
                      aria-expanded={expanded === m.userId}
                    >
                      <ChevronDown
                        className={cn(
                          "size-4 transition-transform",
                          expanded === m.userId && "rotate-180",
                        )}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoving(m)}
                      disabled={busy}
                      className="size-8 rounded-full grid place-items-center text-chat-ink-soft hover:bg-chat-rose/15 hover:text-chat-rose transition-colors"
                      aria-label={`حذف ${m.name}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </>
                )}
              </div>
              {m.role !== "owner" && expanded === m.userId ? (
                <div className="mt-2 grid gap-1.5 border-t border-chat-panel-border pt-2">
                  {PERMISSION_FIELDS[space.kind].map((field) => (
                    <div
                      key={field.key}
                      className="flex items-center justify-between gap-3 text-[11.5px] text-chat-ink"
                    >
                      <span>{field.label}</span>
                      <Toggle
                        on={Boolean(m.permissions[field.key])}
                        disabled={busy}
                        onChange={(v) => void togglePermission(m, field.key, v)}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {data && data.members.length === 0 ? (
            <EmptyNote>
              <T>این فضا عضوی ندارد.</T>
            </EmptyNote>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={removing !== null}
        title="حذف عضو"
        description={`${removing?.name ?? ""} از ${space.name} حذف می‌شود و این فضا از فهرست گفتگوهایش برداشته می‌شود.`}
        confirmLabel="حذف عضو"
        busy={busy}
        onConfirm={() => void remove()}
        onClose={() => setRemoving(null)}
      />
      <ConfirmDialog
        open={transferring !== null}
        title="واگذاری مالکیت"
        description={`${transferring?.name ?? ""} مالک ${space.name} می‌شود و مالک فعلی به مدیر فضا تغییر نقش می‌دهد.`}
        confirmLabel="واگذار کن"
        variant="solid"
        busy={busy}
        onConfirm={() => void transfer()}
        onClose={() => setTransferring(null)}
      />
    </PanelDialog>
  );
}

const VISIBILITY_HINTS: Record<Visibility, string> = {
  public: "هر کاربری می‌تواند این فضا را پیدا کند و بدون دعوت عضو شود.",
  private: "فقط کسانی که اضافه می‌شوند عضو این فضا هستند.",
};

function SpaceSettingsDialog({
  space,
  onClose,
  onDeleted,
}: {
  space: Space;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [details, setDetails] = useState<SpaceDetails | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    visibility: "public" as Visibility,
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [linkTarget, setLinkTarget] = useState("");
  const [confirmTitle, setConfirmTitle] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const label = space.kind === "channel" ? "کانال" : "گروه";
  const otherLabel = space.kind === "channel" ? "گروه" : "کانال";

  const apply = useCallback((next: SpaceDetails) => {
    setDetails(next);
    setForm({ title: next.title, description: next.description, visibility: next.visibility });
    setLinkTarget(String(next.linkOptions[0]?.id ?? ""));
  }, []);

  useEffect(() => {
    fetchSpaceDetails(space)
      .then(apply)
      .catch((error: unknown) =>
        toast.error(errorMessage(error, "بارگذاری تنظیمات فضا ناموفق بود")),
      );
  }, [space, apply]);

  const avatarPath = details?.avatarUrl ?? null;

  useEffect(() => {
    if (!avatarPath) {
      setPreview(null);
      return undefined;
    }
    let active = true;
    let objectUrl: string | null = null;
    fetchImageUrl(avatarPath)
      .then((url) => {
        objectUrl = url;
        if (active) setPreview(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => {
        if (active) setPreview(null);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [avatarPath]);

  const run = async (action: () => Promise<unknown>, success: string, failure: string) => {
    setBusy(true);
    const ok = await attempt(action, success, failure);
    setBusy(false);
    return ok;
  };

  const refresh = async () => apply(await fetchSpaceDetails(space));

  const saveInfo = () =>
    run(
      async () =>
        apply(
          await updateSpaceInfo(space, {
            title: form.title.trim(),
            description: form.description.trim(),
            visibility: form.visibility,
          }),
        ),
      "اطلاعات فضا ذخیره شد",
      "ذخیره اطلاعات ناموفق بود",
    );

  const chooseAvatar = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    await run(
      async () => {
        await uploadSpaceAvatar(space, file);
        await refresh();
      },
      "عکس فضا به‌روزرسانی شد",
      "بارگذاری عکس ناموفق بود",
    );
  };

  const dropAvatar = () =>
    run(
      async () => {
        await removeSpaceAvatar(space);
        await refresh();
      },
      "عکس فضا حذف شد",
      "حذف عکس ناموفق بود",
    );

  const createLink = () =>
    run(
      async () => apply(await linkSpace(space, Number(linkTarget))),
      space.kind === "channel"
        ? "پیوند برقرار شد؛ پست‌های کانال در گروه بازنشر می‌شود"
        : "پیوند برقرار شد؛ پست‌های کانال در این گروه بازنشر می‌شود",
      "ایجاد پیوند ناموفق بود",
    );

  const removeLink = async () => {
    if (
      await run(async () => apply(await unlinkSpace(space)), "پیوند قطع شد", "قطع پیوند ناموفق بود")
    ) {
      setUnlinking(false);
    }
  };

  const removeSpace = async () => {
    if (
      await run(
        () => deleteSpace(space, confirmTitle.trim()),
        `${label} برای همیشه حذف شد`,
        "حذف فضا ناموفق بود",
      )
    ) {
      setDeleting(false);
      onDeleted();
    }
  };

  return (
    <PanelDialog
      open
      wide
      title={`تنظیمات ${space.name}`}
      hint={`اطلاعات و عکس، پیوند به ${otherLabel} و حذف دائمی ${label}.`}
      onClose={onClose}
    >
      {details ? (
        <div className="grid max-h-[70vh] gap-4 overflow-y-auto">
          <section className="grid gap-3 rounded-2xl border border-chat-panel-border bg-white/60 p-4">
            <p className="font-display text-[13px] font-semibold text-chat-ink">اطلاعات {label}</p>
            {details.archived ? (
              <p className="text-[11.5px] text-chat-ink-soft">
                <T>
                  این فضا آرشیو شده است؛ برای ویرایش اطلاعات و پیوند، ابتدا آن را بازگردانی کنید.
                </T>
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  {preview ? (
                    <img src={preview} alt="" className="size-14 rounded-2xl object-cover" />
                  ) : (
                    <span
                      className={cn(
                        "size-14 rounded-2xl grid place-items-center",
                        space.kind === "channel" ? iconWrap.sky : iconWrap.violet,
                      )}
                    >
                      {space.kind === "channel" ? (
                        <Hash className="size-5" />
                      ) : (
                        <Users className="size-5" />
                      )}
                    </span>
                  )}
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(event) => void chooseAvatar(event.target.files?.[0])}
                  />
                  <Btn onClick={() => fileInput.current?.click()} disabled={busy}>
                    <ImagePlus className="size-4" />
                    <T>انتخاب عکس</T>
                  </Btn>
                  {details.avatarUrl ? (
                    <Btn variant="danger" onClick={() => void dropAvatar()} disabled={busy}>
                      <T>حذف عکس</T>
                    </Btn>
                  ) : null}
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field
                    label="نام"
                    value={form.title}
                    onChange={(v) => setForm((f) => ({ ...f, title: v }))}
                  />
                  <SelectField
                    label="نوع دسترسی"
                    value={form.visibility}
                    onChange={(v) => setForm((f) => ({ ...f, visibility: v as Visibility }))}
                    options={VISIBILITY_OPTIONS}
                  />
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-[11.5px] font-bold text-chat-ink-soft">
                    <T>توضیحات</T>
                  </span>
                  <textarea
                    rows={3}
                    value={form.description}
                    onChange={(event) =>
                      setForm((f) => ({ ...f, description: event.target.value }))
                    }
                    className="w-full resize-none rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-[13px] text-chat-ink placeholder:text-chat-ink-soft outline-none transition-colors focus:border-chat-sky/30 focus:bg-white"
                  />
                </label>
                <p className="text-[11px] text-chat-ink-soft">
                  {VISIBILITY_HINTS[form.visibility]}
                </p>
                <Btn variant="solid" onClick={() => void saveInfo()} disabled={busy}>
                  <CheckCheck className="size-4" />
                  <T>ذخیره تغییرات</T>
                </Btn>
              </>
            )}
          </section>

          {details.archived ? null : (
            <section className="grid gap-3 rounded-2xl border border-chat-panel-border bg-white/60 p-4">
              <p className="font-display text-[13px] font-semibold text-chat-ink">
                پیوند به {otherLabel}
              </p>
              <p className="text-[11.5px] text-chat-ink-soft">
                {space.kind === "channel"
                  ? "پست‌های این کانال به‌طور خودکار در گروه پیوندشده بازنشر می‌شود."
                  : "پست‌های کانال پیوندشده به‌طور خودکار در این گروه بازنشر می‌شود."}
              </p>
              {details.link ? (
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-chat-mint/25 bg-chat-mint/12 px-3.5 py-2.5">
                  <span className="flex min-w-0 items-center gap-2 truncate text-[12.5px] font-bold text-chat-ink">
                    <Link2 className="size-4 shrink-0" />
                    {space.kind === "group" ? `#${details.link.title}` : details.link.title}
                  </span>
                  <Btn variant="danger" onClick={() => setUnlinking(true)} disabled={busy}>
                    <Link2Off className="size-4" />
                    <T>قطع پیوند</T>
                  </Btn>
                </div>
              ) : details.linkOptions.length ? (
                <div className="flex items-end gap-2">
                  <div className="flex-1 min-w-0">
                    <SelectField
                      label={`${otherLabel} مقصد`}
                      value={linkTarget}
                      onChange={setLinkTarget}
                      options={details.linkOptions.map((option) => ({
                        value: String(option.id),
                        label: option.title,
                      }))}
                    />
                  </div>
                  <Btn
                    variant="solid"
                    onClick={() => void createLink()}
                    disabled={busy || !linkTarget}
                  >
                    <Link2 className="size-4" />
                    <T>ایجاد پیوند</T>
                  </Btn>
                </div>
              ) : (
                <EmptyNote>{`${otherLabel} بدون پیوندی برای اتصال وجود ندارد.`}</EmptyNote>
              )}
            </section>
          )}

          <section className="grid gap-3 rounded-2xl border border-chat-rose/25 bg-chat-rose/10 p-4">
            <p className="font-display text-[13px] font-semibold text-chat-rose">
              حذف دائمی {label}
            </p>
            <p className="text-[11.5px] leading-relaxed text-chat-ink-soft">
              <T>
                همه پیام‌ها، فایل‌ها (از سرور و بکاپ فایل‌ها)، اعضا، پیوند و یادآوری‌های این فضا
                برای همیشه پاک می‌شود. اگر فقط می‌خواهید فضا از دسترس خارج شود، آرشیو را انتخاب
                کنید.
              </T>
            </p>
            <Btn variant="danger" onClick={() => setDeleting(true)} disabled={busy}>
              <Trash2 className="size-4" />
              <T>حذف دائمی</T>
            </Btn>
          </section>
        </div>
      ) : (
        <EmptyNote>
          <T>در حال بارگذاری تنظیمات فضا...</T>
        </EmptyNote>
      )}
      <ConfirmDialog
        open={unlinking}
        title="قطع پیوند"
        description={`بازنشر خودکار بین ${space.name} و ${details?.link?.title ?? ""} متوقف می‌شود. پیام‌های قبلی باقی می‌مانند.`}
        confirmLabel="قطع پیوند"
        busy={busy}
        onConfirm={() => void removeLink()}
        onClose={() => setUnlinking(false)}
      />
      <ConfirmDialog
        open={deleting}
        title={`حذف دائمی ${label}`}
        description={`این کار قابل بازگشت نیست. برای تأیید، نام «${space.name}» را دقیقاً بنویسید.`}
        confirmLabel="حذف برای همیشه"
        busy={busy}
        onConfirm={() => void removeSpace()}
        onClose={() => {
          setDeleting(false);
          setConfirmTitle("");
        }}
      >
        <Field
          label={`نام ${label}`}
          placeholder={space.name}
          value={confirmTitle}
          onChange={setConfirmTitle}
        />
      </ConfirmDialog>
    </PanelDialog>
  );
}

export function EntitiesSection() {
  const { t, digits } = useI18n();
  const [kind, setKind] = useState<"all" | SpaceKind>("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_SPACE_FORM);
  const [owners, setOwners] = useState<AdminUser[]>([]);
  const [archiving, setArchiving] = useState<Space | null>(null);
  const [managing, setManaging] = useState<Space | null>(null);
  const [configuring, setConfiguring] = useState<Space | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSpaces = useCallback(() => fetchSpaces(kind), [kind]);
  const { data, reload } = useAdminResource(loadSpaces, AUDIT_EVENTS);
  const search = useDebounced(query).trim().toLowerCase();
  const list = (data ?? []).filter(
    (space) =>
      !search ||
      space.name.toLowerCase().includes(search) ||
      space.owner.toLowerCase().includes(search),
  );

  const startCreating = useCallback(() => setCreating(true), []);
  useCreateIntent(startCreating);

  useEffect(() => {
    if (!creating) return undefined;
    let active = true;
    fetchUsers("", "all")
      .then((result) => {
        if (active)
          setOwners(result.users.filter((user) => user.isActive && user.role !== "super_admin"));
      })
      .catch(() => toast.error("بارگذاری فهرست کاربران ناموفق بود"));
    return () => {
      active = false;
    };
  }, [creating]);

  const ownerValue = form.ownerId || String(owners[0]?.id ?? "");

  const submitSpace = async () => {
    if (!form.title.trim()) {
      toast.error("نام فضا را وارد کنید");
      return;
    }
    setBusy(true);
    const ok = await attempt(
      () => createSpace({ kind: form.kind, title: form.title.trim(), ownerId: Number(ownerValue) }),
      form.kind === "channel" ? "کانال ساخته شد" : "گروه ساخته شد",
      "ساخت فضا ناموفق بود",
    );
    setBusy(false);
    if (ok) {
      setCreating(false);
      setForm(EMPTY_SPACE_FORM);
      await reload();
    }
  };

  const toggleArchive = async () => {
    if (!archiving) return;
    setBusy(true);
    const ok = await attempt(
      () => setSpaceArchived(archiving, !archiving.archived),
      archiving.archived ? "فضا بازگردانی شد" : "فضا آرشیو شد و از فهرست اعضا برداشته شد",
      "تغییر وضعیت آرشیو ناموفق بود",
    );
    setBusy(false);
    if (ok) {
      setArchiving(null);
      await reload();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelHead
          title="کانال‌ها و گروه‌ها"
          hint="ساخت، ویرایش، پیوند، واگذاری مالکیت، مدیریت اعضا و دسترسی‌ها، آرشیو و حذف فضاهای گفتگو."
          action={
            <Btn variant="solid" onClick={() => setCreating((v) => !v)}>
              <Plus className="size-4" />
              <T>فضای جدید</T>
            </Btn>
          }
        />
        {creating ? (
          <div className="mx-5 mb-4 shrink-0 rounded-2xl border border-chat-mint/25 bg-chat-mint/10 p-4">
            <p className="mb-3 font-display text-[13px] font-semibold text-chat-mint-deep">
              <T>ساخت فضای جدید</T>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="نام فضا"
                placeholder="مثلاً هماهنگی محصول"
                value={form.title}
                onChange={(v) => setForm((f) => ({ ...f, title: v }))}
              />
              <SelectField
                label="نوع"
                value={form.kind}
                onChange={(v) => setForm((f) => ({ ...f, kind: v as SpaceKind }))}
                options={[
                  { value: "channel", label: "کانال" },
                  { value: "group", label: "گروه" },
                ]}
              />
              <SelectField
                label="مالک"
                value={ownerValue}
                onChange={(v) => setForm((f) => ({ ...f, ownerId: v }))}
                options={
                  owners.length
                    ? owners.map((u) => ({ value: String(u.id), label: u.fullName }))
                    : [{ value: "", label: "کاربر فعالی یافت نشد" }]
                }
              />
              <div className="flex items-end gap-2">
                <Btn
                  variant="solid"
                  className="flex-1"
                  onClick={() => void submitSpace()}
                  disabled={busy || !ownerValue}
                >
                  <T>ثبت فضا</T>
                </Btn>
                <Btn onClick={() => setCreating(false)}>
                  <T>انصراف</T>
                </Btn>
              </div>
            </div>
          </div>
        ) : null}
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pb-4">
          <div className="flex min-w-[180px] flex-1 items-center gap-2 rounded-full border border-chat-panel-border bg-white/60 px-3.5 py-2 text-[12.5px]">
            <Search className="size-4 text-chat-ink-soft" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("جستجوی نام کانال، گروه یا مالک...")}
              className="w-full bg-transparent text-chat-ink outline-none placeholder:text-chat-ink-soft"
            />
          </div>
          <Segmented
            value={kind}
            onChange={setKind}
            items={[
              { value: "all", label: "همه" },
              { value: "channel", label: "کانال‌ها" },
              { value: "group", label: "گروه‌ها" },
            ]}
          />
        </div>
        <div className="custom-scrollbar grid min-h-0 flex-1 content-start gap-2 overflow-y-auto bg-chat-sky/[0.06] px-4 py-3">
          {list.map((e) => (
            <div
              key={`${e.kind}-${e.id}`}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-chat-panel-border bg-white/75 px-4 py-2.5 transition-colors hover:bg-white"
            >
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-2xl",
                  e.kind === "channel" ? iconWrap.sky : iconWrap.violet,
                )}
              >
                {e.kind === "channel" ? <Hash className="size-4" /> : <Users className="size-4" />}
              </span>
              <div className="min-w-[160px] flex-1">
                <p className="truncate text-[13px] font-bold text-chat-ink">{e.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-chat-ink-soft">
                  {t("مالک: {name}", { name: e.owner })}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Pill accent="mint">{t("{count} عضو", { count: digits(e.members) })}</Pill>
                <Pill accent="lemon">{t("{count} پیام", { count: digits(e.messages) })}</Pill>
                {e.archived ? (
                  <Pill accent="rose">
                    <T>آرشیو</T>
                  </Pill>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Btn onClick={() => setManaging(e)}>
                  <T>اعضا</T>
                </Btn>
                <Btn onClick={() => setConfiguring(e)} label={`تنظیمات ${e.name}`}>
                  <Settings2 className="size-4" />
                </Btn>
                <Btn variant={e.archived ? "soft" : "danger"} onClick={() => setArchiving(e)}>
                  {e.archived ? "بازگردانی" : "آرشیو"}
                </Btn>
              </div>
            </div>
          ))}
          {data && list.length === 0 ? (
            <EmptyNote>
              {search ? (
                <T>فضایی با این جستجو پیدا نشد.</T>
              ) : (
                <T>هنوز کانال یا گروهی ساخته نشده است.</T>
              )}
            </EmptyNote>
          ) : null}
        </div>
      </Panel>

      <ConfirmDialog
        open={archiving !== null}
        title={archiving?.archived ? "بازگردانی فضا" : "آرشیو فضا"}
        description={
          archiving?.archived
            ? `${archiving.name} دوباره در فهرست گفتگوهای اعضایش نمایش داده می‌شود.`
            : `${archiving?.name ?? ""} از فهرست گفتگوهای همه اعضا برداشته می‌شود و پیام جدیدی نمی‌پذیرد. تاریخچه آن حذف نمی‌شود.`
        }
        confirmLabel={archiving?.archived ? "بازگردانی" : "آرشیو کن"}
        variant={archiving?.archived ? "solid" : "danger"}
        busy={busy}
        onConfirm={() => void toggleArchive()}
        onClose={() => setArchiving(null)}
      />

      {configuring ? (
        <SpaceSettingsDialog
          key={`${configuring.kind}-${configuring.id}`}
          space={configuring}
          onClose={() => {
            setConfiguring(null);
            void reload();
          }}
          onDeleted={() => {
            setConfiguring(null);
            void reload();
          }}
        />
      ) : null}

      {managing ? (
        <SpaceMembersDialog
          key={`${managing.kind}-${managing.id}`}
          space={managing}
          onClose={() => {
            setManaging(null);
            void reload();
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------ تگ‌ها ----------------------------------- */

export function TagsSection() {
  const { data, reload } = useAdminResource(fetchTags, AUDIT_EVENTS);
  const [name, setName] = useState("");
  const [removing, setRemoving] = useState<Tag | null>(null);
  const [busy, setBusy] = useState(false);
  const tags = data ?? [];

  const addTag = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const ok = await attempt(() => createTag(name.trim()), "تگ ساخته شد", "ساخت تگ ناموفق بود");
    setBusy(false);
    if (ok) {
      setName("");
      await reload();
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setBusy(true);
    const ok = await attempt(() => deleteTag(removing.id), "تگ حذف شد", "حذف تگ ناموفق بود");
    setBusy(false);
    if (ok) {
      setRemoving(null);
      await reload();
    }
  };

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Panel className="flex min-h-0 flex-col overflow-hidden">
        <PanelHead title="تگ‌های سازمانی" hint="گروه‌بندی کاربران بر اساس واحد یا تخصص." />
        <div className="custom-scrollbar grid min-h-0 flex-1 content-start gap-3 overflow-y-auto bg-chat-sky/[0.06] px-4 py-3 sm:grid-cols-2">
          {tags.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-2xl border border-chat-panel-border bg-white/75 px-4 py-3"
            >
              <div>
                <p className="text-[13px] font-bold text-chat-ink">{t.name}</p>
                <p className="text-[11px] text-chat-ink-soft mt-0.5">{fa(t.members)} کاربر</p>
              </div>
              <button
                type="button"
                onClick={() => setRemoving(t)}
                className="size-8 rounded-full grid place-items-center text-chat-ink-soft hover:bg-chat-rose/15 hover:text-chat-rose transition-colors"
                aria-label={`حذف ${t.name}`}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          {data && tags.length === 0 ? (
            <div className="sm:col-span-2">
              <EmptyNote>
                <T>هنوز تگی تعریف نشده است.</T>
              </EmptyNote>
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel className="h-fit p-5">
        <h3 className="font-display text-[15px] font-semibold text-chat-ink">
          <T>تگ جدید</T>
        </h3>
        <p className="text-[11.5px] text-chat-ink-soft mt-1 leading-relaxed">
          <T>نام تگ در پروفایل کاربران و فیلترهای دفترچه تلفن نمایش داده می‌شود.</T>
        </p>
        <div className="mt-4 grid gap-3">
          <Field label="نام تگ" placeholder="مثلاً منابع انسانی" value={name} onChange={setName} />
          <Btn variant="solid" onClick={() => void addTag()} disabled={busy}>
            <T>افزودن تگ</T>
          </Btn>
        </div>
      </Panel>

      <ConfirmDialog
        open={removing !== null}
        title="حذف تگ"
        description={
          removing
            ? `تگ «${removing.name}» حذف و از پروفایل ${fa(removing.members)} کاربر برداشته می‌شود.`
            : ""
        }
        confirmLabel="حذف تگ"
        busy={busy}
        onConfirm={() => void confirmRemove()}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}

/* -------------------------------- تنظیمات سیستم ------------------------------- */

const POLICIES: { key: PolicyFlag; label: string; hint: string }[] = [
  { key: "readReceiptsEnabled", label: "نمایش تیک خوانده‌شدن", hint: "برای همه گفتگوهای سازمانی." },
  {
    key: "fileScanEnabled",
    label: "اسکن فایل‌های ارسالی",
    hint: "بررسی بدافزار پیش از ذخیره‌سازی.",
  },
];

const LANGUAGE_OPTIONS: { value: "fa" | "en"; label: string; hint: string }[] = [
  { value: "fa", label: "فارسی", hint: "چیدمان راست‌به‌چپ و تقویم شمسی" },
  { value: "en", label: "English", hint: "Left-to-right layout, Gregorian calendar" },
];

export function SettingsSection() {
  const { setLanguage } = useI18n();
  const { data, reload } = useAdminResource(fetchSettings, SETTINGS_EVENTS);
  const [synced, setSynced] = useState<Settings | null>(null);
  const [fileSize, setFileSize] = useState("");
  const [cooldown, setCooldown] = useState("");
  const [busy, setBusy] = useState(false);

  if (data && data !== synced) {
    setSynced(data);
    setFileSize(data.maxFileSizeMb === null ? "" : String(data.maxFileSizeMb));
    setCooldown(String(data.messageCooldownSeconds));
  }

  const saveLimits = async () => {
    const size = latinDigits(fileSize);
    const seconds = latinDigits(cooldown);
    if (size && !(Number(size) > 0)) {
      toast.error("سقف حجم فایل باید عددی بزرگ‌تر از صفر باشد");
      return;
    }
    if (!/^\d+$/.test(seconds)) {
      toast.error("فاصله بین پیام‌ها باید عددی صحیح باشد");
      return;
    }
    setBusy(true);
    const ok = await attempt(
      () =>
        saveSettings({
          maxFileSizeMb: size ? Number(size) : null,
          messageCooldownSeconds: Number(seconds),
        }),
      "تنظیمات ذخیره شد",
      "ذخیره تنظیمات ناموفق بود",
    );
    setBusy(false);
    if (ok) await reload();
  };

  const toggleFlag = async (key: PolicyFlag, value: boolean) => {
    const patch: Partial<Settings> = {};
    patch[key] = value;
    setBusy(true);
    await attempt(() => saveSettings(patch), "", "تغییر سیاست ناموفق بود");
    setBusy(false);
    await reload();
  };

  const changeLanguage = async (next: "fa" | "en") => {
    if (!data || data.language === next) return;
    setBusy(true);
    const ok = await attempt(
      () => saveSettings({ language: next }),
      next === "fa" ? "زبان سامانه روی فارسی تنظیم شد" : "System language set to English",
      "تغییر زبان ناموفق بود",
    );
    setBusy(false);
    if (ok) {
      setLanguage(next);
      await reload();
    }
  };

  return (
    <div className="custom-scrollbar grid h-full min-h-0 content-start gap-4 overflow-y-auto lg:grid-cols-2">
      <Panel className="p-5 lg:col-span-2">
        <h3 className="font-display text-[15px] font-semibold text-chat-ink">
          <T>زبان سامانه</T>
        </h3>
        <p className="text-[11.5px] text-chat-ink-soft mt-1">
          <T>
            زبان انتخاب‌شده برای همهٔ کاربران سامانه اعمال می‌شود؛ چیدمان صفحه نیز با آن هماهنگ
            می‌شود.
          </T>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {LANGUAGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={busy || !data}
              onClick={() => void changeLanguage(option.value)}
              className={cn(
                "rounded-2xl border px-4 py-2.5 text-start transition-colors disabled:opacity-50",
                data?.language === option.value
                  ? "border-chat-violet/40 bg-chat-violet/10"
                  : "border-chat-panel-border bg-white/60 hover:bg-white",
              )}
            >
              <span className="block text-[12.5px] font-bold text-chat-ink">{option.label}</span>
              <span className="mt-0.5 block text-[10.5px] text-chat-ink-soft">{option.hint}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel className="p-5">
        <h3 className="font-display text-[15px] font-semibold text-chat-ink">
          <T>محدودیت‌ها</T>
        </h3>
        <p className="text-[11.5px] text-chat-ink-soft mt-1">
          <T>سقف حجم فایل و فاصله ضدهرزنامه بین پیام‌ها.</T>
        </p>
        <div className="mt-4 grid gap-3">
          <Field
            label="سقف حجم فایل (مگابایت)"
            placeholder="نامحدود"
            value={fileSize}
            onChange={setFileSize}
            dir="ltr"
          />
          <Field
            label="فاصله بین پیام‌ها (ثانیه)"
            value={cooldown}
            onChange={setCooldown}
            dir="ltr"
          />
          <Btn variant="solid" onClick={() => void saveLimits()} disabled={busy || !data}>
            <CheckCheck className="size-4" />
            <T>ذخیره تغییرات</T>
          </Btn>
        </div>
      </Panel>

      <Panel className="p-5">
        <h3 className="font-display text-[15px] font-semibold text-chat-ink">
          <T>سیاست‌های سامانه</T>
        </h3>
        <div className="mt-4 grid gap-2.5">
          {POLICIES.map((f) => (
            <div
              key={f.key}
              className="flex items-center justify-between gap-3 rounded-2xl border border-chat-panel-border bg-white/60 px-4 py-3"
            >
              <div>
                <p className="text-[12.5px] font-bold text-chat-ink">{f.label}</p>
                <p className="text-[11px] text-chat-ink-soft mt-0.5">{f.hint}</p>
              </div>
              <Toggle
                on={data?.[f.key] ?? false}
                disabled={busy || !data}
                onChange={(v) => void toggleFlag(f.key, v)}
              />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ---------------------------------- نظارت ----------------------------------- */

type MonitoredTarget = Space | MonitoredConversation;

const TRANSCRIPT_LABELS: Record<TranscriptKind, string> = {
  channel: "کانال",
  group: "گروه",
  conversation: "گفتگو",
};

function targetLabel(target: MonitoredTarget) {
  if (target.kind !== "conversation") return TRANSCRIPT_LABELS[target.kind];
  if (!target.direct) return "کانال اطلاع‌رسانی";
  return target.ticket ? "گفتگوی خصوصی با مدیریت" : "گفتگوی خصوصی";
}

function AttachmentPill({ name, fileId }: { name: string; fileId: number | null }) {
  if (!fileId) return <Pill accent="sky">{name}</Pill>;
  const download = () =>
    downloadFile(monitoredFilePath(fileId), name).catch((error: unknown) =>
      toast.error(errorMessage(error, "دانلود فایل ناموفق بود")),
    );
  return (
    <button type="button" onClick={() => void download()} aria-label={`دانلود ${name}`}>
      <Pill accent="sky">
        <Download className="size-3" />
        {name}
      </Pill>
    </button>
  );
}

const FILE_SCOPES: { value: FileScope | "all"; label: string }[] = [
  { value: "all", label: "همه" },
  { value: "conversation", label: "گفتگوها" },
  { value: "channel", label: "کانال‌ها" },
  { value: "group", label: "گروه‌ها" },
  { value: "reminder", label: "بات" },
];

function SystemFilesPanel() {
  const [scope, setScope] = useState<FileScope | "all">("all");
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<SystemFile | null>(null);
  const [busy, setBusy] = useState(false);
  const search = useDebounced(query);
  const loadFiles = useCallback(() => fetchSystemFiles(scope, search), [scope, search]);
  const { data, reload } = useAdminResource(loadFiles, AUDIT_EVENTS);
  const files = data ?? [];

  const download = (file: SystemFile) =>
    downloadFile(monitoredFilePath(file.id), file.name).catch((error: unknown) =>
      toast.error(errorMessage(error, "دانلود فایل ناموفق بود")),
    );

  const confirmRemove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      const result = await deleteSystemFile(removing.id);
      toast.success(
        !result.backupMirrorConfigured
          ? "فایل از سرور و پایگاه‌داده حذف شد؛ مسیر بکاپ فایل‌ها تنظیم نشده است"
          : result.backupCopyRemoved
            ? "فایل از سرور، پایگاه‌داده و بکاپ فایل‌ها حذف شد"
            : "فایل از سرور و پایگاه‌داده حذف شد؛ نسخه‌ای در بکاپ فایل‌ها پیدا نشد",
      );
      setRemoving(null);
      await reload();
    } catch (error) {
      toast.error(errorMessage(error, "حذف فایل ناموفق بود"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden">
      <PanelHead
        title="فایل‌های سیستم"
        hint="همه فایل‌های ارسالی در گفتگوها، کانال‌ها، گروه‌ها و یادآوری‌ها؛ با دانلود و حذف کامل."
        action={
          <Pill accent="rose">
            <T>حساس</T>
          </Pill>
        }
      />
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pb-4">
        <div className="flex min-w-[160px] flex-1 items-center gap-2 rounded-full border border-chat-panel-border bg-white/60 px-3.5 py-2 text-[12.5px]">
          <Search className="size-4 text-chat-ink-soft" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={translate("جستجوی نام فایل، فرستنده یا فضا...")}
            className="w-full bg-transparent text-chat-ink outline-none placeholder:text-chat-ink-soft"
          />
        </div>
        <Segmented value={scope} onChange={setScope} items={FILE_SCOPES} />
      </div>
      <div className="custom-scrollbar grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-2.5 overflow-y-auto px-5 pb-5">
        {files.map((f) => (
          <div
            key={f.id}
            className="flex items-center gap-3 rounded-2xl border border-chat-panel-border bg-white/60 px-4 py-3"
          >
            <span
              className={cn("size-9 shrink-0 rounded-2xl grid place-items-center", iconWrap.sky)}
            >
              <FileText className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-bold text-chat-ink truncate">{f.name}</p>
              <p className="text-[11px] text-chat-ink-soft mt-0.5 truncate">
                {f.sender} · {f.place}
              </p>
              <p className="text-[10.5px] text-chat-ink-soft/70 mt-0.5">
                {f.size} · {f.at}
                {f.messageDeleted ? " · پیام حذف‌شده" : ""}
              </p>
            </div>
            <Btn onClick={() => void download(f)} label={`دانلود ${f.name}`}>
              <Download className="size-4" />
            </Btn>
            <Btn variant="danger" onClick={() => setRemoving(f)} label={`حذف ${f.name}`}>
              <Trash2 className="size-4" />
            </Btn>
          </div>
        ))}
        {data && files.length === 0 ? (
          <EmptyNote>
            <T>فایلی با این فیلتر پیدا نشد.</T>
          </EmptyNote>
        ) : null}
      </div>
      <ConfirmDialog
        open={removing !== null}
        title="حذف کامل فایل"
        description={`«${removing?.name ?? ""}» از سرور، پایگاه‌داده و بکاپ فایل‌ها پاک می‌شود و پیام آن برای همه حذف می‌شود. این کار قابل بازگشت نیست.`}
        confirmLabel="حذف برای همیشه"
        busy={busy}
        onConfirm={() => void confirmRemove()}
        onClose={() => setRemoving(null)}
      />
    </Panel>
  );
}

const QUEUE_STATS = [
  { key: "pending", label: "در انتظار پردازش" },
  { key: "processing", label: "در حال پردازش" },
  { key: "delayed", label: "در انتظار تلاش دوباره" },
  { key: "dead", label: "ناموفق نهایی" },
] as const;

const QUEUE_REFRESH_MS = 5000;

function ForwardQueuePanel() {
  const { data, reload } = useAdminResource(fetchForwardQueue, AUDIT_EVENTS);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => void reload(), QUEUE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  const act = async (action: () => Promise<unknown>, success: string, failure: string) => {
    setBusy(true);
    await attempt(action, success, failure);
    setBusy(false);
    await reload();
  };

  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden">
      <PanelHead
        title="صف انتقال کانال به گروه"
        hint="پست‌های کانال ابتدا وارد این صف می‌شوند و سپس در گروه پیوندشده بازنشر می‌شوند."
        action={
          data && !data.available ? (
            <Pill accent="rose">
              <T>صف در دسترس نیست</T>
            </Pill>
          ) : (
            <Pill accent="mint">
              <T>زنده</T>
            </Pill>
          )
        }
      />
      <div className="grid shrink-0 grid-cols-2 gap-2.5 px-5 pb-4">
        {QUEUE_STATS.map((stat) => (
          <div
            key={stat.key}
            className="rounded-2xl border border-chat-panel-border bg-white/60 px-4 py-3"
          >
            <p
              className={cn(
                "font-display text-xl font-semibold",
                stat.key === "dead" && (data?.depths.dead ?? 0) > 0
                  ? "text-chat-rose"
                  : "text-chat-ink",
              )}
            >
              {data ? fa(data.depths[stat.key]) : "—"}
            </p>
            <p className="text-[11px] text-chat-ink-soft mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>
      <div className="custom-scrollbar grid min-h-0 flex-1 content-start gap-2.5 overflow-y-auto px-5 pb-5">
        <p className="text-[11.5px] font-bold text-chat-ink-soft">
          <T>پیام‌های ناموفق</T>
        </p>
        {(data?.deadLetters ?? []).map((d) => (
          <div
            key={d.id}
            className="rounded-2xl border border-chat-rose/25 bg-chat-rose/10 px-4 py-3"
          >
            <p className="text-[12.5px] font-bold text-chat-ink truncate">
              کانال #{d.channel} به گروه {d.group}
            </p>
            <p className="text-[11px] text-chat-ink-soft mt-0.5 truncate" dir="auto">
              {d.error}
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10.5px] text-chat-ink-soft/70">
                {fa(d.attempts)} تلاش · {d.at}
              </span>
              <div className="flex gap-2">
                <Btn
                  variant="soft"
                  onClick={() =>
                    void act(
                      () => retryForward(d.id),
                      "پیام دوباره به صف انتقال برگشت",
                      "ارسال دوباره ناموفق بود",
                    )
                  }
                  disabled={busy}
                >
                  <RefreshCw className="size-4" />
                  <T>تلاش دوباره</T>
                </Btn>
                <Btn
                  onClick={() =>
                    void act(
                      () => discardForward(d.id),
                      "پیام ناموفق کنار گذاشته شد",
                      "کنار گذاشتن پیام ناموفق بود",
                    )
                  }
                  disabled={busy}
                >
                  <T>کنار بگذار</T>
                </Btn>
              </div>
            </div>
          </div>
        ))}
        {data && data.deadLetters.length === 0 ? (
          <EmptyNote>
            <T>پیام ناموفقی در صف نیست.</T>
          </EmptyNote>
        ) : null}
      </div>
    </Panel>
  );
}

export function OversightSection() {
  const { t, digits } = useI18n();
  const { data: sessions } = useAdminResource(fetchSessions, SESSION_EVENTS);
  const { data: spaces } = useAdminResource(activeSpaces, AUDIT_EVENTS);
  const { data: conversations } = useAdminResource(fetchConversations, AUDIT_EVENTS);
  const [scope, setScope] = useState<TranscriptKind | "all">("all");
  const [sessionQuery, setSessionQuery] = useState("");
  const [targetQuery, setTargetQuery] = useState("");
  const [ending, setEnding] = useState<ActiveSession | null>(null);
  const [pendingView, setPendingView] = useState<MonitoredTarget | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [busy, setBusy] = useState(false);

  const endSession = async () => {
    if (!ending) return;
    setBusy(true);
    const ok = await attempt(
      () => revokeSession(ending.id),
      "نشست پایان یافت",
      "پایان دادن به نشست ناموفق بود",
    );
    setBusy(false);
    if (ok) setEnding(null);
  };

  const sessionTerm = sessionQuery.trim().toLowerCase();
  const visibleSessions = (sessions ?? []).filter(
    (item) =>
      !sessionTerm ||
      item.user.toLowerCase().includes(sessionTerm) ||
      item.device.toLowerCase().includes(sessionTerm) ||
      item.ip.toLowerCase().includes(sessionTerm),
  );

  const targetTerm = targetQuery.trim().toLowerCase();
  const targets: MonitoredTarget[] = [...(spaces ?? []), ...(conversations ?? [])].filter(
    (target) =>
      (scope === "all" || target.kind === scope) &&
      (!targetTerm || target.name.toLowerCase().includes(targetTerm)),
  );

  const openTranscript = async () => {
    if (!pendingView) return;
    setBusy(true);
    try {
      setTranscript(await fetchTranscript(pendingView));
      setPendingView(null);
    } catch (error) {
      toast.error(errorMessage(error, "بارگذاری گفتگو ناموفق بود"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full min-h-0 grid-rows-2 gap-4 lg:grid-cols-2">
      <Panel className="flex min-h-0 flex-col overflow-hidden">
        <PanelHead title="نشست‌های فعال" hint="دستگاه، نشانی شبکه و زمان ورود کاربران آنلاین." />
        <div className="shrink-0 px-5 pb-4">
          <div className="flex items-center gap-2 rounded-full border border-chat-panel-border bg-white/60 px-3.5 py-2 text-[12.5px]">
            <Search className="size-4 text-chat-ink-soft" />
            <input
              value={sessionQuery}
              onChange={(event) => setSessionQuery(event.target.value)}
              placeholder={t("جستجوی کاربر، دستگاه یا نشانی شبکه...")}
              className="w-full bg-transparent text-chat-ink outline-none placeholder:text-chat-ink-soft"
            />
          </div>
        </div>
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {visibleSessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-white/60"
            >
              <span className="size-2 rounded-full bg-chat-mint" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-bold text-chat-ink">{s.user}</p>
                <p className="truncate text-[11px] text-chat-ink-soft">
                  {s.device} · {s.since}
                </p>
              </div>
              <span className="text-[11px] text-chat-ink-soft" dir="ltr">
                {s.ip}
              </span>
              {s.current ? (
                <Pill accent="mint">
                  <T>نشست فعلی</T>
                </Pill>
              ) : (
                <Btn variant="danger" onClick={() => setEnding(s)}>
                  <T>پایان نشست</T>
                </Btn>
              )}
            </div>
          ))}
          {sessions && visibleSessions.length === 0 ? (
            <EmptyNote>
              {sessionTerm ? <T>نشستی با این جستجو پیدا نشد.</T> : <T>نشست فعالی وجود ندارد.</T>}
            </EmptyNote>
          ) : null}
        </div>
      </Panel>

      <Panel className="flex min-h-0 flex-col overflow-hidden">
        <PanelHead
          title="گفتگوهای تحت نظارت"
          hint="دسترسی فقط‌خواندنی ادمین کل به محتوای کانال‌ها، گروه‌ها و گفتگوهای خصوصی."
          action={
            <Pill accent="rose">
              <T>حساس</T>
            </Pill>
          }
        />
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pb-4">
          <div className="flex min-w-[160px] flex-1 items-center gap-2 rounded-full border border-chat-panel-border bg-white/60 px-3.5 py-2 text-[12.5px]">
            <Search className="size-4 text-chat-ink-soft" />
            <input
              value={targetQuery}
              onChange={(event) => setTargetQuery(event.target.value)}
              placeholder={t("جستجوی کانال، گروه یا گفتگو...")}
              className="w-full bg-transparent text-chat-ink outline-none placeholder:text-chat-ink-soft"
            />
          </div>
          <Segmented
            value={scope}
            onChange={setScope}
            items={[
              { value: "all", label: "همه" },
              { value: "channel", label: "کانال‌ها" },
              { value: "group", label: "گروه‌ها" },
              { value: "conversation", label: "گفتگوها" },
            ]}
          />
        </div>
        <div className="custom-scrollbar grid min-h-0 flex-1 content-start gap-2.5 overflow-y-auto px-5 pb-5">
          {targets.map((e) => (
            <div
              key={`${e.kind}-${e.id}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-chat-panel-border bg-white/60 px-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-[12.5px] font-bold text-chat-ink">{e.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-chat-ink-soft">
                  {t(targetLabel(e))} · {t("{count} عضو", { count: digits(e.members) })} ·{" "}
                  {t("{count} پیام", { count: digits(e.messages) })}
                </p>
              </div>
              <Btn onClick={() => setPendingView(e)}>
                <Eye className="size-4" />
                <T>مشاهده</T>
              </Btn>
            </div>
          ))}
          {spaces && conversations && targets.length === 0 ? (
            <EmptyNote>
              <T>موردی برای نظارت در این دسته وجود ندارد.</T>
            </EmptyNote>
          ) : null}
        </div>
      </Panel>

      <SystemFilesPanel />
      <ForwardQueuePanel />

      <ConfirmDialog
        open={ending !== null}
        title="پایان نشست"
        description={translate(
          "نشست {name} روی {device} همین حالا بسته می‌شود و باید دوباره وارد شود.",
          { name: ending?.user ?? "", device: ending?.device ?? "" },
        )}
        confirmLabel="پایان نشست"
        busy={busy}
        onConfirm={() => void endSession()}
        onClose={() => setEnding(null)}
      />

      <ConfirmDialog
        open={pendingView !== null}
        title="مشاهده گفتگوی تحت نظارت"
        description={`محتوای ${pendingView?.name ?? ""} به‌صورت فقط‌خواندنی نمایش داده می‌شود و این مشاهده با نام شما در لاگ فعالیت ثبت می‌شود.`}
        confirmLabel="مشاهده"
        variant="solid"
        busy={busy}
        onConfirm={() => void openTranscript()}
        onClose={() => setPendingView(null)}
      />

      {transcript ? (
        <PanelDialog
          open
          wide
          title={transcript.space.name}
          hint={`${TRANSCRIPT_LABELS[transcript.space.kind]} · نمای فقط‌خواندنی · ${fa(transcript.messages.length)} پیام اخیر`}
          onClose={() => setTranscript(null)}
        >
          <div className="custom-scrollbar max-h-[62vh] overflow-y-auto rounded-[22px] bg-chat-sky/[0.06] p-4">
            <TranscriptChat
              messages={transcript.messages}
              showSenders={transcript.space.kind !== "conversation"}
            />
          </div>
        </PanelDialog>
      ) : null}
    </div>
  );
}

/* -------------------------------- لاگ فعالیت -------------------------------- */

export function ActivitySection() {
  const [level, setLevel] = useState<"all" | AuditLevel>("all");
  const loadEntries = useCallback(() => fetchAudit(level), [level]);
  const { data } = useAdminResource(loadEntries, AUDIT_EVENTS);
  const rows = data ?? [];

  const exportCsv = () =>
    downloadFile(auditExportPath(level), "boomrang-activity.csv").catch((error: unknown) =>
      toast.error(errorMessage(error, "دریافت خروجی ناموفق بود")),
    );

  return (
    <Panel className="flex h-full min-h-0 flex-col overflow-hidden">
      <PanelHead
        title="لاگ فعالیت"
        hint="تاریخچه کامل اقدامات حساس؛ قابل فیلتر بر اساس شدت رویداد."
        action={
          <Btn onClick={() => void exportCsv()}>
            <Download className="size-4" />
            <T>خروجی CSV</T>
          </Btn>
        }
      />
      <div className="shrink-0 px-5 pb-4">
        <Segmented
          value={level}
          onChange={setLevel}
          items={[
            { value: "all", label: "همه" },
            { value: "info", label: "عادی" },
            { value: "warn", label: "هشدار" },
            { value: "danger", label: "بحرانی" },
          ]}
        />
      </div>
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {rows.map((l) => (
          <div
            key={l.id}
            className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-white/60"
          >
            <span
              className={cn(
                "size-8 rounded-2xl grid place-items-center",
                l.level === "danger"
                  ? iconWrap.rose
                  : l.level === "warn"
                    ? iconWrap.lemon
                    : iconWrap.mint,
              )}
            >
              <Activity className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] text-chat-ink truncate">
                <span className="font-bold">{l.actor}</span> — {l.action}
              </p>
              <p className="text-[11px] text-chat-ink-soft truncate">{l.target}</p>
            </div>
            <span className="text-[10.5px] text-chat-ink-soft/70">{l.at}</span>
          </div>
        ))}
        {data && rows.length === 0 ? (
          <EmptyNote>
            <T>رویدادی با این شدت ثبت نشده است.</T>
          </EmptyNote>
        ) : null}
      </div>
    </Panel>
  );
}

/* ----------------------------------- بکاپ ----------------------------------- */

const backupTone = (backup: Backup) =>
  backup.status === "success" ? "mint" : backup.status === "running" ? "lemon" : "rose";

const BACKUP_FACTS = [
  {
    title: "پایگاه‌داده",
    body: "همهٔ پیام‌ها، کاربران، کارتابل، وظایف و جلسه‌ها در یک فایل pg_dump.",
  },
  {
    title: "فایل‌های آپلودشده",
    body: "نسخهٔ اصلی، فشرده و بندانگشتی فایل‌ها به‌همراه تصاویر پروفایل.",
  },
  {
    title: "محل نگهداری",
    body: "روی همین سرور سازمان ذخیره می‌شود؛ خروج فایل فقط با دانلود دستی شما.",
  },
];

export function BackupSection() {
  const { data, reload } = useAdminResource(fetchBackups, BACKUP_EVENTS);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    const ok = await attempt(
      runBackup,
      "بکاپ آغاز شد؛ نتیجه همین‌جا نمایش داده می‌شود",
      "اجرای بکاپ ناموفق بود",
    );
    setBusy(false);
    if (ok) {
      setConfirming(false);
      await reload();
    }
  };

  const download = (backup: Backup) =>
    downloadFile(`/admin/backups/${backup.id}/download`, `boomrang-backup-${backup.id}.zip`).catch(
      (error: unknown) => toast.error(errorMessage(error, "دانلود بکاپ ناموفق بود")),
    );

  const backups = data?.backups ?? [];
  const succeeded = backups.filter((item) => item.status === "success").length;
  const failed = backups.filter((item) => item.status === "failed").length;

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-h-0 flex-col gap-4">
        <Panel className="shrink-0 p-5">
          <h3 className="font-display text-[15px] font-semibold text-chat-ink">
            <T>نسخهٔ پشتیبان چه چیزی را نگه می‌دارد؟</T>
          </h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {BACKUP_FACTS.map((fact) => (
              <div
                key={fact.title}
                className="rounded-2xl border border-chat-panel-border bg-white/60 p-3.5"
              >
                <p className="text-[12px] font-bold text-chat-ink">{fact.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-chat-ink-soft">{fact.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-chat-mint/10 px-3 py-2.5 text-center">
              <p className="font-display text-[18px] font-semibold text-chat-mint-deep">
                {fa(succeeded)}
              </p>
              <p className="mt-0.5 text-[10.5px] text-chat-ink-soft">
                <T>بکاپ موفق</T>
              </p>
            </div>
            <div className="rounded-2xl bg-chat-rose/10 px-3 py-2.5 text-center">
              <p className="font-display text-[18px] font-semibold text-chat-rose">{fa(failed)}</p>
              <p className="mt-0.5 text-[10.5px] text-chat-ink-soft">
                <T>ناموفق</T>
              </p>
            </div>
            <div className="rounded-2xl bg-chat-sky/10 px-3 py-2.5 text-center">
              <p className="font-display text-[18px] font-semibold text-chat-sky-deep">
                <T>۰۳:۰۰</T>
              </p>
              <p className="mt-0.5 text-[10.5px] text-chat-ink-soft">
                <T>اجرای خودکار هر شب</T>
              </p>
            </div>
          </div>
        </Panel>

        <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <PanelHead
            title="تاریخچه بکاپ"
            hint="هر ردیف یک نسخهٔ کامل است؛ برای بازگردانی، فایل را دانلود و به تیم زیرساخت بدهید."
          />
          <div className="custom-scrollbar grid min-h-0 flex-1 content-start gap-2 overflow-y-auto px-5 pb-5">
            {(data?.backups ?? []).map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between rounded-2xl border border-chat-panel-border bg-white/60 px-4 py-2.5"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "grid size-8 place-items-center rounded-xl",
                      iconWrap[backupTone(b)],
                    )}
                  >
                    <Database className="size-4" />
                  </span>
                  <div>
                    <p className="text-[12.5px] font-bold text-chat-ink">{b.at}</p>
                    <p className="text-[11px] text-chat-ink-soft mt-0.5">
                      {b.size} · {b.duration}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Pill accent={backupTone(b)}>{b.statusLabel}</Pill>
                  <Btn
                    onClick={() => void download(b)}
                    disabled={!b.downloadable}
                    label="دانلود بکاپ"
                  >
                    <Download className="size-4" />
                  </Btn>
                </div>
              </div>
            ))}
            {data && data.backups.length === 0 ? (
              <EmptyNote>
                <T>هنوز بکاپی گرفته نشده است.</T>
              </EmptyNote>
            ) : null}
          </div>
        </Panel>
      </div>

      <Panel className="h-fit p-5">
        <h3 className="font-display text-[15px] font-semibold text-chat-ink">
          <T>بکاپ دستی</T>
        </h3>
        <p className="text-[11.5px] text-chat-ink-soft mt-1 leading-relaxed">
          <T>گرفتن نسخه پشتیبان فوری از پایگاه‌داده و فایل‌های آپلودشده.</T>
        </p>
        <div className="mt-4 rounded-2xl bg-chat-mint/12 border border-chat-mint/25 px-4 py-3">
          <p className="text-[11.5px] text-chat-mint-deep font-bold">
            <T>آخرین بکاپ موفق</T>
          </p>
          <p className="text-[12.5px] text-chat-ink mt-1">
            {data ? (data.latest ?? "هنوز بکاپ موفقی ثبت نشده است") : "—"}
          </p>
        </div>
        <Btn
          variant="solid"
          className="mt-3 w-full"
          onClick={() => setConfirming(true)}
          disabled={!data || data.running}
        >
          {data?.running ? "بکاپ در حال اجراست" : "اجرای بکاپ اکنون"}
        </Btn>
        <p className="mt-3 text-[11px] leading-relaxed text-chat-ink-soft">
          <T>
            در زمان اجرا، سامانه از دسترس خارج نمی‌شود؛ فقط ممکن است چند دقیقه کندتر پاسخ دهد. فایل
            نهایی روی همین سرور ذخیره می‌شود و با دکمهٔ دانلود قابل انتقال است.
          </T>
        </p>
      </Panel>

      <ConfirmDialog
        open={confirming}
        title="اجرای بکاپ"
        description="نسخه کامل پایگاه‌داده و پوشه فایل‌های آپلودشده در یک فایل فشرده ذخیره می‌شود. این اقدام در لاگ فعالیت ثبت می‌شود."
        confirmLabel="شروع بکاپ"
        variant="solid"
        busy={busy}
        onConfirm={() => void start()}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}

/* ---------------------------------- آرشیوها ---------------------------------- */

export function ArchivesSection() {
  const { data } = useAdminResource(fetchArchives, AUDIT_EVENTS);

  const download = (id: number, name: string) =>
    downloadFile(`/admin/exports/${id}/download`, `${name}.zip`).catch((error: unknown) =>
      toast.error(errorMessage(error, "دانلود آرشیو ناموفق بود")),
    );

  const archives = data ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Panel className="shrink-0 p-5">
        <h3 className="font-display text-[15px] font-semibold text-chat-ink">
          <T>آرشیو چه زمانی ساخته می‌شود؟</T>
        </h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-chat-ink-soft">
          <T>
            پیش از حذف هر کاربر، یک نسخهٔ فشرده از گفتگوها، فایل‌ها و سوابق کاری او ساخته می‌شود تا
            سازمان بتواند در صورت نیاز قانونی یا کاری به آن رجوع کند. این نسخه ۹۰ روز نگهداری و سپس
            برای همیشه پاک می‌شود؛ هر دانلود نیز با نام شما در لاگ فعالیت ثبت می‌گردد.
          </T>
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-2xl bg-chat-sky/10 px-3 py-2.5 text-center">
            <p className="font-display text-[18px] font-semibold text-chat-sky-deep">
              {fa(archives.length)}
            </p>
            <p className="mt-0.5 text-[10.5px] text-chat-ink-soft">
              <T>آرشیو موجود</T>
            </p>
          </div>
          <div className="rounded-2xl bg-chat-lemon/12 px-3 py-2.5 text-center">
            <p className="font-display text-[18px] font-semibold text-chat-lemon">
              {fa(archives.reduce((total, item) => total + item.files, 0))}
            </p>
            <p className="mt-0.5 text-[10.5px] text-chat-ink-soft">
              <T>فایل بایگانی‌شده</T>
            </p>
          </div>
          <div className="rounded-2xl bg-chat-violet/10 px-3 py-2.5 text-center">
            <p className="font-display text-[18px] font-semibold text-chat-violet">
              <T>۹۰</T>
            </p>
            <p className="mt-0.5 text-[10.5px] text-chat-ink-soft">
              <T>روز نگهداری</T>
            </p>
          </div>
        </div>
      </Panel>

      <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelHead
          title="آرشیو کاربران حذف‌شده"
          hint="برای هر کاربر یک فایل زیپ شامل گفتگوها و فایل‌های او."
        />
        <div className="custom-scrollbar grid min-h-0 flex-1 content-start gap-2 overflow-y-auto px-5 pb-5">
          {(data ?? []).map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-chat-panel-border bg-white/60 px-4 py-2.5"
            >
              <span
                className={cn("grid size-8 shrink-0 place-items-center rounded-xl", iconWrap.sky)}
              >
                <FileArchive className="size-4" />
              </span>
              <div className="min-w-[160px] flex-1">
                <p className="truncate text-[13px] font-bold text-chat-ink">{a.name}</p>
                <p className="mt-0.5 text-[11px] text-chat-ink-soft">
                  {translate("حذف‌شده در {date}", { date: a.deletedAt })}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Pill accent="sky">{a.size}</Pill>
                <Pill accent="lemon">{translate("{count} فایل", { count: fa(a.files) })}</Pill>
              </div>
              <Btn onClick={() => void download(a.id, a.name)}>
                <Download className="size-4" />
                <T>دانلود</T>
              </Btn>
            </div>
          ))}
          {data && data.length === 0 ? (
            <EmptyNote>
              <T>آرشیوی از کاربران حذف‌شده وجود ندارد.</T>
            </EmptyNote>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------- یادآوری‌های بات ------------------------------ */

const REMINDER_EVENTS = ["admin:audit", "admin:reminders"] as const;

const EMPTY_REMINDER_FORM = { title: "", message: "", target: "", time: "", repeat: "workdays" };

const reminderTargets = () =>
  Promise.all([fetchAnnouncementTargets(), activeSpaces()]).then(([announcements, spaces]) => [
    ...announcements.map((item) => ({ value: `conversation:${item.id}`, label: item.title })),
    ...spaces.map((s) => ({
      value: `${s.kind}:${s.id}`,
      label: s.kind === "channel" ? `#${s.name}` : s.name,
    })),
  ]);

export function RemindersSection() {
  const { t, digits } = useI18n();
  const { data: items, reload } = useAdminResource(fetchReminders, REMINDER_EVENTS);
  const { data: targets } = useAdminResource(reminderTargets, AUDIT_EVENTS);
  const [form, setForm] = useState(EMPTY_REMINDER_FORM);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [removing, setRemoving] = useState<Reminder | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentMode, setAttachmentMode] = useState<"compressed" | "file">("compressed");
  const [dropAttachment, setDropAttachment] = useState(false);
  const [busy, setBusy] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);

  const targetOptions = [...(targets ?? [])];
  if (editing && form.target && !targetOptions.some((option) => option.value === form.target)) {
    targetOptions.unshift({ value: form.target, label: editing.target });
  }
  const selectedTarget = form.target || targetOptions[0]?.value || "";
  const currentAttachment = dropAttachment ? null : (editing?.attachment ?? null);
  const canCompress = attachment ? isVisualMedia(attachment.type) : false;

  const toggle = async (id: number, active: boolean) => {
    await attempt(
      () => setReminderActive(id, active),
      active ? "یادآوری فعال شد" : "یادآوری متوقف شد",
      "تغییر وضعیت یادآوری ناموفق بود",
    );
    await reload();
  };

  const resetForm = () => {
    setEditing(null);
    setForm(EMPTY_REMINDER_FORM);
    setAttachment(null);
    setDropAttachment(false);
    setAttachmentMode("compressed");
    if (filePicker.current) filePicker.current.value = "";
  };

  const startEditing = (reminder: Reminder) => {
    setEditing(reminder);
    setAttachment(null);
    setDropAttachment(false);
    if (filePicker.current) filePicker.current.value = "";
    setForm({
      title: reminder.title,
      message: reminder.message,
      target: reminder.targetId ? `${reminder.targetType}:${reminder.targetId}` : "",
      time: reminder.time ?? "",
      repeat: repeatOptionFor(reminder.repeatDays),
    });
  };

  const submit = async () => {
    const clock = normalizeClock(form.time);
    const [kind, id] = selectedTarget.split(":");
    if (!form.title.trim()) {
      toast.error(translate("عنوان یادآوری را وارد کنید"));
      return;
    }
    if (!kind || !id) {
      toast.error(translate("مقصد یادآوری را انتخاب کنید"));
      return;
    }
    if (!clock) {
      toast.error(translate("ساعت ارسال را کامل وارد کنید"));
      return;
    }
    const input = {
      title: form.title.trim(),
      message: form.message.trim(),
      targetType: kind as ReminderTargetType,
      targetId: Number(id),
      repeatDailyAt: clock,
      repeatDays: REPEAT_OPTIONS.find((option) => option.value === form.repeat)?.days ?? null,
    };
    const current = editing;
    const picked = attachment
      ? { file: attachment, mode: canCompress ? attachmentMode : ("file" as const) }
      : null;
    setBusy(true);
    const ok = await attempt(
      async () => {
        if (!current) {
          await createReminder(input, picked);
          return;
        }
        await updateReminder(current.id, input);
        if (picked) await setReminderAttachment(current.id, picked);
        else if (dropAttachment && current.attachment)
          await setReminderAttachment(current.id, null);
      },
      current ? "یادآوری به‌روزرسانی شد" : "یادآوری ساخته شد",
      current ? "ویرایش یادآوری ناموفق بود" : "ساخت یادآوری ناموفق بود",
    );
    setBusy(false);
    if (ok) {
      resetForm();
      await reload();
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    const target = removing;
    setBusy(true);
    const ok = await attempt(
      () => deleteReminder(target.id),
      "یادآوری حذف شد",
      "حذف یادآوری ناموفق بود",
    );
    setBusy(false);
    if (ok) {
      if (editing?.id === target.id) resetForm();
      setRemoving(null);
      await reload();
    }
  };

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Panel className="flex min-h-0 flex-col overflow-hidden">
        <PanelHead
          title="یادآوری‌های بات"
          hint="پیام‌های زمان‌بندی‌شده‌ای که بات سازمانی در کانال‌ها، گروه‌ها و اطلاعیه‌ها ارسال می‌کند؛ روی هر مورد بزنید تا ویرایش شود."
        />
        <div className="custom-scrollbar grid min-h-0 flex-1 content-start gap-2.5 overflow-y-auto bg-chat-sky/[0.06] px-4 py-3">
          {(items ?? []).map((r) => (
            <div
              key={r.id}
              role={r.time ? "button" : undefined}
              tabIndex={r.time ? 0 : undefined}
              onClick={() => {
                if (r.time) startEditing(r);
              }}
              onKeyDown={(event) => {
                if (!r.time) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  startEditing(r);
                }
              }}
              className={cn(
                "flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition-colors",
                editing?.id === r.id
                  ? "border-chat-violet/40 bg-chat-violet/8"
                  : "border-chat-panel-border bg-white/75",
                r.time ? "cursor-pointer hover:bg-white" : "",
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className={cn("grid size-9 place-items-center rounded-2xl", iconWrap.violet)}>
                  <BellRing className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-[12.5px] font-bold text-chat-ink">
                    <span className="truncate">{r.title}</span>
                    {r.attachment ? (
                      <Paperclip className="size-3 shrink-0 text-chat-ink-soft" />
                    ) : null}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-chat-ink-soft">
                    {r.target} · {r.schedule} · {t("{count} ارسال", { count: digits(r.delivered) })}
                  </p>
                </div>
              </div>
              <div
                className="flex shrink-0 items-center gap-1.5"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                role="presentation"
              >
                <Toggle on={r.active} onChange={(v) => void toggle(r.id, v)} />
                <button
                  type="button"
                  onClick={() => setRemoving(r)}
                  className="grid size-8 place-items-center rounded-full text-chat-ink-soft transition-colors hover:bg-chat-rose/15 hover:text-chat-rose"
                  aria-label={t("حذف {name}", { name: r.title })}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
          {items && items.length === 0 ? (
            <EmptyNote>
              <T>هنوز یادآوری‌ای ساخته نشده است.</T>
            </EmptyNote>
          ) : null}
        </div>
      </Panel>

      <Panel className="custom-scrollbar min-h-0 overflow-y-auto p-5">
        <h3 className="font-display text-[15px] font-semibold text-chat-ink">
          {editing ? t("ویرایش یادآوری") : t("یادآوری جدید")}
        </h3>
        <div className="mt-4 grid gap-3">
          <Field
            label="عنوان"
            placeholder="مثلاً ثبت گزارش روزانه"
            value={form.title}
            onChange={(v) => setForm((f) => ({ ...f, title: v }))}
          />
          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-bold text-chat-ink-soft">
              {t("متن پیام")}
            </span>
            <textarea
              rows={3}
              value={form.message}
              maxLength={2000}
              onChange={(event) => setForm((f) => ({ ...f, message: event.target.value }))}
              placeholder={t("متنی که بات همراه یادآوری می‌فرستد")}
              className="w-full resize-none rounded-2xl border border-chat-panel-border bg-white/70 px-3.5 py-2.5 text-[13px] leading-relaxed text-chat-ink outline-none transition-colors placeholder:text-chat-ink-soft focus:border-chat-sky/30 focus:bg-white"
            />
          </label>
          <Combo
            label="مقصد"
            searchable
            value={selectedTarget}
            onChange={(v) => setForm((f) => ({ ...f, target: v }))}
            options={
              targetOptions.length ? targetOptions : [{ value: "", label: "مقصد فعالی وجود ندارد" }]
            }
            emptyLabel="مقصدی با این نام پیدا نشد"
          />
          <Combo
            label="تکرار"
            value={form.repeat}
            onChange={(v) => setForm((f) => ({ ...f, repeat: v }))}
            options={REPEAT_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
          />
          <ClockField
            label="ساعت ارسال"
            value={form.time}
            onChange={(v) => setForm((f) => ({ ...f, time: v }))}
          />

          <div className="rounded-2xl border border-chat-panel-border bg-white/60 p-3.5">
            <p className="flex items-center gap-1.5 text-[11.5px] font-bold text-chat-ink-soft">
              <Paperclip className="size-3.5" />
              {t("پیوست")}
            </p>
            <input
              ref={filePicker}
              type="file"
              className="hidden"
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null;
                setAttachment(picked);
                setDropAttachment(false);
                setAttachmentMode(picked && isVisualMedia(picked.type) ? "compressed" : "file");
              }}
            />

            {attachment ? (
              <div className="mt-2.5 grid gap-2">
                <div className="flex items-center gap-2 rounded-xl bg-chat-ink/5 px-3 py-2">
                  <FileText className="size-4 shrink-0 text-chat-ink-soft" />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-chat-ink" dir="auto">
                    {attachment.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setAttachment(null);
                      if (filePicker.current) filePicker.current.value = "";
                    }}
                    aria-label={t("حذف پیوست")}
                    className="grid size-7 shrink-0 place-items-center rounded-full text-chat-ink-soft transition-colors hover:bg-chat-rose/15 hover:text-chat-rose"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                {canCompress ? (
                  <Segmented
                    value={attachmentMode}
                    onChange={setAttachmentMode}
                    items={[
                      { value: "compressed" as const, label: "ارسال فشرده" },
                      { value: "file" as const, label: "ارسال به‌صورت فایل" },
                    ]}
                  />
                ) : null}
              </div>
            ) : currentAttachment ? (
              <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-chat-ink/5 px-3 py-2">
                <FileText className="size-4 shrink-0 text-chat-ink-soft" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-chat-ink" dir="auto">
                  {currentAttachment.name}
                </span>
                <button
                  type="button"
                  onClick={() => setDropAttachment(true)}
                  aria-label={t("حذف پیوست")}
                  className="grid size-7 shrink-0 place-items-center rounded-full text-chat-ink-soft transition-colors hover:bg-chat-rose/15 hover:text-chat-rose"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ) : (
              <p className="mt-2 text-[11px] leading-relaxed text-chat-ink-soft">
                {t(
                  "می‌توانید یک عکس، ویدیو یا فایل به یادآوری پیوست کنید؛ عکس و ویدیو مانند پیام‌های معمولی به‌صورت فشرده با همین متن فرستاده می‌شود.",
                )}
              </p>
            )}

            <Btn className="mt-2.5 w-full" onClick={() => filePicker.current?.click()}>
              <ImagePlus className="size-4" />
              {attachment || currentAttachment ? t("انتخاب فایل دیگر") : t("انتخاب فایل")}
            </Btn>
          </div>

          {editing ? (
            <div className="flex gap-2">
              <Btn variant="solid" className="flex-1" onClick={() => void submit()} disabled={busy}>
                <T>ذخیره تغییرات</T>
              </Btn>
              <Btn onClick={resetForm} disabled={busy}>
                <T>انصراف</T>
              </Btn>
            </div>
          ) : (
            <Btn variant="solid" onClick={() => void submit()} disabled={busy}>
              <T>ساخت یادآوری</T>
            </Btn>
          )}
        </div>
      </Panel>

      <ConfirmDialog
        open={removing !== null}
        title="حذف یادآوری"
        description={
          removing
            ? `یادآوری «${removing.title}» حذف می‌شود و دیگر ارسال نمی‌شود. پیام‌هایی که قبلاً ارسال شده‌اند در گفتگو باقی می‌مانند.`
            : ""
        }
        confirmLabel="حذف یادآوری"
        busy={busy}
        onConfirm={() => void confirmRemove()}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
