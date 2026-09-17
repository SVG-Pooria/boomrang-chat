import { io, type Socket } from "socket.io-client";

import { readSession, request } from "@/lib/auth";
import { formatClock, localizeDigits, translate } from "@/lib/i18n-core";

export type TargetType = "direct" | "group" | "channel";

export type ChatTarget = {
  type: TargetType;
  id: number;
  name: string;
  initials: string;
  unread: number;
  online?: boolean;
  memberCount?: number;
  description?: string | null;
  role?: string;
  avatarUrl?: string | null;
  otherUserId?: number | null;
  otherRole?: string | null;
  muted?: boolean;
  lastMessageAt?: string | null;
};

export type Attachment = {
  name: string;
  size: string;
  type: "zip" | "mp4" | "pdf" | "image" | "video" | "audio" | "file";
  fileId?: number;
  mode?: string;
  mimeType?: string | null;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sender: string;
  initials: string;
  gradient: string;
  time: string;
  createdAt: string;
  attachments?: Attachment[];
  classification?: string;
  seenBy?: string;
  senderId?: number;
  kind?: string;
  pinned?: boolean;
  edited?: boolean;
  referral?: MessageReferral;
  forwardFrom?: string;
};

type RawFile = {
  id?: number;
  mode?: string;
  mimeType?: string;
  mime_type?: string;
  sizeBytes?: number;
  size_bytes?: number;
  originalName?: string;
  original_name?: string;
};

type RawMessage = {
  id: number;
  sender_id: number | null;
  sender_name?: string;
  body: string | null;
  type?: string;
  created_at: string;
  is_edited?: boolean;
  is_pinned?: boolean;
  is_confidential?: boolean;
  seen_by_count?: number | null;
  audience_count?: number | null;
  file_row_id?: number | null;
  file_mode?: string | null;
  file_mime_type?: string | null;
  file_size_bytes?: number | null;
  file_original_name?: string | null;
  file?: RawFile | null;
  referral_row_id?: number | null;
  referral_status?: string | null;
  referral_note?: string | null;
  referral_result_note?: string | null;
  referral_assignee_id?: number | null;
  referral_request_id?: number | null;
  referral_request_title?: string | null;
  referral_request_type?: string | null;
  forward_origin_type?: string | null;
  forward_origin_sender_name?: string | null;
  forward_origin_group_title?: string | null;
  forward_origin_channel_title?: string | null;
};

export type MessageReferral = {
  referralId: number;
  requestId: number | null;
  requestTitle: string;
  requestType: string;
  assigneeId: number | null;
  status: "pending" | "accepted" | "declined" | "done" | "failed";
  note: string | null;
  resultNote: string | null;
};

const GRADIENTS = [
  "from-chat-mint to-chat-sky-deep",
  "from-chat-rose to-chat-violet",
  "from-chat-sky to-chat-sky-deep",
  "from-chat-violet to-chat-rose",
  "from-chat-lemon to-chat-mint",
];

export function fa(value: number | string) {
  return localizeDigits(value);
}

export function initialsOf(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "؟";
  if (parts.length === 1) return parts[0]!.slice(0, 2);
  return `${parts[0]![0]}${parts[1]![0]}`;
}

export function gradientFor(id: number | null | undefined) {
  return GRADIENTS[Math.abs(Number(id ?? 0)) % GRADIENTS.length]!;
}

export function formatTime(iso: string) {
  return formatClock(iso);
}

function formatSize(bytes: number | null | undefined) {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return translate("{size} مگابایت", { size: fa(mb.toFixed(1)) });
  return translate("{size} کیلوبایت", { size: fa(Math.max(1, Math.round(bytes / 1024))) });
}

