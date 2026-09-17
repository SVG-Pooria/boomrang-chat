import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ChatWorkspace, type JumpRequest } from "@/components/chat/chat-workspace";
import { GlobalSearch } from "@/components/chat/global-search";
import { ManagerShell } from "@/components/manager/ManagerShell";
import { RequireRole } from "@/components/require-role";

type ChatTargetKind = JumpRequest["targetType"];
type ChatSearch = { t?: ChatTargetKind; i?: number; m?: number };

const TARGET_KINDS: ChatTargetKind[] = ["conversation", "group", "channel"];

export const Route = createFileRoute("/manager/chat")({
  validateSearch: (search: Record<string, unknown>): ChatSearch => {
    const kind = TARGET_KINDS.find((item) => item === search["t"]);
    return {
      ...(kind ? { t: kind } : {}),
      ...(Number(search["i"]) ? { i: Number(search["i"]) } : {}),
      ...(Number(search["m"]) ? { m: Number(search["m"]) } : {}),
    };
  },
  component: ManagerChatRoute,
});

function ManagerChatRoute() {
  return (
    <RequireRole roles={["management", "manager"]}>
      <ManagerChat />
    </RequireRole>
  );
}

function ManagerChat() {
  const search = Route.useSearch();
  const [jump, setJump] = useState<JumpRequest | null>(null);

  useEffect(() => {
    if (!search.i) return;
    setJump({
      targetType: search.t ?? "conversation",
      targetId: search.i,
      ...(search.m ? { messageId: search.m } : {}),
      nonce: Date.now(),
    });
  }, [search.t, search.i, search.m]);

  return (
    <ManagerShell
      flush
      title="گفتگو"
      subtitle="گفتگوهای سازمانی شما"
      headerCenter={
        <GlobalSearch
          onOpen={(target) =>
            setJump({
              targetType: target.targetType,
              targetId: target.targetId,
              ...(target.messageId ? { messageId: target.messageId } : {}),
              nonce: Date.now(),
            })
          }
        />
      }
    >
      <ChatWorkspace jump={jump} />
    </ManagerShell>
  );
}
