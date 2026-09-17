export type UserRole = "employee" | "manager" | "management" | "super_admin";

export type SessionUser = {
  id: number;
  fullName: string;
  role: UserRole;
  phone: string;
  tagId: number | null;
  tagName: string | null;
  avatarUrl?: string | null;
};

export type Session = {
  token: string;
  user: SessionUser;
};

const STORAGE_KEY = "boomrang.session";

const SESSION_ENDED_ERRORS = new Set(["INVALID_TOKEN", "SESSION_REVOKED", "ACCOUNT_DISABLED"]);

export const HOME_PATH: Record<UserRole, string> = {
  employee: "/",
  manager: "/manager",
  management: "/manager",
  super_admin: "/admin",
};

export function readSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.token || !parsed?.user?.role) return null;
    return parsed;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export const SESSION_EVENT = "boomrang:session";

export function writeSession(session: Session) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function updateSessionUser(patch: Partial<SessionUser>) {
  const session = readSession();
  if (!session) return;
  writeSession({ ...session, user: { ...session.user, ...patch } });
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export class ApiError extends Error {
  status: number;
  retryAfterSeconds: number | null;

  constructor(status: number, code: string, retryAfterSeconds: number | null = null) {
    super(code);
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = readSession();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (session) headers.set("Authorization", `Bearer ${session.token}`);

  const response = await fetch(`/api${path}`, { ...init, headers });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const retryAfter = payload["retryAfterSeconds"];
    const code = typeof payload["error"] === "string" ? payload["error"] : "INTERNAL_ERROR";
    if (response.status === 401 && session && SESSION_ENDED_ERRORS.has(code)) {
      clearSession();
      window.location.assign("/login");
    }
    throw new ApiError(response.status, code, typeof retryAfter === "number" ? retryAfter : null);
  }

  return payload as T;
}

type LoginResponse =
  { needsSetup: true } | { token: string; user: SessionUser; mustChangePassword: boolean };

export async function login(phone: string, password: string) {
  const result = await request<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone, password }),
  });

  if ("needsSetup" in result) return { needsSetup: true as const };

  const session: Session = { token: result.token, user: result.user };
  writeSession(session);
  return { needsSetup: false as const, session };
}

export type Capabilities = {
  scheduleMeetings: boolean;
  assignTasks: boolean;
  manageTeam: boolean;
  executive: boolean;
};

export function fetchCurrentUser() {
  return request<{ user: SessionUser; capabilities: Capabilities }>("/auth/me");
}