function attachmentTypeOf(mimeType: string | null | undefined, name: string): Attachment["type"] {
  const mime = mimeType || "";
  const lower = name.toLowerCase();
  if (lower.endsWith(".zip") || lower.endsWith(".rar") || lower.endsWith(".7z")) return "zip";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (lower.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

let readReceiptsEnabled = true;

export function setReadReceiptsEnabled(enabled: boolean) {
  readReceiptsEnabled = enabled;
}

export function fetchClientSettings() {
  return request<{ readReceiptsEnabled: boolean; language: "fa" | "en" }>("/settings");
}

function seenLabel(raw: RawMessage, isOwn: boolean) {
  if (!isOwn || !readReceiptsEnabled || raw.seen_by_count === null) return undefined;
  const seen = Number(raw.seen_by_count ?? 0);
  if (seen <= 0) return translate("ارسال شد");
  return translate("خوانده‌شده توسط {count} نفر", { count: fa(seen) });
}

export function toChatMessage(raw: RawMessage, viewerId: number): ChatMessage {
  const isOwn = raw.sender_id === viewerId;
  const senderName = raw.sender_name || translate("کاربر حذف‌شده");
  const file = raw.file ?? null;
  const fileId = raw.file_row_id ?? file?.id ?? null;
  const fileName = raw.file_original_name ?? file?.originalName ?? file?.original_name ?? "";
  const fileMime = raw.file_mime_type ?? file?.mimeType ?? file?.mime_type ?? null;
  const fileSize = raw.file_size_bytes ?? file?.sizeBytes ?? file?.size_bytes ?? null;

  const label = seenLabel(raw, isOwn);
  const attachments: Attachment[] = fileId
    ? [
        {
          name: fileName || translate("پیوست"),
          size: formatSize(fileSize),
          type: attachmentTypeOf(fileMime, fileName),
          fileId,
          mode: raw.file_mode ?? file?.mode ?? "file",
          mimeType: fileMime,
        },
      ]
    : [];

  return {
    id: String(raw.id),
    role: isOwn ? "user" : "assistant",
    content: raw.body ?? "",
    sender: isOwn ? translate("شما") : senderName,
    initials: initialsOf(senderName),
    gradient: gradientFor(raw.sender_id),
    time: formatTime(raw.created_at),
    createdAt: raw.created_at,
    kind: raw.type ?? "text",
    pinned: Boolean(raw.is_pinned),
    edited: Boolean(raw.is_edited),
    ...(raw.is_confidential ? { classification: translate("محرمانه") } : {}),
    ...(raw.sender_id !== null ? { senderId: raw.sender_id } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(label ? { seenBy: label } : {}),
    ...(raw.forward_origin_type
      ? {
          forwardFrom:
            raw.forward_origin_type === "channel"
              ? (raw.forward_origin_channel_title ?? translate("کانال"))
              : raw.forward_origin_type === "group"
                ? (raw.forward_origin_group_title ?? translate("گروه"))
                : (raw.forward_origin_sender_name ?? translate("کاربر حذف‌شده")),
        }
      : {}),
    ...(raw.referral_row_id
      ? {
          referral: {
            referralId: raw.referral_row_id,
            requestId: raw.referral_request_id ?? null,
            requestTitle: raw.referral_request_title ?? translate("درخواست"),
            requestType: raw.referral_request_type ?? "",
            assigneeId: raw.referral_assignee_id ?? null,
            status: (raw.referral_status ?? "pending") as MessageReferral["status"],
            note: raw.referral_note ?? null,
            resultNote: raw.referral_result_note ?? null,
          },
        }
      : {}),
  };
}

type ConversationRow = {
  id: number;
  type: string;
  title: string | null;
  muted?: boolean;
  otherUser?: {
    sub?: number;
    id?: number;
    fullName: string;
    role?: string;
    avatarUrl?: string | null;
  } | null;
  unreadCount?: number;
  lastMessage?: { createdAt: string } | null;
};

type EntityRow = {
  id: number;
  title: string;
  description?: string | null;
  unreadCount?: number;
  role?: string;
  avatarUrl?: string | null;
  muted?: boolean;
  memberCount?: number;
  lastMessage?: { createdAt: string } | null;
};

export async function fetchSidebar() {
  const [conversationsResult, groupsResult, channelsResult, presenceResult] = await Promise.all([
    request<{ conversations: ConversationRow[] }>("/conversations"),
    request<{ groups: EntityRow[] }>("/groups"),
    request<{ channels: EntityRow[] }>("/channels"),
    request<{ online: number[] }>("/users/presence").catch(() => ({ online: [] })),
  ]);

  const onlineIds = new Set(presenceResult.online ?? []);

  const direct: ChatTarget[] = conversationsResult.conversations
    .filter((row) => row.type === "direct")
    .map((row) => {
      const name = row.otherUser?.fullName ?? row.title ?? translate("گفتگو");
      const otherId = row.otherUser?.sub ?? row.otherUser?.id ?? null;
      return {
        type: "direct" as const,
        id: row.id,
        name,
        initials: initialsOf(name),
        unread: row.unreadCount ?? 0,
        online: otherId !== null && onlineIds.has(otherId),
        avatarUrl: row.otherUser?.avatarUrl ?? null,
        otherUserId: otherId,
        otherRole: row.otherUser?.role ?? null,
        muted: Boolean(row.muted),
        lastMessageAt: row.lastMessage?.createdAt ?? null,
      };
    });

  const entity = (type: "group" | "channel") => (row: EntityRow) => ({
    type,
    id: row.id,
    name: row.title,
    initials: initialsOf(row.title),
    unread: row.unreadCount ?? 0,
    description: row.description ?? null,
    role: row.role ?? "member",
    avatarUrl: row.avatarUrl ?? null,
    muted: Boolean(row.muted),
    lastMessageAt: row.lastMessage?.createdAt ?? null,
    ...(row.memberCount !== undefined ? { memberCount: row.memberCount } : {}),
  });

  return {
    direct,
    groups: groupsResult.groups.map(entity("group")),
    channels: channelsResult.channels.map(entity("channel")),
  };
}

function basePath(target: ChatTarget) {
  if (target.type === "group") return `/groups/${target.id}`;
  if (target.type === "channel") return `/channels/${target.id}`;
  return `/conversations/${target.id}`;
}

export function panelTargetType(target: ChatTarget) {
  return target.type === "direct" ? "conversation" : target.type;
}

export async function fetchMessages(
  target: ChatTarget,
  viewerId: number,
  options: { around?: string | number; before?: string | number; limit?: number } = {},
) {
  const query = new URLSearchParams();
  if (options.around !== undefined) query.set("around", String(options.around));
  if (options.before !== undefined) query.set("before", String(options.before));
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const result = await request<{ messages: RawMessage[] }>(`${basePath(target)}/messages${suffix}`);
  return result.messages.map((row) => toChatMessage(row, viewerId));
}

export async function sendMessage(target: ChatTarget, body: string, isConfidential = false) {
  if (target.type === "direct") return null;
  return request<{ message: RawMessage }>(`${basePath(target)}/messages`, {
    method: "POST",
    body: JSON.stringify({ body, isConfidential }),
  });
}

export async function editMessage(target: ChatTarget, messageId: string, body: string) {
  return request<{ message: RawMessage }>(`${basePath(target)}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ body }),
  });
}

export async function deleteMessage(target: ChatTarget, messageId: string) {
  return request<{ success: boolean }>(`${basePath(target)}/messages/${messageId}`, {
    method: "DELETE",
    body: JSON.stringify({ forEveryone: true }),
  });
}

export async function setPinned(target: ChatTarget, messageId: string, pinned: boolean) {
  return request<{ message: RawMessage }>(`${basePath(target)}/messages/${messageId}/pin`, {
    method: "PATCH",
    body: JSON.stringify({ pinned }),
  });
}

export async function markRead(target: ChatTarget, messageId: string) {
  return request<{ success: boolean }>(`${basePath(target)}/read`, {
    method: "POST",
    body: JSON.stringify({ messageId: Number(messageId) }),
  });
}

export function setMuted(target: ChatTarget, muted: boolean) {
  return request<{ muted: boolean }>(`${basePath(target)}/mute`, {
    method: "PATCH",
    body: JSON.stringify({ muted }),
  });
}

export type PinnedItem = {
  messageId: number;
  kind: "text" | "file" | "poll";
  text: string | null;
  fileName: string | null;
  fileMimeType: string | null;
  fileMode: string | null;
  senderName: string;
  createdAt: string;
};

export function fetchPinned(target: ChatTarget) {
  return request<{ pinned: PinnedItem[] }>(
    `/channel-files/${panelTargetType(target)}/${target.id}/pinned`,
  ).then((result) => result.pinned);
}

export type ChatSearchHit = {
  id: number;
  createdAt: string;
  senderName: string;
  snippet: string | null;
  type: string;
  fileName: string | null;
  fileMimeType: string | null;
};

export function searchInChat(target: ChatTarget, term: string) {
  return request<{ results: ChatSearchHit[] }>(
    `${basePath(target)}/search?q=${encodeURIComponent(term)}`,
  ).then((result) => result.results);
}

export type GlobalSearchResult = {
  chats: { targetType: "conversation" | "group" | "channel"; targetId: number; name: string }[];
  messages: {
    targetType: "conversation" | "group" | "channel";
    targetId: number;
    targetName: string | null;
    messageId: number;
    snippet: string | null;
    type: string;
    fileName: string | null;
    fileMimeType: string | null;
    senderName: string;
    createdAt: string;
  }[];
};

export function searchEverywhere(term: string) {
  return request<GlobalSearchResult>(`/search?q=${encodeURIComponent(term)}`);
}

export type ChatPinScope = "all" | "direct" | "group" | "channel";

export type ChatPin = { scope: ChatPinScope; targetType: TargetType; targetId: number };

export function fetchChatPins() {
  return request<{ pins: ChatPin[] }>("/chat-pins").then((result) => result.pins);
}

export function setChatPin(scope: ChatPinScope, target: ChatTarget, pinned: boolean) {
  return request<{ pins: ChatPin[] }>("/chat-pins", {
    method: "PATCH",
    body: JSON.stringify({ scope, targetType: target.type, targetId: target.id, pinned }),
  }).then((result) => result.pins);
}

export function forwardMessage(origin: ChatTarget, messageId: string, destinations: ChatTarget[]) {
  return request<{ delivered: { type: TargetType; id: number }[] }>("/messages/forward", {
    method: "POST",
    body: JSON.stringify({
      originType: origin.type,
      originId: origin.id,
      originMessageId: Number(messageId),
      destinations: destinations.map((target) => ({ type: target.type, id: target.id })),
    }),
  });
}

export function openDirectConversation(targetUserId: number) {
  return request<{ conversation: { id: number } }>("/conversations/direct", {
    method: "POST",
    body: JSON.stringify({ targetUserId }),
  });
}

export function requestManagementChat(subject: string, message: string) {
  return request<{ ticket: { id: number } }>("/management-tickets", {
    method: "POST",
    body: JSON.stringify({ subject, message }),
  });
}

export type AttachmentCategory = "media" | "files";

export type AttachmentItem = {
  id: number;
  type: string;
  body: string | null;
  senderId: number | null;
  senderName: string;
  createdAt: string;
  file: {
    id: number;
    mode: string;
    mimeType: string | null;
    sizeBytes: number | null;
    originalName: string | null;
  } | null;
};

export function fetchAttachments(
  target: ChatTarget,
  category: AttachmentCategory,
  cursor?: number,
) {
  const query = new URLSearchParams({ category, limit: "40" });
  if (cursor) query.set("cursor", String(cursor));
  return request<{ items: AttachmentItem[]; nextCursor: number | null; hasMore: boolean }>(
    `${basePath(target)}/attachments?${query.toString()}`,
  );
}

export function sendSummaryToManagement(target: ChatTarget) {
  return request<{ reportId: number }>(`/summaries/${panelTargetType(target)}/${target.id}/send`, {
    method: "POST",
  });
}

export type UploadMode = "compressed" | "file";

export async function uploadAttachment(
  target: ChatTarget,
  file: File,
  caption: string,
  mode: UploadMode,
) {
  const session = readSession();
  const form = new FormData();
  form.append("file", file);
  form.append("targetType", target.type);
  form.append("mode", mode);
  if (caption) form.append("caption", caption);
  if (target.type === "direct") {
    form.append("conversationId", String(target.id));
  } else {
    form.append("targetId", String(target.id));
  }

  const headers = new Headers();
  if (session) headers.set("Authorization", `Bearer ${session.token}`);

  const response = await fetch("/api/uploads", { method: "POST", headers, body: form });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload["error"] === "string" ? payload["error"] : "UPLOAD_FAILED");
  }
  return payload;
}

let socket: Socket | null = null;

export function getSocket() {
  const session = readSession();
  if (!session) return null;
  if (socket && socket.connected) return socket;
  if (!socket) {
    const created = io({ auth: { token: session.token } });
    created.on("disconnect", (reason) => {
      if (reason !== "io server disconnect") return;
      request("/auth/me")
        .then(() => {
          if (socket === created) created.connect();
        })
        .catch(() => {});
    });
    created.on("connect_error", () => {
      if (!created.active) request("/auth/me").catch(() => {});
    });
    socket = created;
  }
  return socket;
}

export function closeSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
