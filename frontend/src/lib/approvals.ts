import { request } from "@/lib/auth";
import type { TaskCapabilities } from "@/lib/tasks";

export type ApprovalPriority = "فوری" | "بالا" | "عادی";
export type ApprovalDecision = "تأیید" | "رد" | "ارجاع";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "referred";
export type ReferralStatus = "pending" | "accepted" | "declined" | "done" | "failed";

export const APPROVAL_PRIORITIES: ApprovalPriority[] = ["فوری", "بالا", "عادی"];

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: "در جریان",
  approved: "تأیید شده",
  rejected: "رد شده",
  referred: "برگشت خورده",
};

export type RequestType = {
  typeId: number;
  name: string;
  description: string | null;
  needsAmount: boolean;
  needsPeriod: boolean;
  isActive: boolean;
  usageCount?: number;
};

export type ApprovalItem = {
  id: string;
  requestId: number;
  title: string;
  description: string | null;
  requester: string;
  requesterId: number | null;
  initials: string;
  type: string;
  date: string;
  deadline: string;
  priority: ApprovalPriority;
  step: number;
  totalSteps: number;
  stepName: string;
  fromChat: string;
  status: ApprovalStatus;
  canDecide: boolean;
  amount?: string;
};

export type Referral = {
  referralId: number;
  requestId: number;
  requestTitle: string;
  requestType: string;
  requester: string;
  assigneeId: number;
  assignee: string;
  assigneeInitials: string;
  referredById: number | null;
  referredBy: string;
  conversationId: number | null;
  note: string | null;
  status: ReferralStatus;
  statusLabel: string;
  resultNote: string | null;
  respondedAt: string | null;
  createdAt: string;
};

export function fetchApprovals() {
  return request<{
    approvals: ApprovalItem[];
    pendingForMe: number;
    referrals: Referral[];
    types: RequestType[];
    capabilities: TaskCapabilities;
  }>("/approvals");
}

export function fetchRequestTypes(includeInactive = false) {
  return request<{ types: RequestType[] }>(`/approvals/types${includeInactive ? "?all=1" : ""}`);
}

export function createRequestType(input: {
  name: string;
  description?: string;
  needsAmount?: boolean;
  needsPeriod?: boolean;
}) {
  return request<{ type: RequestType }>("/approvals/types", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateRequestType(
  typeId: number,
  patch: { description?: string; needsAmount?: boolean; needsPeriod?: boolean; isActive?: boolean },
) {
  return request<{ type: RequestType }>(`/approvals/types/${typeId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteRequestType(typeId: number) {
  return request<{ deleted?: boolean; type?: RequestType }>(`/approvals/types/${typeId}`, {
    method: "DELETE",
  });
}

export function createApproval(input: {
  title: string;
  type: string;
  description?: string;
  priority?: ApprovalPriority;
  amountRials?: number | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  deadlineAt?: string | null;
}) {
  return request<{ approval: ApprovalItem }>("/approvals", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function decideApproval(requestId: number, decision: ApprovalDecision, note?: string) {
  return request<{ approval: ApprovalItem; signature: string }>(
    `/approvals/${requestId}/decision`,
    {
      method: "POST",
      body: JSON.stringify({ decision, ...(note ? { note } : {}) }),
    },
  );
}

export function fetchRequestReferrals(requestId: number) {
  return request<{ referrals: Referral[] }>(`/approvals/${requestId}/referrals`);
}

export function referApproval(requestId: number, assigneeId: number, note: string) {
  return request<{ referral: Referral; conversationId: number }>(`/approvals/${requestId}/refer`, {
    method: "POST",
    body: JSON.stringify({ assigneeId, note }),
  });
}

export function respondReferral(referralId: number, accepted: boolean) {
  return request<{ referral: Referral }>(`/approvals/referrals/${referralId}/respond`, {
    method: "POST",
    body: JSON.stringify({ accepted }),
  });
}

export function reportReferral(referralId: number, done: boolean, note?: string) {
  return request<{ referral: Referral }>(`/approvals/referrals/${referralId}/result`, {
    method: "POST",
    body: JSON.stringify({ done, ...(note ? { note } : {}) }),
  });
}
