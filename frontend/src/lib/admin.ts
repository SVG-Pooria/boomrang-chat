import { createContext } from "react";

import { ApiError, readSession, request } from "@/lib/auth";
import type { FileVariant } from "@/lib/files";
import { useLiveResource } from "@/lib/live-resource";

export type Role = "employee" | "manager" | "management" | "super_admin";

export const ROLE_LABELS: Record<Role, string> = {
  employee: "کارمند",
  manager: "مدیر",
  management: "هیئت مدیره",
  super_admin: "ادمین کل",
};

export const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as Role[]).map((value) => ({
  value,
  label: ROLE_LABELS[value],
}));

export type Accent = "mint" | "sky" | "violet" | "rose" | "lemon";

export type AdminSection =
  | "overview"
  | "users"
  | "entities"
  | "tags"
  | "settings"
  | "oversight"
  | "activity"
  | "backup"
  | "archives"
  | "requests"
  | "reminders";

export type AuditLevel = "info" | "warn" | "danger";

export type AdminUser = {
  id: number;
  fullName: string;
  phone: string;
  role: Role;
  jobTitle: string;
  unit: string;
  tagId: number | null;
  tag: string;
  isActive: boolean;
  hasPassword: boolean;
  neverSignedIn: boolean;
  presence: "online" | "away" | "offline";
  lastSeen: string;
  permissions: string[];
  initials: string;
  accent: Accent;
};

export type UserCounts = Record<Role | "all" | "neverSignedIn", number>;

export type UserFilter = Role | "all" | "never";

export type Tag = { id: number; name: string; members: number };

export type SpaceKind = "channel" | "group";

export type Space = {
  kind: SpaceKind;
  id: number;
  name: string;
  owner: string;
  ownerId: number | null;
  members: number;
  messages: number;
  archived: boolean;
};

export type MonitoredConversation = {
  kind: "conversation";
  id: number;
  name: string;
  direct: boolean;
  ticket: boolean;
  closed: boolean;
  members: number;
  messages: number;
};

export type LogEntry = {
  id: number;
  actor: string;
  action: string;
  target: string;
  at: string;
  level: AuditLevel;
};

export type Stat = {
  key: "users" | "spaces" | "messages" | "alerts";
  label: string;
  value: string;
  delta: string;
};

export type Gauge = { key: "database" | "storage" | "queue"; label: string; value: number | null };

export type Overview = { stats: Stat[]; events: LogEntry[]; health: Gauge[] };

export type Badges = { overview: number; users: number; oversight: number };

export type AdminApproval = {
  id: string;
  requestId: number;
  title: string;
  type: string;
  person: string;
  unit: string;
  time: string;
  stage: string;
  stepName: string | null;
  priority: string;
  tone: "rose" | "lemon" | "sky";
  details: string;
  canDecide: boolean;
};

export type ApprovalDecision = "تأیید" | "رد" | "ارجاع";

export type PolicyFlag = "readReceiptsEnabled" | "fileScanEnabled";

export type Settings = {
  maxFileSizeMb: number | null;
  messageCooldownSeconds: number;
  language: "fa" | "en";
} & Record<PolicyFlag, boolean>;

export type ActiveSession = {
  id: string;
  userId: number;
  user: string;
  device: string;
  ip: string;
  since: string;
  current: boolean;
};

export type TranscriptMessage = {
  id: number;
  sender: string;
  senderId: number | null;
  body: string;
  at: string;
  clock: string;
  createdAt: string;
  type: string;
  attachment: string | null;
  fileId: number | null;
  fileMode: string | null;
  fileMimeType: string | null;
  confidential: boolean;
  edited: boolean;
  pinned: boolean;
};

export type TranscriptKind = SpaceKind | "conversation";

export type Transcript = {
  space: { kind: TranscriptKind; name: string; archived: boolean };
  messages: TranscriptMessage[];
};

export type MemberRole = "owner" | "admin" | "member";

