import { createFileRoute } from "@tanstack/react-router";
import {
  CalendarDays,
  FileSignature,
  ListChecks,
  Megaphone,
  MessageSquare,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ChatWorkspace, type JumpRequest } from "@/components/chat/chat-workspace";
import { GlobalSearch } from "@/components/chat/global-search";
import { RequireRole } from "@/components/require-role";
import { ApprovalsBoard } from "@/components/approvals/approvals-board";
import { MeetingsBoard } from "@/components/meetings/meetings-board";
import { AppShell, type RailItem } from "@/components/shell/app-shell";
import { TasksBoard } from "@/components/tasks/tasks-board";
import { UsersView } from "@/components/workspace/users-view";
import { AnnouncementsView, WorkspaceStatus } from "@/components/workspace/views";
import { ApiError, readSession } from "@/lib/auth";
import { getSocket, openDirectConversation, requestManagementChat } from "@/lib/chat";
import { useI18n } from "@/lib/i18n";
import {
  acknowledgeAnnouncement,
  fetchDirectory,
  fetchWorkspace,
  type WorkspaceData,
} from "@/lib/workspace";

export const Route = createFileRoute("/")({
  component: HomeRoute,
  head: () => ({
    meta: [
      { title: "بومرنگ — چت درون‌سازمانی" },
      { name: "description", content: "فضای گفتگوی داخلی تیم با طراحی مینیمال و شفاف" },
    ],
  }),
});

function HomeRoute() {
  return (
    <RequireRole roles={["employee"]}>
      <EmployeeHome />
    </RequireRole>
  );
}

type ModuleId = "chat" | "users" | "approvals" | "tasks" | "meetings" | "announcements";

function EmployeeHome() {
  const { t } = useI18n();
  const session = readSession();
  const viewerId = session?.user.id ?? null;
  const [active, setActive] = useState<ModuleId>("chat");
  const [jump, setJump] = useState<JumpRequest | null>(null);
  const [unread, setUnread] = useState(0);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [workspaceFailed, setWorkspaceFailed] = useState(false);

  const reloadWorkspace = useCallback(async () => {
    try {
      setWorkspace(await fetchWorkspace());
      setWorkspaceFailed(false);
    } catch {
      setWorkspaceFailed(true);
    }
  }, []);

  useEffect(() => {
    void reloadWorkspace();
  }, [reloadWorkspace]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onWorkspace = () => void reloadWorkspace();
    const onPresence = () =>
      void fetchDirectory()
        .then((directory) =>
          setWorkspace((current) => (current ? { ...current, directory } : current)),
        )
        .catch(() => undefined);
    socket.on("workspace:changed", onWorkspace);
    socket.on("presence:update", onPresence);
    socket.io.on("reconnect", onWorkspace);
    return () => {
      socket.off("workspace:changed", onWorkspace);
      socket.off("presence:update", onPresence);
      socket.io.off("reconnect", onWorkspace);
    };
  }, [reloadWorkspace]);

  const openChat = useCallback((target: Omit<JumpRequest, "nonce">) => {
    setActive("chat");
    setJump({ ...target, nonce: Date.now() });
  }, []);

  const modules: Omit<RailItem, "active" | "onSelect">[] = [
    { key: "chat", label: "گفتگو", icon: MessageSquare, badge: unread },
    { key: "users", label: "کاربران", icon: Users },
    {
      key: "approvals",
      label: "کارتابل",
      icon: FileSignature,
      badge: workspace?.pendingForMe ?? 0,
    },
    {
      key: "tasks",
      label: "وظایف",
      icon: ListChecks,
      dot: (workspace?.tasks ?? []).some(
        (task) => task.status === "در انتظار" && task.ownerId === viewerId,
      ),
    },
    { key: "meetings", label: "جلسات", icon: CalendarDays, badge: workspace?.upcomingCount ?? 0 },
    { key: "announcements", label: "ابلاغیه", icon: Megaphone, badge: workspace?.pendingAck ?? 0 },
  ];

  const rail: RailItem[] = modules.map((item) => ({
    ...item,
    active: active === item.key,
    onSelect: () => setActive(item.key as ModuleId),
  }));

  const renderModule = () => {
    if (active === "chat") return null;
    if (!workspace) {
      return <WorkspaceStatus failed={workspaceFailed} onRetry={() => void reloadWorkspace()} />;
    }
    if (active === "users") {
      return (
        <UsersView
          people={workspace.directory}
          viewerId={viewerId}
          viewerRole={session?.user.role ?? "employee"}
          onStartChat={async (person) => {
            try {
              const { conversation } = await openDirectConversation(person.userId);
              openChat({ targetType: "conversation", targetId: conversation.id });
            } catch (error) {
              toast.error(
                error instanceof ApiError && error.message === "MANAGEMENT_TICKET_REQUIRED"
                  ? t("گفتگو با هیئت مدیره نیاز به ثبت درخواست دارد")
                  : t("شروع گفتگو ناموفق بود"),
              );
            }
          }}
          onRequestChat={async (_person, subject, message) => {
            try {
              await requestManagementChat(subject, message);
              toast.success(t("درخواست گفتگو ثبت شد و پس از تأیید، گفتگو باز می‌شود"));
            } catch {
              toast.error(t("ثبت درخواست گفتگو ناموفق بود"));
            }
          }}
        />
      );
    }
    if (active === "approvals") {
      return <ApprovalsBoard />;
    }
    if (active === "tasks") {
      return (
        <TasksBoard
          onOpenConversation={(conversationId) =>
            openChat({ targetType: "conversation", targetId: conversationId })
          }
        />
      );
    }
    if (active === "meetings") {
      return <MeetingsBoard />;
    }
    return (
      <AnnouncementsView
        announcements={workspace.announcements}
        pendingAck={workspace.pendingAck}
        canPublish={false}
        onPublish={() => undefined}
        onAcknowledge={(item) =>
          void acknowledgeAnnouncement(item.announcementId)
            .then(reloadWorkspace)
            .catch(() => toast.error(t("ثبت تأیید دریافت ناموفق بود")))
        }
      />
    );
  };

  return (
    <AppShell
      subtitle={t("فضای کاری داخلی")}
      rail={rail}
      headerCenter={
        <GlobalSearch
          onOpen={(target) =>
            openChat({
              targetType: target.targetType,
              targetId: target.targetId,
              ...(target.messageId ? { messageId: target.messageId } : {}),
            })
          }
        />
      }
    >
      <div className="h-full" hidden={active !== "chat"}>
        <ChatWorkspace jump={jump} onUnreadChange={setUnread} />
      </div>
      {active !== "chat" ? <div className="h-full min-h-0">{renderModule()}</div> : null}
    </AppShell>
  );
}
