import { createFileRoute } from "@tanstack/react-router";

import { ApprovalsBoard } from "@/components/approvals/approvals-board";
import { ManagerShell } from "@/components/manager/ManagerShell";
import { RequireRole } from "@/components/require-role";

export const Route = createFileRoute("/manager/inbox")({ component: ManagerInboxRoute });

function ManagerInboxRoute() {
  return (
    <RequireRole roles={["management", "manager"]}>
      <ManagerShell flush title="کارتابل" subtitle="درخواست‌های در انتظار تصمیم شما">
        <ApprovalsBoard />
      </ManagerShell>
    </RequireRole>
  );
}