export type SpaceMember = {
  userId: number;
  name: string;
  role: MemberRole;
  roleLabel: string;
  permissions: Record<string, boolean>;
  initials: string;
  accent: Accent;
};

export type SpaceMembers = {
  space: { name: string; archived: boolean };
  members: SpaceMember[];
  candidates: { userId: number; name: string }[];
};

export type Backup = {
  id: number;
  at: string;
  size: string;
  status: "running" | "success" | "failed";
  statusLabel: string;
  duration: string;
  downloadable: boolean;
};

export type Backups = { backups: Backup[]; latest: string | null; running: boolean };

export type Archive = { id: number; name: string; deletedAt: string; size: string; files: number };

export type ReminderTargetType = "conversation" | SpaceKind;

export type ReminderAttachment = {
  fileId: number;
  name: string;
  mode: string;
  mimeType: string | null;
  sizeBytes: number | null;
};

export type Reminder = {
  id: number;
  title: string;
  target: string;
  targetType: ReminderTargetType;
  targetId: number | null;
  message: string;
  schedule: string;
  time: string | null;
  repeatDays: number[] | null;
  active: boolean;
  delivered: number;
  attachment: ReminderAttachment | null;
};

export type ReminderInput = {
  title: string;
  message: string;
  targetType: ReminderTargetType;
  targetId: number;
  repeatDailyAt: string;
  repeatDays: number[] | null;
};

export const WORK_WEEK = [0, 1, 2, 3, 6];

export const REPEAT_OPTIONS: { value: string; label: string; days: number[] | null }[] = [
  { value: "daily", label: "هر روز", days: null },
  { value: "workdays", label: "هر روز کاری", days: WORK_WEEK },
  { value: "6", label: "شنبه‌ها", days: [6] },
  { value: "0", label: "یک‌شنبه‌ها", days: [0] },
  { value: "1", label: "دوشنبه‌ها", days: [1] },
  { value: "2", label: "سه‌شنبه‌ها", days: [2] },
  { value: "3", label: "چهارشنبه‌ها", days: [3] },
  { value: "4", label: "پنجشنبه‌ها", days: [4] },
  { value: "5", label: "جمعه‌ها", days: [5] },
];

export function repeatOptionFor(days: number[] | null) {
  const key = days ? [...days].sort((a, b) => a - b).join(",") : "";
  const match = REPEAT_OPTIONS.find(
    (option) => (option.days ? [...option.days].sort((a, b) => a - b).join(",") : "") === key,
  );
  return match?.value ?? "daily";
}

type AdminNavigation = {
  open: (section: AdminSection, intent?: "create") => void;
  intent: "create" | null;
  consumeIntent: () => void;
};

export const AdminNavigationContext = createContext<AdminNavigation>({
  open: () => {},
  intent: null,
  consumeIntent: () => {},
});

export const AUDIT_EVENTS = ["admin:audit"] as const;
export const BADGE_EVENTS = ["admin:audit", "workspace:changed"] as const;
export const APPROVAL_EVENTS = ["workspace:changed"] as const;
export const USER_EVENTS = ["admin:audit", "presence:update"] as const;
export const SESSION_EVENTS = ["admin:sessions", "admin:audit"] as const;
export const BACKUP_EVENTS = ["admin:backups"] as const;
export const SETTINGS_EVENTS = ["settings:changed"] as const;

export function useAdminResource<T>(load: () => Promise<T>, events: readonly string[]) {
  return useLiveResource(load, events, "بارگذاری اطلاعات پنل ناموفق بود");
}

