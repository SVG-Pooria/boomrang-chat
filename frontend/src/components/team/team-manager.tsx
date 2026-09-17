import { ArrowUpRight, Lock, MessageSquare, Search, ShieldCheck, Tag } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UserAvatar } from "@/components/ui/user-avatar";
import { getSocket, openDirectConversation } from "@/lib/chat";
import { useI18n } from "@/lib/i18n";
import {
  fetchTeamMembers,
  setMemberPermission,
  setMemberRole,
  setMemberTag,
  type TeamMemberRecord,
  type TeamMembersData,
} from "@/lib/manager";
import { cn } from "@/lib/utils";

function MemberCard({
  member,
  tags,
  permissions,
  executive,
  busy,
  onTag,
  onPermission,
  onPromote,
  onChat,
}: {
  member: TeamMemberRecord;
  tags: { tagId: number; name: string }[];
  permissions: { key: string; label: string }[];
  executive: boolean;
  busy: boolean;
  onTag: (tagId: number | null) => void;
  onPermission: (permission: string, enabled: boolean) => void;
  onPromote: () => void;
  onChat: (() => void) | null;
}) {
  const { t } = useI18n();
  return (
    <article className="rounded-[22px] border border-chat-panel-border bg-white/65 p-4">
      <div className="flex items-start gap-3">
        <UserAvatar name={member.name} src={member.avatarUrl} seed={member.userId} size={42} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold text-chat-ink">{member.name}</p>
          <p className="truncate text-[11.5px] text-chat-ink-soft">
            {[member.jobTitle, member.unit].filter(Boolean).join(" — ") || t("بدون واحد")}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-chat-ink/6 px-2.5 py-1 text-[10.5px] font-bold text-chat-ink-soft">
          <Lock className="size-3" />
          {t(member.roleLabel)}
        </span>
      </div>

      <div className="mt-3 grid gap-2.5">
        <label className="flex items-center gap-2">
          <span className="flex shrink-0 items-center gap-1 text-[11.5px] font-bold text-chat-ink-soft">
            <Tag className="size-3.5" />
            {t("برچسب")}
          </span>
          <select
            disabled={busy}
            value={member.tagId ?? ""}
            onChange={(event) => onTag(event.target.value ? Number(event.target.value) : null)}
            className="min-w-0 flex-1 rounded-xl border border-chat-panel-border bg-white/70 px-2.5 py-1.5 text-[11.5px] text-chat-ink outline-none focus:bg-white disabled:opacity-50"
          >
            <option value="">{t("بدون برچسب")}</option>
            {tags.map((tag) => (
              <option key={tag.tagId} value={tag.tagId}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>

        {executive ? (
          <div className="grid gap-1.5">
            <span className="flex items-center gap-1 text-[11.5px] font-bold text-chat-ink-soft">
              <ShieldCheck className="size-3.5" />
              {t("دسترسی‌ها")}
            </span>
            {member.roleGrantsAll ? (
              <p className="text-[11px] text-chat-ink-soft">
                {t("نقش مدیر همهٔ این دسترسی‌ها را دارد.")}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {permissions.map((permission) => {
                  const enabled = member.permissions.includes(permission.key);
                  return (
                    <button
                      key={permission.key}
                      type="button"
                      disabled={busy}
                      onClick={() => onPermission(permission.key, !enabled)}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-50",
                        enabled
                          ? "bg-chat-mint text-chat-on-accent"
                          : "border border-chat-panel-border bg-white/70 text-chat-ink-soft hover:bg-white hover:text-chat-ink",
                      )}
                    >
                      {t(permission.label)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {onChat ? (
            <button
              type="button"
              onClick={onChat}
              className="flex items-center gap-1.5 rounded-full border border-chat-panel-border bg-white/70 px-3 py-1.5 text-[11.5px] font-bold text-chat-ink transition-colors hover:bg-white"
            >
              <MessageSquare className="size-3.5" />
              {t("گفتگو")}
            </button>
          ) : null}
          {executive ? (
            <button
              type="button"
              disabled={busy}
              onClick={onPromote}
              className="flex items-center gap-1.5 rounded-full bg-chat-ink px-3 py-1.5 text-[11.5px] font-bold text-chat-on-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <ArrowUpRight className="size-3.5" />
              {member.role === "manager" ? t("بازگرداندن به کارمند") : t("ارتقا به مدیر")}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function TeamManager({
  onOpenChat,
}: {
  onOpenChat: ((conversationId: number) => void) | null;
}) {
  const { t, digits } = useI18n();
  const [data, setData] = useState<TeamMembersData | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [promote, setPromote] = useState<TeamMemberRecord | null>(null);

  const load = useCallback(() => {
    fetchTeamMembers()
      .then(setData)
      .catch(() => toast.error(t("بارگذاری تیم ناموفق بود")));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onChanged = () => load();
    socket.on("workspace:changed", onChanged);
    return () => {
      socket.off("workspace:changed", onChanged);
    };
  }, [load]);

  const apply = (action: () => Promise<{ members: TeamMemberRecord[] }>, failure: string) => {
    setBusy(true);
    action()
      .then((result) =>
        setData((current) => (current ? { ...current, members: result.members } : current)),
      )
      .catch(() => toast.error(t(failure)))
      .finally(() => setBusy(false));
  };

  const members = (data?.members ?? []).filter(
    (member) => query.trim() === "" || member.name.includes(query.trim()),
  );
  const executive = data?.capabilities.executive === true;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <span className="rounded-full border border-chat-panel-border bg-white/60 px-3 py-1.5 text-[11.5px] font-bold text-chat-ink-soft">
          {t("{count} نفر", { count: digits(data?.members.length ?? 0) })}
        </span>
        <label className="flex items-center gap-2 rounded-full border border-chat-panel-border bg-white/60 px-3 py-1.5">
          <Search className="size-3.5 text-chat-ink-soft" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("جستجوی عضو...")}
            className="w-40 bg-transparent text-[12px] text-chat-ink outline-none placeholder:text-chat-ink-soft"
          />
        </label>
      </div>
      {members.length === 0 ? (
        <p className="py-16 text-center text-[12px] text-chat-ink-soft">{t("عضوی یافت نشد.")}</p>
      ) : (
        <div className="custom-scrollbar grid min-h-0 flex-1 content-start gap-3 overflow-y-auto pb-1 md:grid-cols-2 2xl:grid-cols-3">
          {members.map((member) => (
            <MemberCard
              key={member.userId}
              member={member}
              tags={data?.tags ?? []}
              permissions={data?.permissions ?? []}
              executive={executive}
              busy={busy}
              onTag={(tagId) =>
                apply(() => setMemberTag(member.userId, tagId), "ثبت برچسب ناموفق بود")
              }
              onPermission={(permission, enabled) =>
                apply(
                  () => setMemberPermission(member.userId, permission, enabled),
                  "تغییر دسترسی ناموفق بود",
                )
              }
              onPromote={() => setPromote(member)}
              onChat={
                onOpenChat
                  ? () => {
                      openDirectConversation(member.userId)
                        .then(({ conversation }) => onOpenChat(conversation.id))
                        .catch(() => toast.error(t("شروع گفتگو ناموفق بود")));
                    }
                  : null
              }
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={promote !== null}
        tone="primary"
        title={promote?.role === "manager" ? t("بازگرداندن به کارمند") : t("ارتقا به مدیر")}
        description={
          promote?.role === "manager"
            ? t("دسترسی‌های مدیریتی این کاربر برداشته می‌شود.")
            : t(
                "این کاربر می‌تواند برای تیم خود وظیفه و جلسه تعریف کند و درخواست‌ها ابتدا نزد او می‌رود.",
              )
        }
        confirmLabel={promote?.role === "manager" ? t("بازگرداندن") : t("ارتقا")}
        busy={busy}
        onConfirm={() => {
          const target = promote;
          setPromote(null);
          if (!target) return;
          apply(
            () => setMemberRole(target.userId, target.role === "manager" ? "employee" : "manager"),
            "تغییر نقش ناموفق بود",
          );
        }}
        onClose={() => setPromote(null)}
      />
    </div>
  );
}
