import { useEffect, useState } from "react";

import {
  ApiError,
  SESSION_EVENT,
  fetchCurrentUser,
  readSession,
  request,
  updateSessionUser,
  type Capabilities,
  type SessionUser,
} from "@/lib/auth";
import { forgetImage } from "@/lib/images";

const EMPTY_CAPABILITIES: Capabilities = {
  scheduleMeetings: false,
  assignTasks: false,
  manageTeam: false,
  executive: false,
};

let capabilities: Capabilities = EMPTY_CAPABILITIES;
let accountLoad: Promise<void> | null = null;
const CAPABILITY_EVENT = "boomrang:capabilities";

export function refreshAccount() {
  if (!readSession()) return Promise.resolve();
  accountLoad = fetchCurrentUser()
    .then((result) => {
      updateSessionUser(result.user);
      capabilities = result.capabilities;
      window.dispatchEvent(new Event(CAPABILITY_EVENT));
    })
    .catch(() => undefined)
    .finally(() => {
      accountLoad = null;
    });
  return accountLoad;
}

export function useAccount() {
  const [user, setUser] = useState<SessionUser | null>(() => readSession()?.user ?? null);
  const [caps, setCaps] = useState<Capabilities>(capabilities);

  useEffect(() => {
    const syncUser = () => setUser(readSession()?.user ?? null);
    const syncCaps = () => setCaps(capabilities);
    window.addEventListener(SESSION_EVENT, syncUser);
    window.addEventListener("storage", syncUser);
    window.addEventListener(CAPABILITY_EVENT, syncCaps);
    if (!accountLoad && capabilities === EMPTY_CAPABILITIES) void refreshAccount();
    return () => {
      window.removeEventListener(SESSION_EVENT, syncUser);
      window.removeEventListener("storage", syncUser);
      window.removeEventListener(CAPABILITY_EVENT, syncCaps);
    };
  }, []);

  return { user, capabilities: caps };
}

export async function uploadMyAvatar(blob: Blob) {
  const session = readSession();
  const form = new FormData();
  form.append("avatar", blob, "avatar.jpg");
  const response = await fetch("/api/avatars/user/me", {
    method: "POST",
    headers: session ? { Authorization: `Bearer ${session.token}` } : {},
    body: form,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    avatarUrl?: string;
    error?: string;
  };
  if (!response.ok) throw new ApiError(response.status, payload.error ?? "UPLOAD_FAILED");
  forgetImage(session?.user.avatarUrl);
  updateSessionUser({ avatarUrl: payload.avatarUrl ?? null });
  return payload.avatarUrl ?? null;
}

export async function removeMyAvatar() {
  const previous = readSession()?.user.avatarUrl;
  await request("/avatars/user/me", { method: "DELETE" });
  forgetImage(previous);
  updateSessionUser({ avatarUrl: null });
}

export function changeMyPassword(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}) {
  return request<{ success: boolean }>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type PersonalStatus = {
  dndEnabled: boolean;
  dndLabel: string | null;
  dndUntil: string | null;
};

export function fetchMyStatus() {
  return request<PersonalStatus>("/users/me/status");
}

export function saveMyStatus(input: {
  enabled: boolean;
  label?: string | null;
  until?: string | null;
}) {
  return request<PersonalStatus>("/users/me/status", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export type ChatPreferences = {
  bubbleColor: string | null;
  fontSize: "small" | "medium" | "large";
  autoImagePreview: boolean;
  notificationSound: string;
  sidebarCollapsed: boolean;
  theme: "light" | "dark";
};

export function fetchPreferences() {
  return request<ChatPreferences>("/preferences/me");
}

export function savePreferences(patch: Partial<ChatPreferences>) {
  return request<ChatPreferences>("/preferences/me", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