const ERROR_MESSAGES: Record<string, string> = {
  PHONE_ALREADY_EXISTS: "این شماره موبایل قبلاً ثبت شده است",
  INVALID_PHONE: "شماره موبایل باید با ۰۹ شروع شود و ۱۱ رقم باشد",
  INVALID_FULL_NAME: "نام کامل را وارد کنید",
  WEAK_PASSWORD: "رمز عبور باید دست‌کم ۶ نویسه باشد",
  INVALID_PASSWORD: "رمز عبور خودتان درست وارد نشده است",
  REAUTH_REQUIRED: "برای این کار ابتدا رمز عبور خودتان را تأیید کنید",
  TOO_MANY_ATTEMPTS: "تلاش ناموفق زیادی ثبت شد؛ چند دقیقه بعد دوباره امتحان کنید",
  TOO_MANY_UPLOADS: "تعداد بارگذاری‌ها زیاد است؛ کمی بعد دوباره تلاش کنید",
  FILE_TYPE_NOT_ALLOWED: "بارگذاری فایل‌های اجرایی و اسکریپت مجاز نیست",
  CANNOT_DISABLE_SELF: "نمی‌توانید حساب خودتان را غیرفعال کنید",
  CANNOT_CHANGE_OWN_ROLE: "نمی‌توانید نقش خودتان را تغییر دهید",
  CANNOT_DELETE_SELF: "نمی‌توانید حساب خودتان را حذف کنید",
  LAST_SUPER_ADMIN: "دست‌کم یک ادمین کل فعال باید باقی بماند",
  CONFIRM_NAME_MISMATCH: "نام واردشده با نام کاربر یکسان نیست",
  PASSWORD_NOT_SET: "این کاربر هنوز رمز عبوری نساخته است",
  PASSWORD_UNDECRYPTABLE: "رمز این کاربر با کلید فعلی قابل بازیابی نیست؛ رمز جدید تعیین کنید",
  TAG_NAME_EXISTS: "تگی با این نام وجود دارد",
  INVALID_FILE_SIZE: "سقف حجم فایل معتبر نیست",
  INVALID_COOLDOWN_SECONDS: "فاصله بین پیام‌ها باید عددی صحیح بین ۰ و ۳۶۰۰ باشد",
  OWNER_NOT_ELIGIBLE: "مالک انتخاب‌شده معتبر نیست",
  OWNER_REQUIRED: "مالک فضا را انتخاب کنید",
  ALREADY_OWNER: "این کاربر هم‌اکنون مالک فضاست",
  OWNER_ROLE_LOCKED: "نقش مالک فقط با واگذاری مالکیت تغییر می‌کند",
  TITLE_REQUIRED: "نام فضا را وارد کنید",
  OWNER_CANNOT_BE_REMOVED: "مالک فضا را نمی‌توان حذف کرد",
  SPACE_ARCHIVED: "فضای آرشیوشده تغییر نمی‌پذیرد",
  MEMBER_NOT_ELIGIBLE: "این کاربر را نمی‌توان به فضا افزود",
  ALREADY_A_MEMBER: "این کاربر از قبل عضو است",
  NOT_A_MEMBER: "این کاربر دیگر عضو فضا نیست",
  CURRENT_SESSION: "این نشست فعلی خود شماست",
  BACKUP_RUNNING: "یک بکاپ هم‌اکنون در حال اجراست",
  ARCHIVE_PURGED: "مهلت نگهداری این آرشیو تمام شده و فایل آن پاک شده است",
  FILE_NOT_FOUND: "فایل روی سرور پیدا نشد",
  INVALID_TIME_FORMAT: "ساعت ارسال را به شکل ۱۶:۳۰ وارد کنید",
  INVALID_TITLE: "عنوان را وارد کنید",
  TARGET_REQUIRED: "مقصد را انتخاب کنید",
  REMINDER_NOT_FOUND: "این یادآوری دیگر وجود ندارد",
  ALREADY_DECIDED: "این درخواست پیش‌تر تعیین تکلیف شده است",
  NOT_STEP_APPROVER: "تصمیم مرحله فعلی این درخواست با شما نیست",
  TITLE_TOO_LONG: "نام فضا بیش از حد طولانی است",
  DESCRIPTION_TOO_LONG: "توضیحات نباید بیش از ۱۰۰۰ نویسه باشد",
  INVALID_VISIBILITY: "نوع دسترسی معتبر نیست",
  INVALID_IMAGE: "فایل انتخاب‌شده تصویر معتبری نیست",
  INVALID_IMAGE_TYPE: "فقط تصویر JPG، PNG، WebP یا GIF پذیرفته می‌شود",
  FILE_TOO_LARGE: "حجم تصویر نباید بیش از ۱۰ مگابایت باشد",
  INFECTED_FILE: "فایل آلوده تشخیص داده شد و ذخیره نشد",
  SCAN_UNAVAILABLE: "سرویس اسکن فایل در دسترس نیست",
  AVATAR_NOT_FOUND: "این فضا عکسی ندارد",
  CHANNEL_ALREADY_LINKED: "این کانال از قبل به گروه دیگری پیوند دارد",
  GROUP_ALREADY_LINKED: "این گروه از قبل به کانال دیگری پیوند دارد",
  CHANNEL_NOT_FOUND: "کانال مقصد پیدا نشد یا آرشیو شده است",
  GROUP_NOT_FOUND: "گروه مقصد پیدا نشد یا آرشیو شده است",
  LINK_NOT_FOUND: "پیوندی برای قطع کردن وجود ندارد",
  CONFIRM_TITLE_MISMATCH: "نام واردشده با نام فضا یکسان نیست",
  INVALID_PERMISSION: "دسترسی انتخاب‌شده معتبر نیست",
  DEAD_LETTER_NOT_FOUND: "این پیام دیگر در فهرست ناموفق‌ها نیست",
};

