import { request } from "@/lib/auth";
import type { TaskCapabilities } from "@/lib/tasks";

export type MeetingScope = "participant" | "organizer" | "all";
export type MeetingStatus = "امروز" | "آینده" | "برگزار شده" | "لغو شده";

export type MeetingParticipant = {
  userId: number;
  name: string;
  initials: string;
  confirmed: boolean;
  attended: boolean;
};

export type MeetingItem = {
  id: string;
  meetingId: number;
  ownerId: number | null;
  organizer: string;
  title: string;
  description: string | null;
  location: string;
  startsAt: string;
  endsAt: string;
  time: string;
  jalali: string;
  room: string;
  participants: MeetingParticipant[];
  attendeeCount: number;
  confirmedCount: number;
  attendedCount: number;
  status: MeetingStatus;
  canceled: boolean;
  minutes?: string[];
  decisions?: number;
  actions?: number;
};

export function fetchMeetings(scope: MeetingScope) {
  return request<{ meetings: MeetingItem[]; scope: MeetingScope; capabilities: TaskCapabilities }>(
    `/meetings?scope=${scope}`,
  );
}

export function createMeeting(input: {
  title: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  description?: string;
  attendeeIds: number[];
}) {
  return request<{ meeting: MeetingItem }>("/meetings", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateMeeting(
  meetingId: number,
  patch: {
    title?: string;
    startsAt?: string;
    endsAt?: string;
    location?: string;
    description?: string;
    attendeeIds?: number[];
  },
) {
  return request<{ meeting: MeetingItem }>(`/meetings/${meetingId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function cancelMeeting(meetingId: number) {
  return request<{ meeting: MeetingItem }>(`/meetings/${meetingId}/cancel`, { method: "POST" });
}

export function confirmAttendance(meetingId: number, confirmed: boolean) {
  return request<{ meeting: MeetingItem }>(`/meetings/${meetingId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ confirmed }),
  });
}

export function markAttendance(meetingId: number, attendedIds: number[]) {
  return request<{ meeting: MeetingItem }>(`/meetings/${meetingId}/attendance`, {
    method: "POST",
    body: JSON.stringify({ attendedIds }),
  });
}

export function saveMinutes(meetingId: number, minutes: string[], actionsCount: number) {
  return request<{ meeting: MeetingItem }>(`/meetings/${meetingId}/minutes`, {
    method: "POST",
    body: JSON.stringify({ minutes, actionsCount }),
  });
}
