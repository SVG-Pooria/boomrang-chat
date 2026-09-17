import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { ManagerShell } from "@/components/manager/ManagerShell";
import { RequireRole } from "@/components/require-role";
import { TeamManager } from "@/components/team/team-manager";

export const Route = createFileRoute("/manager/team")({ component: ManagerTeamRoute });

function ManagerTeamRoute() {
  const navigate = useNavigate();
  return (
    <RequireRole roles={["management", "manager"]}>
      <ManagerShell fit title="تیم من" subtitle="نقش، برچسب و دسترسی‌های اعضای تیم">
        <TeamManager
          onOpenChat={(conversationId) =>
            void navigate({ to: "/manager/chat", search: { t: "conversation", i: conversationId } })
          }
        />
      </ManagerShell>
    </RequireRole>
  );
}