export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError && ERROR_MESSAGES[error.message]) {
    return ERROR_MESSAGES[error.message] as string;
  }
  return fallback;
}

export function latinDigits(value: string) {
  return value.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).trim();
}

export function normalizeClock(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(latinDigits(value));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const fetchOverview = () => request<Overview>("/admin/overview");
export const fetchBadges = () => request<Badges>("/admin/badges");

export const fetchApprovals = () =>
  request<{ approvals: AdminApproval[] }>("/admin/approvals").then((result) => result.approvals);

export const decideApproval = (requestId: number, decision: ApprovalDecision, note: string) =>
  request(`/workspace/approvals/${requestId}/decision`, json("POST", { decision, note }));

export const verifyOwnPassword = (password: string) =>
  request("/auth/verify-password", json("POST", { password }));

export function fetchUsers(search: string, role: UserFilter) {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  if (role !== "all") params.set("role", role);
  const query = params.toString();
  return request<{ users: AdminUser[]; counts: UserCounts }>(
    `/admin/users${query ? `?${query}` : ""}`,
  );
}

export function createUser(input: {
  fullName: string;
  phone: string;
  role: Role;
  tagId: number | null;
  password: string | null;
}) {
  return request<{ user: { id: number } }>("/users", json("POST", input));
}

export const setUserRole = (userId: number, role: Role) =>
  request(`/users/${userId}/role`, json("PATCH", { role }));

export const setUserTag = (userId: number, tagId: number | null) =>
  request(`/users/${userId}/tag`, json("PATCH", { tagId }));

export const setUserActive = (userId: number, isActive: boolean) =>
  request(`/users/${userId}/active`, json("PATCH", { isActive }));

export const resetUserPassword = (userId: number, newPassword: string) =>
  request(`/admin/users/${userId}/password`, json("PATCH", { newPassword }));

export const viewUserPassword = (userId: number) =>
  request<{ password: string }>(`/admin/users/${userId}/password`).then(
    (result) => result.password,
  );

export const archiveUser = (userId: number) =>
  request<{ archive: { id: number } }>(`/admin/users/${userId}/archive`, json("POST"));

export const deleteUser = (userId: number, confirmName: string) =>
  request<{ archive: { id: number } | null }>(
    `/users/${userId}`,
    json("DELETE", { confirmName, withBackup: true }),
  );

export const fetchTags = () =>
  request<{ tags: Tag[] }>("/admin/tags").then((result) => result.tags);
export const createTag = (name: string) => request("/admin/tags", json("POST", { name }));
export const deleteTag = (tagId: number) => request(`/admin/tags/${tagId}`, json("DELETE"));

export const fetchSettings = () =>
  request<{ settings: Settings }>("/admin/settings").then((result) => result.settings);

export const saveSettings = (patch: Partial<Settings>) =>
  request<{ settings: Settings }>("/admin/settings", json("PUT", patch)).then(
    (result) => result.settings,
  );

export function fetchSpaces(kind: SpaceKind | "all" = "all") {
  const query = kind === "all" ? "" : `?kind=${kind}`;
  return request<{ spaces: Space[] }>(`/admin/spaces${query}`).then((result) => result.spaces);
}

export const createSpace = (input: { kind: SpaceKind; title: string; ownerId: number }) =>
  request("/admin/spaces", json("POST", input));

const spacePath = (space: Pick<Space, "kind" | "id">) => `/admin/spaces/${space.kind}/${space.id}`;

export const setSpaceArchived = (space: Pick<Space, "kind" | "id">, archived: boolean) =>
  request(`${spacePath(space)}/archive`, json("POST", { archived }));

export const fetchSpaceMembers = (space: Pick<Space, "kind" | "id">) =>
  request<SpaceMembers>(`${spacePath(space)}/members`);

export const addSpaceMember = (space: Pick<Space, "kind" | "id">, userId: number) =>
  request(`${spacePath(space)}/members`, json("POST", { userId }));

export const removeSpaceMember = (space: Pick<Space, "kind" | "id">, userId: number) =>
  request(`${spacePath(space)}/members/${userId}`, json("DELETE"));

export const setSpaceMemberRole = (
  space: Pick<Space, "kind" | "id">,
  userId: number,
  role: Exclude<MemberRole, "owner">,
) => request(`${spacePath(space)}/members/${userId}`, json("PATCH", { role }));

export const transferSpaceOwner = (space: Pick<Space, "kind" | "id">, userId: number) =>
  request(`${spacePath(space)}/owner`, json("POST", { userId }));

export const fetchTranscript = (target: { kind: TranscriptKind; id: number }) =>
  request<Transcript>(
    target.kind === "conversation"
      ? `/admin/conversations/${target.id}/transcript`
      : `${spacePath({ kind: target.kind, id: target.id })}/transcript`,
  );

export const fetchConversations = () =>
  request<{ conversations: MonitoredConversation[] }>("/admin/conversations").then(
    (result) => result.conversations,
  );

export const monitoredFilePath = (fileId: number) => `/admin/oversight/files/${fileId}/original`;

export const oversightFileUrl = (fileId: number, variant: FileVariant) =>
  `/api/admin/oversight/files/${fileId}/${variant}`;

export const fetchSessions = () =>
  request<{ sessions: ActiveSession[] }>("/admin/sessions").then((result) => result.sessions);

export const revokeSession = (sessionId: string) =>
  request(`/admin/sessions/${sessionId}`, json("DELETE"));

export function fetchAudit(level: AuditLevel | "all") {
  const query = level === "all" ? "" : `?level=${level}`;
  return request<{ entries: LogEntry[] }>(`/admin/audit${query}`).then((result) => result.entries);
}

export const auditExportPath = (level: AuditLevel | "all") =>
  `/admin/audit/export${level === "all" ? "" : `?level=${level}`}`;

export const fetchBackups = () => request<Backups>("/admin/backups");
export const runBackup = () => request("/admin/backups", json("POST"));

export const fetchArchives = () =>
  request<{ archives: Archive[] }>("/admin/archives").then((result) => result.archives);

export const fetchReminders = () =>
  request<{ reminders: Reminder[] }>("/admin/reminders").then((result) => result.reminders);

export const fetchAnnouncementTargets = () =>
  request<{ conversations: { targetType: "conversation"; id: number; title: string }[] }>(
    "/admin/bot/targets?type=conversation",
  ).then((result) => result.conversations);

export const setReminderActive = (reminderId: number, isActive: boolean) =>
  request(`/admin/bot/reminders/${reminderId}/active`, json("PATCH", { isActive }));

export type ReminderAttachmentInput = { file: File; mode: "compressed" | "file" } | null;

async function sendForm(path: string, method: string, form: FormData) {
  const session = readSession();
  const headers = new Headers();
  if (session) headers.set("Authorization", `Bearer ${session.token}`);
  const response = await fetch(`/api${path}`, { method, headers, body: form });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof payload["error"] === "string" ? payload["error"] : "REQUEST_FAILED",
    );
  }
  return payload;
}

