import { readSession, request } from "@/lib/auth";

export type TaskStatus = "در انتظار" | "در حال انجام" | "بررسی" | "انجام شد";
export type TaskPriority = "فوری" | "بالا" | "عادی";

export const TASK_STATUSES: TaskStatus[] = ["در انتظار", "در حال انجام", "بررسی", "انجام شد"];
export const TASK_PRIORITIES: TaskPriority[] = ["فوری", "بالا", "عادی"];

export type TaskFile = {
  id: number;
  mode: string;
  mimeType: string | null;
  sizeBytes: number | null;
  originalName: string | null;
};

export type TaskReport = {
  reportId: number;
  body: string;
  kind: "progress" | "review" | "system";
  author: string;
  authorId: number | null;
  initials: string;
  createdAt: string;
  files: TaskFile[];
};

export type TaskItem = {
  id: string;
  taskId: number;
  title: string;
  description: string | null;
  owner: string;
  ownerId: number | null;
  initials: string;
  due: string;
  dueAt: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  source: string;
  progress: number;
  tag: string | null;
  assigner: string;
  assignerId: number | null;
  assignerRole: string | null;
  createdAt: string;
  acceptedAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  reportCount: number;
};

export type TaskCapabilities = {
  scheduleMeetings: boolean;
  assignTasks: boolean;
  manageTeam: boolean;
  executive: boolean;
};

export type TaskCounts = Record<TaskStatus, number>;

export function fetchTasks() {
  return request<{ tasks: TaskItem[]; counts: TaskCounts; capabilities: TaskCapabilities }>(
    "/tasks",
  );
}

export function createTask(input: {
  title: string;
  description?: string;
  ownerId: number;
  dueAt?: string | null;
  priority?: TaskPriority;
  tag?: string | null;
}) {
  return request<{ task: TaskItem }>("/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTask(
  taskId: number,
  patch: {
    title?: string;
    description?: string;
    dueAt?: string | null;
    priority?: TaskPriority;
    tag?: string | null;
  },
) {
  return request<{ task: TaskItem }>(`/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function acceptTask(taskId: number) {
  return request<{ task: TaskItem }>(`/tasks/${taskId}/accept`, { method: "POST" });
}

export function submitTask(taskId: number) {
  return request<{ task: TaskItem }>(`/tasks/${taskId}/submit`, { method: "POST" });
}

export function reviewTask(taskId: number, approved: boolean, note?: string) {
  return request<{ task: TaskItem }>(`/tasks/${taskId}/review`, {
    method: "POST",
    body: JSON.stringify({ approved, ...(note ? { note } : {}) }),
  });
}

export function setTaskProgress(taskId: number, progress: number) {
  return request<{ task: TaskItem }>(`/tasks/${taskId}/progress`, {
    method: "POST",
    body: JSON.stringify({ progress }),
  });
}

export function fetchTaskReports(taskId: number) {
  return request<{ reports: TaskReport[] }>(`/tasks/${taskId}/reports`);
}

export function addTaskReport(taskId: number, body: string, allowEmpty = false) {
  return request<{ report: TaskReport }>(`/tasks/${taskId}/reports`, {
    method: "POST",
    body: JSON.stringify({ body, allowEmpty }),
  });
}

export async function uploadTaskReportFile(
  taskId: number,
  reportId: number,
  file: File,
  mode: "compressed" | "file",
) {
  const session = readSession();
  const form = new FormData();
  form.append("file", file);
  form.append("mode", mode);
  const headers = new Headers();
  if (session) headers.set("Authorization", `Bearer ${session.token}`);
  const response = await fetch(`/api/tasks/${taskId}/reports/${reportId}/files`, {
    method: "POST",
    headers,
    body: form,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload["error"] === "string" ? payload["error"] : "UPLOAD_FAILED");
  }
  return payload as { file: TaskFile };
}

export function openTaskChat(taskId: number, message: string) {
  return request<{ conversationId?: number; ticketId?: number }>(`/tasks/${taskId}/chat`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}
