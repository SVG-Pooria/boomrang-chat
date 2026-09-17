import type { UserRole } from "@/lib/auth";

export const ROLE_LABELS: Record<UserRole, string> = {
  employee: "کارمند",
  manager: "مدیر",
  management: "هیئت مدیره",
  super_admin: "ادمین کل",
};

export const ROLE_ORDER: Record<UserRole, number> = {
  super_admin: 0,
  management: 1,
  manager: 2,
  employee: 3,
};

export function isExecutive(role: UserRole | undefined) {
  return role === "management" || role === "super_admin";
}

export function isLeader(role: UserRole | undefined) {
  return role === "manager" || isExecutive(role);
}