function reminderForm(input: ReminderInput, attachment: ReminderAttachmentInput) {
  const form = new FormData();
  form.append("title", input.title);
  form.append("message", input.message);
  form.append("targetType", input.targetType);
  form.append("targetId", String(input.targetId));
  form.append("repeatDailyAt", input.repeatDailyAt);
  if (input.repeatDays) form.append("repeatDays", JSON.stringify(input.repeatDays));
  if (attachment) {
    form.append("file", attachment.file);
    form.append("mode", attachment.mode);
  }
  return form;
}

export const createReminder = (input: ReminderInput, attachment: ReminderAttachmentInput = null) =>
  sendForm("/admin/bot/reminders", "POST", reminderForm(input, attachment));

export const updateReminder = (reminderId: number, input: ReminderInput) =>
  request(`/admin/bot/reminders/${reminderId}`, json("PUT", input));

export function setReminderAttachment(reminderId: number, attachment: ReminderAttachmentInput) {
  const form = new FormData();
  if (attachment) {
    form.append("file", attachment.file);
    form.append("mode", attachment.mode);
  } else {
    form.append("remove", "true");
  }
  return sendForm(`/admin/bot/reminders/${reminderId}/attachment`, "PATCH", form);
}

export const deleteReminder = (reminderId: number) =>
  request(`/admin/bot/reminders/${reminderId}`, json("DELETE"));

