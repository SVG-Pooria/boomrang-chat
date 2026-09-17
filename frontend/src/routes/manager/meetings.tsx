import { createFileRoute } from "@tanstack/react-router";

import { ManagerShell } from "@/components/manager/ManagerShell";
import { MeetingsBoard } from "@/components/meetings/meetings-board";
import { RequireRole } from "@/components/require-role";

export const Route = createFileRoute("/manager/meetings")({ component: ManagerMeetingsRoute });

function ManagerMeetingsRoute() {
  return (
    <RequireRole roles={["management", "manager"]}>
      <ManagerShell flush title="جلسات" subtitle="زمان‌بندی جلسه‌ها و بررسی حضور">
        <MeetingsBoard />
      </ManagerShell>
    </RequireRole>
  );
}
