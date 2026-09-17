import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { ManagerShell } from "@/components/manager/ManagerShell";
import { RequireRole } from "@/components/require-role";
import { TasksBoard } from "@/components/tasks/tasks-board";

export const Route = createFileRoute("/manager/tasks")({ component: ManagerTasksRoute });

function ManagerTasksRoute() {
  const navigate = useNavigate();
  return (
    <RequireRole roles={["management", "manager"]}>
      <ManagerShell flush title="وظایف تیم" subtitle="تعریف، پیگیری و تأیید کارهای تیم">
        <TasksBoard
          onOpenConversation={(conversationId) =>
            void navigate({
              to: "/manager/chat",
              search: { t: "conversation", i: conversationId },
            })
          }
        />
      </ManagerShell>
    </RequireRole>
  );
}
