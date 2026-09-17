import { useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { HOME_PATH, readSession, type UserRole } from "@/lib/auth";

export function RequireRole({
  roles,
  children,
}: {
  roles: ReadonlyArray<UserRole>;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const session = readSession();
  const allowed = session !== null && roles.includes(session.user.role);

  useEffect(() => {
    if (allowed) return;
    navigate({ to: session ? HOME_PATH[session.user.role] : "/login", replace: true });
  }, [allowed, navigate, session]);

  return allowed ? <>{children}</> : null;
}

export function RedirectSignedIn({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const session = readSession();

  useEffect(() => {
    if (!session) return;
    navigate({ to: HOME_PATH[session.user.role], replace: true });
  }, [navigate, session]);

  return session ? null : <>{children}</>;
}