export type Visibility = "public" | "private";

export const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: "public", label: "عمومی" },
  { value: "private", label: "خصوصی" },
];

export type SpaceDetails = {
  kind: SpaceKind;
  id: number;
  title: string;
  description: string;
  visibility: Visibility;
  avatarUrl: string | null;
  archived: boolean;
  link: { id: number; title: string } | null;
  linkOptions: { id: number; title: string }[];
};

export const PERMISSION_FIELDS: Record<SpaceKind, { key: string; label: string }[]> = {
  channel: [
    { key: "post", label: "ارسال پست در کانال" },
    { key: "edit_info", label: "ویرایش اطلاعات و عکس کانال" },
    { key: "delete_messages", label: "حذف پست‌های دیگران" },
    { key: "pin_messages", label: "سنجاق کردن پست‌ها" },
    { key: "manage_members", label: "افزودن و حذف اعضا" },
    { key: "manage_admins", label: "ارتقا و تنزل مدیران فضا" },
    { key: "manage_link", label: "مدیریت پیوند به گروه" },
  ],
  group: [
    { key: "send_messages", label: "ارسال پیام در گروه" },
    { key: "edit_info", label: "ویرایش اطلاعات و عکس گروه" },
    { key: "delete_messages", label: "حذف پیام‌های دیگران" },
    { key: "pin_messages", label: "سنجاق کردن پیام‌ها" },
    { key: "manage_members", label: "افزودن و حذف اعضا" },
    { key: "manage_admins", label: "ارتقا و تنزل مدیران فضا" },
    { key: "manage_link", label: "مدیریت پیوند به کانال" },
  ],
};

export type FileScope = "conversation" | "channel" | "group" | "reminder";

export type SystemFile = {
  id: number;
  name: string;
  scope: FileScope;
  place: string;
  sender: string;
  size: string;
  at: string;
  mimeType: string | null;
  messageDeleted: boolean;
};

