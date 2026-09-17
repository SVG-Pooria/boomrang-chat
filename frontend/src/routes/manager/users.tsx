import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ManagerShell } from "@/components/manager/ManagerShell";
import { RequireRole } from "@/components/require-role";
import { UsersConsole } from "@/components/team/users-console";
import { UsersView } from "@/components/workspace/users-view";
import { readSession } from "@/lib/auth";
import { openDirectConversation } from "@/lib/chat";
import { useI18n } from "@/lib/i18n";
import { fetchDirectory, type Person } from "@/lib/workspace";

export const Route = createFileRoute("/manager/users")({ component: ManagerUsersRoute });

function ManagerUsersRoute() {
  return (
    <RequireRole roles={["management", "manager"]}>
      <ManagerUsers />
    </RequireRole>
  );
}

function ManagerUsers() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const session = readSession();
  const [people, setPeople] = useState<Person[]>([]);
  const executive = session?.user.role === "management";

  const openChat = async (userId: number) => {
    try {
      const { conversation } = await openDirectConversation(userId);
      await navigate({ to: "/manager/chat", search: { t: "conversation", i: conversation.id } });
    } catch {
      toast.error(t("شروع گفتگو ناموفق بود"));
    }
  };

  useEffect(() => {
    if (executive) return;
    fetchDirectory()
      .then(setPeople)
      .catch(() => toast.error(t("بارگذاری فهرست کاربران ناموفق بود")));
  }, [executive, t]);

  return (
    <ManagerShell flush title="کاربران" subtitle="فهرست همکاران سازمان">
      {executive ? (
        <UsersConsole onOpenChat={(userId) => void openChat(userId)} />
      ) : (
        <UsersView
          people={people}
          viewerId={session?.user.id ?? null}
          viewerRole={session?.user.role ?? "manager"}
          onStartChat={(person) => openChat(person.userId)}
          onRequestChat={async () => {
            toast.error(t("این گزینه برای شما فعال نیست"));
          }}
        />
      )}
    </ManagerShell>
  );
}
