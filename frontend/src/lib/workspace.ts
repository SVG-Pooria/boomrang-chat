import { request } from "@/lib/auth";
import type { ChatTarget } from "@/lib/chat";

export type Priority = "فوری" | "بالا" | "عادی";

export type SourceTargetType = "conversation" | "channel" | "group";

export type ApprovalItem = {
  id: string;
  requestId: number;
  title: string;
  requester: string;
  initials: string;
  type: "مرخصی" | "خرید" | "پرداخت" | "مرخصی ساعتی" | "مأموریت";
  amount?: string;
  date: string;
  deadline: string;
  priority: Priority;
  step: number;
  totalSteps: number;
  stepName: string;
  fromChat: string;
  status: "pending" | "approved" | "rejected" | "referred";
  canDecide: boolean;
  sourceTargetType: SourceTargetType | null;
  sourceTargetId: number | null;
};

export type Task = {
  id: string;
  taskId: number;
  title: string;
  owner: string;
  initials: string;
  due: string;
  status: "در انتظار" | "در حال انجام" | "بررسی" | "انجام شد";
  priority: Priority;
  source: string;
  progress: number;
  ownerId: number | null;
  sourceTargetType: SourceTargetType | null;
  sourceTargetId: number | null;
};

export type Meeting = {
  id: string;
  meetingId: number;
  ownerId: number | null;
  title: string;
  time: string;
  jalali: string;
  room: string;
  attendees: string[];
  status: "امروز" | "آینده" | "برگزار شده";
  minutes?: string[];
  decisions?: number;
  actions?: number;
  sourceTargetType: SourceTargetType | null;
  sourceTargetId: number | null;
};

export type Person = {
  userId: number;
  managerId: number | null;
  name: string;
  role: string;
  accountRole: "employee" | "manager" | "management";
  tag: string | null;
  avatarUrl: string | null;
  unit: string;
  initials: string;
  status: "آنلاین" | "در جلسه" | "مرخصی" | "خارج از ساعت کاری";
  phone: string;
  reportsTo?: string;
};

export type Announcement = {
  id: string;
  announcementId: number;
  title: string;
  body: string;
  author: string;
  time: string;
  tone: "هشدار" | "رسمی" | "عادی";
  seen: string;
  mustAck: boolean;
  acked: boolean;
};

export type ComplianceStat = { label: string; value: string; tone: string };
export type AuditEntry = { who: string; what: string; when: string; risk: "کم" | "متوسط" | "بالا" };

export type PollOption = {
  id: number;
  label: string;
  votes: number;
  votesLabel: string;
  percent: string;
};

export type Poll = {
  pollId: number;
  messageId: number | null;
  question: string;
  isClosed: boolean;
  createdBy: string;
  totalVotes: number;
  totalVotesLabel: string;
  myOptionId: number | null;
  options: PollOption[];
};

export type PanelFile = {
  fileId: number;
  name: string;
  size: string;
  type: "zip" | "mp4" | "pdf";
  mimeType: string | null;
  mode: string;
};

export type RelatedLink = { id: number; title: string; url: string; icon: string; addedBy: string };

export type ChannelPanel = {
  media: PanelFile[];
  vault: PanelFile[];
  links: RelatedLink[];
  polls: Poll[];
};

export type DigestBullet = {
  kind: "pinned" | "work" | "poll" | "files" | "question" | "activity" | "manual" | "insight";
  text: string;
  refMessageId: number | null;
};

export type Digest = {
  bullets: DigestBullet[];
  generatedAt: string;
  coveredFromMessageId: number | null;
  coveredToMessageId: number | null;
  messageCount: number;
  isManual: boolean;
};

export type WorkspaceData = {
  approvals: ApprovalItem[];
  pendingForMe: number;
  tasks: Task[];
  activeCount: number;
  meetings: Meeting[];
  upcomingCount: number;
  directory: Person[];
  announcements: Announcement[];
  pendingAck: number;
  stats: ComplianceStat[];
  auditLog: AuditEntry[];
};

export async function fetchWorkspace(): Promise<WorkspaceData> {
  const [approvals, tasks, meetings, directory, announcements, compliance] = await Promise.all([
    request<{ approvals: ApprovalItem[]; pendingForMe: number }>("/workspace/approvals"),
    request<{ tasks: Task[]; activeCount: number }>("/workspace/tasks"),
    request<{ meetings: Meeting[]; upcomingCount: number }>("/workspace/meetings"),
    request<{ directory: Person[] }>("/workspace/directory"),
    request<{ announcements: Announcement[]; pendingAck: number }>("/workspace/announcements"),
    request<{ stats: ComplianceStat[]; auditLog: AuditEntry[] }>("/workspace/compliance"),
  ]);

  return {
    approvals: approvals.approvals,
    pendingForMe: approvals.pendingForMe,
    tasks: tasks.tasks,
    activeCount: tasks.activeCount,
    meetings: meetings.meetings,
    upcomingCount: meetings.upcomingCount,
    directory: directory.directory,
    announcements: announcements.announcements,
    pendingAck: announcements.pendingAck,
    stats: compliance.stats,
    auditLog: compliance.auditLog,
  };
}