export type DeadLetter = {
  id: number;
  channel: string;
  group: string;
  error: string;
  attempts: number;
  at: string;
};

export type ForwardQueue = {
  available: boolean;
  depths: { pending: number; processing: number; delayed: number; dead: number };
  deadLetters: DeadLetter[];
};

export const fetchSpaceDetails = (space: Pick<Space, "kind" | "id">) =>
  request<{ space: SpaceDetails }>(spacePath(space)).then((result) => result.space);

export const updateSpaceInfo = (
  space: Pick<Space, "kind" | "id">,
  input: { title: string; description: string; visibility: Visibility },
) =>
  request<{ space: SpaceDetails }>(spacePath(space), json("PUT", input)).then(
    (result) => result.space,
  );

export const removeSpaceAvatar = (space: Pick<Space, "kind" | "id">) =>
  request(`${spacePath(space)}/avatar`, json("DELETE"));

export const linkSpace = (space: Pick<Space, "kind" | "id">, targetId: number) =>
  request<{ space: SpaceDetails }>(`${spacePath(space)}/link`, json("PUT", { targetId })).then(
    (result) => result.space,
  );

export const unlinkSpace = (space: Pick<Space, "kind" | "id">) =>
  request<{ space: SpaceDetails }>(`${spacePath(space)}/link`, json("DELETE")).then(
    (result) => result.space,
  );

export const setMemberPermissions = (
  space: Pick<Space, "kind" | "id">,
  userId: number,
  permissions: Record<string, boolean>,
) => request(`${spacePath(space)}/members/${userId}/permissions`, json("PATCH", { permissions }));

export const deleteSpace = (space: Pick<Space, "kind" | "id">, confirmTitle: string) =>
  request(spacePath(space), json("DELETE", { confirmTitle }));

export function fetchSystemFiles(scope: FileScope | "all", search: string) {
  const params = new URLSearchParams();
  if (scope !== "all") params.set("scope", scope);
  if (search.trim()) params.set("search", search.trim());
  const query = params.toString();
  return request<{ files: SystemFile[] }>(`/admin/files${query ? `?${query}` : ""}`).then(
    (result) => result.files,
  );
}

export const deleteSystemFile = (fileId: number) =>
  request<{ deleted: boolean; backupCopyRemoved: boolean; backupMirrorConfigured: boolean }>(
    `/admin/files/${fileId}`,
    json("DELETE"),
  );

export const fetchForwardQueue = () => request<ForwardQueue>("/admin/forward-queue");

export const retryForward = (deadLetterId: number) =>
  request(`/admin/forward-queue/${deadLetterId}/retry`, json("POST"));

export const discardForward = (deadLetterId: number) =>
  request(`/admin/forward-queue/${deadLetterId}`, json("DELETE"));

async function authorizedFetch(path: string, init: RequestInit = {}) {
  const session = readSession();
  const headers = new Headers(init.headers);
  if (session) headers.set("Authorization", `Bearer ${session.token}`);
  const response = await fetch(`/api${path.replace(/^\/api/, "")}`, { ...init, headers });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiError(
      response.status,
      typeof payload["error"] === "string" ? payload["error"] : "REQUEST_FAILED",
    );
  }
  return response;
}

export async function uploadSpaceAvatar(space: Pick<Space, "kind" | "id">, file: File) {
  const body = new FormData();
  body.append("avatar", file);
  const response = await authorizedFetch(`${spacePath(space)}/avatar`, { method: "POST", body });
  return ((await response.json()) as { avatarUrl: string }).avatarUrl;
}

export async function fetchImageUrl(path: string) {
  const response = await authorizedFetch(path);
  return URL.createObjectURL(await response.blob());
}

export async function downloadFile(path: string, fallbackName: string) {
  const response = await authorizedFetch(path);
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  const name = encoded ? decodeURIComponent(encoded) : (plain ?? fallbackName);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
