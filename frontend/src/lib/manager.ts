import { request } from "@/lib/auth";
import { useLiveResource } from "@/lib/live-resource";
import type { Task } from "@/lib/workspace";
import type { Tone } from "@/components/manager/ui";

export type TeamStatus = "online" | "meeting" | "away" | "leave";

export const statusLabels: Record<TeamStatus, string> = {
  online: "در دسترس",
  meeting: "در جلسه",
  away: "کمی دور",
  leave: "مرخصی",
};

export type ManagerProfile = {
  manager: {
    name: string;
    initials: string;
    unit: string | null;
    jobTitle: string | null;
    role: string;
    roleLabel: string;
  };
  badges: { inbox: number; tasks: number };
};

export type Kpi = {
  key: string;
  label: string;
  value: string;
  hint: string;
  tone: Tone;
  icon: "inbox" | "stamp" | "tasks" | "team";
};

export type ManagerRequest = {
  id: string;
  requestId: number;
  title: string;
  person: string;
  unit: string;
  time: string;
  stage: string;
  priority: string;
  tone: Tone;
};

export type InboxRequest = ManagerRequest & {
  type: string;
  requesterId: number;
  status: "pending" | "approved" | "rejected" | "referred";
  canDecide: boolean;
  details: string;
  steps: { step: string; who: string; done: boolean }[];
  nextStep: string | null;
};

export type TeamMember = {
  userId: number;
  name: string;
  role: string;
  initials: string;
  status: TeamStatus;
  load: number;
  open: number;
  tone: Tone;
};

export type TimelineEntry = { who: string; what: string; when: string; tone: Tone };

export type UpcomingMeeting = {
  meetingId: number;
  title: string;
  time: string;
  people: string;
  tone: Tone;
};

export type Overview = {
  kpis: Kpi[];
  requests: ManagerRequest[];
  timeline: TimelineEntry[];
  meetings: UpcomingMeeting[];
  team: TeamMember[];
};

export type InboxData = {
  requests: InboxRequest[];
  openCount: number;
  metrics: { label: string; value: string; tone: Tone }[];
};

export type BoardColumn = {
  column: string;
  status: Task["status"];
  tone: Tone;
  items: { taskId: number; title: string; owner: string; due: string; tag: string | null }[];
};

export type BoardData = {
  unit: string;
  activeCount: number;
  dueToday: number;
  columns: BoardColumn[];
  assignees: { userId: number; name: string }[];
};

export type LeaveEntry = { key: string; name: string; note: string; tone: Tone; label: string };

export type TeamData = {
  unit: string;
  team: TeamMember[];
  total: number;
  available: number;
  leaves: LeaveEntry[];
};

export type Space = {
  targetType: "channel" | "group";
  targetId: number;
  name: string;
  type: "کانال" | "گروه";
  members: string;
  activity: string;
  tone: Tone;
  pinned: boolean;
};

export type SpacesData = {
  spaces: Space[];
  joinRequests: { who: string; where: string; tone: Tone }[];
  rules: { label: string; value: string }[];
};

export type SummaryReport = {
  reportId: number;
  title: string;
  targetType: "conversation" | "channel" | "group";
  targetId: number;
  targetName: string;
  sender: string;
  senderId: number | null;
  bullets: string[];
  messageCount: number;
  time: string;
  createdAt: string;
};

export type ReportsData = {
  unit: string;
  summaries: SummaryReport[];
  weekly: { label: string; value: number }[];
  metrics: { label: string; value: string; delta: string; tone: Tone }[];
  contributions: { userId: number; name: string; value: number; tone: Tone }[];
};

export type TeamPermission = { key: string; label: string };

export type TeamMemberRecord = {
  userId: number;
  name: string;
  phone: string;
  jobTitle: string | null;
  unit: string | null;
  presence: "online" | "away" | "offline";
  lastSeen: string;
  neverSignedIn: boolean;
  initials: string;
  role: "employee" | "manager" | "management" | "super_admin";
  roleLabel: string;
  tagId: number | null;
  tag: string | null;
  managerId: number | null;
  manager: string | null;
  avatarUrl: string | null;
  permissions: string[];
  roleGrantsAll: boolean;
};

export type TeamMembersData = {
  members: TeamMemberRecord[];
  tags: { tagId: number; name: string }[];
  permissions: TeamPermission[];
  capabilities: {
    scheduleMeetings: boolean;
    assignTasks: boolean;
    manageTeam: boolean;
    executive: boolean;
  };
};

let lastProfile: ManagerProfile | null = null;

export const fetchManagerProfile = () =>
  request<ManagerProfile>("/manager/profile").then((profile) => {
    lastProfile = profile;
    return profile;
  });

export const knownManagerProfile = () => lastProfile;
export const fetchOverview = () => request<Overview>("/manager/overview");
export const fetchInbox = () => request<InboxData>("/manager/inbox");
export const fetchBoard = () => request<BoardData>("/manager/tasks");
export const fetchTeam = () => request<TeamData>("/manager/team");
export const fetchSpaces = () => request<SpacesData>("/manager/spaces");
export const fetchReports = () => request<ReportsData>("/manager/reports");

export const fetchTeamMembers = () => request<TeamMembersData>("/manager/team/members");

export function setMemberTag(userId: number, tagId: number | null) {
  return request<{ members: TeamMemberRecord[] }>(`/manager/team/${userId}/tag`, {
    method: "POST",
    body: JSON.stringify({ tagId }),
  });
}

export function setMemberTitle(userId: number, jobTitle: string) {
  return request<{ members: TeamMemberRecord[] }>(`/manager/team/${userId}/title`, {
    method: "POST",
    body: JSON.stringify({ jobTitle }),
  });
}

export function setMemberPermission(userId: number, permission: string, enabled: boolean) {
  return request<{ members: TeamMemberRecord[] }>(`/manager/team/${userId}/permission`, {
    method: "POST",
    body: JSON.stringify({ permission, enabled }),
  });
}

export function setMemberRole(userId: number, role: "employee" | "manager") {
  return request<{ members: TeamMemberRecord[] }>(`/manager/team/${userId}/role`, {
    method: "POST",
    body: JSON.stringify({ role }),
  });
}

export function createSpace(
  kind: "channel" | "group",
  input: { title: string; description?: string; visibility?: "public" | "private" },
) {
  return request<{ channel?: { id: number }; group?: { id: number } }>(
    kind === "channel" ? "/channels" : "/groups",
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function setSpacePinned(space: Space, pinned: boolean) {
  return request<{ pinned: boolean }>(`/manager/spaces/${space.targetType}/${space.targetId}/pin`, {
    method: "POST",
    body: JSON.stringify({ pinned }),
  });
}

export const WORKSPACE_EVENTS = ["workspace:changed"] as const;
export const PRESENCE_EVENTS = ["workspace:changed", "presence:update"] as const;
export const SPACE_EVENTS = ["manager:spaces"] as const;

export function useManagerResource<T>(load: () => Promise<T>, events: readonly string[]) {
  return useLiveResource(load, events, "بارگذاری اطلاعات پنل ناموفق بود");
}