export function fetchAnnouncements() {
  return request<{ announcements: Announcement[]; pendingAck: number }>("/workspace/announcements");
}

export function fetchDirectory() {
  return request<{ directory: Person[] }>("/workspace/directory").then(
    (result) => result.directory,
  );
}

export function decideApproval(
  requestId: number,
  decision: "تأیید" | "رد" | "ارجاع",
  note?: string,
) {
  return request<{ approval: ApprovalItem; signature: string }>(
    `/workspace/approvals/${requestId}/decision`,
    { method: "POST", body: JSON.stringify({ decision, note }) },
  );
}

export function createApproval(input: {
  title: string;
  type: ApprovalItem["type"];
  priority?: Priority;
  target?: ChatTarget | null;
}) {
  return request<{ approval: ApprovalItem }>("/workspace/approvals", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      type: input.type,
      priority: input.priority ?? "عادی",
      ...targetSource(input.target),
    }),
  });
}

export function createTask(input: {
  title: string;
  sourceDescription?: string;
  priority?: Priority;
  target?: ChatTarget | null;
  ownerId?: number | undefined;
  status?: Task["status"] | undefined;
  tag?: string | undefined;
  dueAt?: string | undefined;
}) {
  return request<{ task: Task }>("/workspace/tasks", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      sourceDescription: input.sourceDescription,
      priority: input.priority ?? "عادی",
      ownerId: input.ownerId,
      status: input.status,
      tag: input.tag,
      dueAt: input.dueAt,
      ...targetSource(input.target),
    }),
  });
}

export function updateTask(taskId: number, patch: { status?: Task["status"]; progress?: number }) {
  return request<{ task: Task }>(`/workspace/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function createMeeting(input: {
  title: string;
  startsAt: string;
  endsAt: string;
  target?: ChatTarget | null;
}) {
  return request<{ meeting: Meeting }>("/workspace/meetings", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      ...targetSource(input.target),
    }),
  });
}

export function acknowledgeAnnouncement(announcementId: number) {
  return request<{ success: boolean }>(`/workspace/announcements/${announcementId}/ack`, {
    method: "POST",
  });
}

function targetSource(target: ChatTarget | null | undefined) {
  if (!target) return {};
  return {
    sourceTargetType: target.type === "direct" ? "conversation" : target.type,
    sourceTargetId: target.id,
  };
}

function panelPath(target: ChatTarget) {
  const type = target.type === "direct" ? "conversation" : target.type;
  return `/channel-files/${type}/${target.id}`;
}

export function fetchChannelPanel(target: ChatTarget) {
  return request<ChannelPanel>(panelPath(target));
}

export function addRelatedLink(target: ChatTarget, title: string, url: string) {
  return request<{ linkId: number }>(`${panelPath(target)}/links`, {
    method: "POST",
    body: JSON.stringify({ title, url }),
  });
}

export function summaryTargetType(target: ChatTarget) {
  return target.type === "direct" ? "conversation" : target.type;
}

function summaryPath(target: ChatTarget) {
  return `/summaries/${summaryTargetType(target)}/${target.id}`;
}

export function fetchSummary(target: ChatTarget) {
  return request<{ summary: Digest | null }>(summaryPath(target));
}

export function publishSummary(target: ChatTarget, bullets: string[]) {
  return request<{ summary: Digest | null }>(`${summaryPath(target)}/publish`, {
    method: "POST",
    body: JSON.stringify({ bullets }),
  });
}

export function clearManualSummary(target: ChatTarget) {
  return request<{ summary: Digest | null }>(`${summaryPath(target)}/manual`, {
    method: "DELETE",
  });
}

export function createPoll(target: ChatTarget, question: string, options: string[]) {
  return request<{ poll: Poll }>(`${panelPath(target)}/polls`, {
    method: "POST",
    body: JSON.stringify({ question, options }),
  });
}

export function votePoll(pollId: number, optionId: number) {
  return request<{ poll: Poll }>(`/channel-files/polls/${pollId}/vote`, {
    method: "POST",
    body: JSON.stringify({ optionId }),
  });
}

export function saveMinutes(meetingId: number, minutes: string[], actionsCount: number) {
  return request<{ meeting: Meeting }>(`/workspace/meetings/${meetingId}/minutes`, {
    method: "POST",
    body: JSON.stringify({ minutes, actionsCount }),
  });
}

export function setLeave(userId: number, startDate: string, endDate: string) {
  return request<{ leave: unknown }>(`/workspace/directory/${userId}/leave`, {
    method: "POST",
    body: JSON.stringify({ startDate, endDate }),
  });
}

export function createAnnouncement(input: {
  title: string;
  body: string;
  tone: Announcement["tone"];
  mustAck: boolean;
}) {
  return request<{ announcementId: number }>("/workspace/announcements", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function mediaArchiveUrl(target: ChatTarget) {
  return `/api${panelPath(target)}/media-archive`;
}
