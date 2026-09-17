import {
  ArrowDown,
  BellOff,
  BellRing,
  CheckCheck,
  Hash,
  Loader2,
  Megaphone,
  MessagesSquare,
  PanelLeft,
  Pin,
  PinOff,
  Search,
  Users,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { toast } from "sonner";

import { ChatMenu } from "@/components/chat/chat-menu";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatSearch } from "@/components/chat/chat-search";
import { Composer } from "@/components/chat/composer";
import { DropOverlay } from "@/components/chat/drop-overlay";
import { MediaViewer, type ViewerItem } from "@/components/chat/media-viewer";
import { MessageBubble } from "@/components/chat/message-bubble";
import { PinnedBar } from "@/components/chat/pinned-bar";
import { PollDialog } from "@/components/chat/poll-dialog";
import { ForwardDialog } from "@/components/chat/forward-dialog";
import { SendFilesDialog, type PendingUpload } from "@/components/chat/send-files-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { GlassDialog } from "@/components/ui/glass-dialog";
import { UserAvatar } from "@/components/ui/user-avatar";
import { ApiError, readSession } from "@/lib/auth";
import {
  closeSocket,
  deleteMessage as deleteMessageRequest,
  editMessage as editMessageRequest,
  fetchChatPins,
  fetchClientSettings,
  fetchMessages,
  fetchPinned,
  fetchSidebar,
  forwardMessage,
  getSocket,
  markRead,
  panelTargetType,
  sendMessage as sendMessageRequest,
  setChatPin,
  setMuted,
  setPinned as setPinnedRequest,
  setReadReceiptsEnabled,
  toChatMessage,
  uploadAttachment,
  type ChatMessage,
  type ChatPin,
  type ChatPinScope,
  type ChatTarget,
  type PinnedItem,
} from "@/lib/chat";
import { isVisualMedia } from "@/lib/files";
import { useI18n } from "@/lib/i18n";
import {
  createPoll,
  fetchChannelPanel,
  fetchSummary,
  type ChannelPanel,
  type Digest,
  type Poll,
} from "@/lib/workspace";
import { cn } from "@/lib/utils";

export type JumpRequest = {
  targetType: "conversation" | "group" | "channel";
  targetId: number;
  messageId?: number;
  nonce: number;
};

type ScrollIntent =
  | { kind: "bottom"; smooth: boolean }
  | { kind: "message"; id: string }
  | { kind: "preserve"; height: number; top: number }
  | null;

const PAGE_SIZE = 50;
const TABS = [
  { id: "all", label: "همه" },
  { id: "direct", label: "شخصی" },
  { id: "group", label: "گروه‌ها" },
  { id: "channel", label: "کانال‌ها" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function sendFailure(code: string | undefined) {
  const messages: Record<string, string> = {
    COOLDOWN_ACTIVE: "لطفاً چند ثانیه صبر کنید و دوباره بفرستید",
    FILE_TOO_LARGE: "حجم فایل از سقف مجاز سامانه بیشتر است",
    FILE_TYPE_NOT_ALLOWED: "ارسال فایل‌های اجرایی و اسکریپت مجاز نیست",
    TOO_MANY_UPLOADS: "تعداد بارگذاری‌ها زیاد است؛ کمی بعد دوباره تلاش کنید",
    MANAGEMENT_TICKET_REQUIRED: "این گفتگو بسته شده است؛ برای ادامه درخواست گفتگو ثبت کنید",
    READ_ONLY_CHANNEL: "امکان ارسال پیام در این گفتگو وجود ندارد",
    INFECTED_FILE: "فایل انتخاب‌شده آلوده تشخیص داده شد",
  };
  return code ? messages[code] : undefined;
}

function sameTarget(a: ChatTarget | null, b: ChatTarget | null) {
  return Boolean(a && b && a.type === b.type && a.id === b.id);
}

function SidebarItem({
  item,
  active,
  pinned,
  onSelect,
  onContextMenu,
}: {
  item: ChatTarget;
  active: boolean;
  pinned: boolean;
  onSelect: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const { digits } = useI18n();
  const Badge = item.type === "channel" ? Megaphone : item.type === "group" ? Users : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[18px] px-2.5 py-2 text-start transition-colors",
        active
          ? "bg-white text-chat-ink shadow-[0_10px_24px_-20px_oklch(0.4_0.075_288/0.8)]"
          : "text-chat-ink hover:bg-white/60",
      )}
    >
      <span className="relative">
        <UserAvatar
          name={item.name}
          src={item.avatarUrl}
          seed={item.id + (item.type === "group" ? 3 : item.type === "channel" ? 7 : 0)}
          size={38}
          online={item.type === "direct" ? Boolean(item.online) : undefined}
        />
        {Badge ? (
          <span className="absolute -bottom-0.5 -end-0.5 grid size-4 place-items-center rounded-full bg-chat-surface text-chat-violet ring-1 ring-chat-panel-border">
            <Badge className="size-2.5" />
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-bold">{item.name}</span>
          {pinned ? <Pin className="size-3 shrink-0 text-chat-violet" /> : null}
          {item.muted ? <BellOff className="size-3 shrink-0 text-chat-ink-soft" /> : null}
        </span>
        {item.description ? (
          <span className="block truncate text-[11px] text-chat-ink-soft">{item.description}</span>
        ) : null}
      </span>
      {item.unread ? (
        <span
          className={cn(
            "grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[10px] font-bold text-chat-on-accent",
            item.muted ? "bg-chat-ink-soft/60" : "bg-chat-mint",
          )}
        >
          {digits(item.unread > 99 ? "99+" : item.unread)}
        </span>
      ) : null}
    </button>
  );
}

export function ChatWorkspace({
  jump,
  onUnreadChange,
}: {
  jump: JumpRequest | null;
  onUnreadChange?: (count: number) => void;
}) {
  const { t, day, digits } = useI18n();
  const session = readSession();
  const viewerId = session?.user.id ?? null;

  const [direct, setDirect] = useState<ChatTarget[]>([]);
  const [groups, setGroups] = useState<ChatTarget[]>([]);
  const [channels, setChannels] = useState<ChatTarget[]>([]);
  const [listsLoaded, setListsLoaded] = useState(false);
  const [tab, setTab] = useState<TabId>("all");
  const [target, setTarget] = useState<ChatTarget | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyMode, setHistoryMode] = useState(false);
  const [freshCount, setFreshCount] = useState(0);
  const [nearBottom, setNearBottom] = useState(true);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ChatMessage | null>(null);
  const [panel, setPanel] = useState<ChannelPanel | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [pinned, setPinned] = useState<PinnedItem[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [pollBusy, setPollBusy] = useState(false);
  const [viewer, setViewer] = useState<{ items: ViewerItem[]; index: number } | null>(null);
  const [pinnedListOpen, setPinnedListOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mediaRequest, setMediaRequest] = useState(0);
  const [pins, setPins] = useState<ChatPin[]>([]);
  const [menu, setMenu] = useState<{ target: ChatTarget; x: number; y: number } | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [forwardBusy, setForwardBusy] = useState(false);

  const targetRef = useRef<ChatTarget | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const scrollIntent = useRef<ScrollIntent>(null);
  const pendingMessage = useRef<number | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef(false);
  targetRef.current = target;
  historyRef.current = historyMode;

  const reloadSidebar = useCallback(async () => {
    const lists = await fetchSidebar();
    setDirect(lists.direct);
    setGroups(lists.groups);
    setChannels(lists.channels);
    setListsLoaded(true);
    return lists;
  }, []);

  useEffect(() => {
    reloadSidebar()
      .then((lists) => {
        if (jump) return;
        setTarget(
          (current) => current ?? lists.channels[0] ?? lists.groups[0] ?? lists.direct[0] ?? null,
        );
      })
      .catch(() => toast.error(t("بارگذاری فهرست گفتگوها ناموفق بود")));
  }, [reloadSidebar]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onUnreadChange?.(
      [...direct, ...groups, ...channels].reduce((sum, item) => sum + item.unread, 0),
    );
  }, [direct, groups, channels, onUnreadChange]);

  useEffect(() => {
    fetchClientSettings()
      .then((settings) => setReadReceiptsEnabled(settings.readReceiptsEnabled))
      .catch(() => undefined);
    fetchChatPins()
      .then(setPins)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", close);
    };
  }, [menu]);

  useEffect(() => () => closeSocket(), []);

  const allTargets = useMemo(() => [...channels, ...groups, ...direct], [channels, groups, direct]);

  const findTarget = useCallback(
    (type: JumpRequest["targetType"], id: number) =>
      allTargets.find((item) => panelTargetType(item) === type && item.id === id) ?? null,
    [allTargets],
  );

  const reloadPanel = useCallback(() => {
    const current = targetRef.current;
    if (!current) return;
    fetchChannelPanel(current)
      .then((data) => {
        if (sameTarget(targetRef.current, current)) setPanel(data);
      })
      .catch(() => undefined);
  }, []);

  const reloadPinned = useCallback(() => {
    const current = targetRef.current;
    if (!current) return;
    fetchPinned(current)
      .then((items) => {
        if (sameTarget(targetRef.current, current)) setPinned(items);
      })
      .catch(() => undefined);
  }, []);

  const loadLatest = useCallback(
    async (current: ChatTarget) => {
      if (!viewerId) return;
      setLoadingMessages(true);
      try {
        const loaded = await fetchMessages(current, viewerId, { limit: PAGE_SIZE });
        if (!sameTarget(targetRef.current, current)) return;
        scrollIntent.current = { kind: "bottom", smooth: false };
        setMessages(loaded);
        setHasOlder(loaded.length >= PAGE_SIZE);
        setHistoryMode(false);
        setFreshCount(0);
        const last = loaded[loaded.length - 1];
        if (last) {
          markRead(current, last.id)
            .then(() => reloadSidebar())
            .catch(() => undefined);
        }
      } catch {
        toast.error(t("بارگذاری پیام‌ها ناموفق بود"));
      } finally {
        setLoadingMessages(false);
      }
    },
    [viewerId, reloadSidebar, t],
  );

  const loadAround = useCallback(
    async (current: ChatTarget, messageId: number) => {
      if (!viewerId) return;
      setLoadingMessages(true);
      try {
        const loaded = await fetchMessages(current, viewerId, { around: messageId });
        if (!sameTarget(targetRef.current, current)) return;
        scrollIntent.current = { kind: "message", id: String(messageId) };
        setMessages(loaded);
        setHasOlder(loaded.length > 0);
        setHistoryMode(true);
        setHighlightId(String(messageId));
      } catch (error) {
        toast.error(
          error instanceof ApiError && error.message === "MESSAGE_NOT_FOUND"
            ? t("این پیام دیگر در دسترس نیست")
            : t("رفتن به پیام ناموفق بود"),
        );
      } finally {
        setLoadingMessages(false);
      }
    },
    [viewerId, t],
  );

  useEffect(() => {
    if (!target) return;
    setTypingNames([]);
    setEditingId(null);
    setSearchOpen(false);
    setPanel(null);
    setDigest(null);
    setPinned([]);
    setMessages([]);
    const messageId = pendingMessage.current;
    pendingMessage.current = null;
    if (messageId) void loadAround(target, messageId);
    else void loadLatest(target);
    reloadPanel();
    reloadPinned();
    let cancelled = false;
    fetchSummary(target)
      .then((result) => {
        if (!cancelled) setDigest(result.summary);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [target?.type, target?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!jump || !listsLoaded) return;
    const apply = (found: ChatTarget | null) => {
      if (!found) {
        toast.error(t("این گفتگو در فهرست شما نیست"));
        return;
      }
      if (sameTarget(targetRef.current, found)) {
        if (jump.messageId) void loadAround(found, jump.messageId);
        return;
      }
      pendingMessage.current = jump.messageId ?? null;
      setTarget(found);
    };
    const found = findTarget(jump.targetType, jump.targetId);
    if (found) {
      apply(found);
      return;
    }
    reloadSidebar()
      .then((lists) =>
        apply(
          [...lists.channels, ...lists.groups, ...lists.direct].find(
            (item) => panelTargetType(item) === jump.targetType && item.id === jump.targetId,
          ) ?? null,
        ),
      )
      .catch(() => undefined);
  }, [jump?.nonce, listsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const container = scroller.current;
    const intent = scrollIntent.current;
    if (!container || !intent) return;
    scrollIntent.current = null;
    if (intent.kind === "bottom") {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: intent.smooth ? "smooth" : "auto",
      });
    } else if (intent.kind === "preserve") {
      container.scrollTop = container.scrollHeight - intent.height + intent.top;
    } else {
      const element = document.getElementById(`message-${intent.id}`);
      element?.scrollIntoView({ block: "center" });
    }
  }, [messages]);

  useEffect(() => {
    if (!highlightId) return undefined;
    const timer = window.setTimeout(() => setHighlightId(null), 2600);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  const openMessage = useCallback(
    (messageId: number) => {
      const current = targetRef.current;
      if (!current) return;
      const element = document.getElementById(`message-${messageId}`);
      if (element) {
        element.scrollIntoView({ block: "center", behavior: "smooth" });
        setHighlightId(String(messageId));
        return;
      }
      void loadAround(current, messageId);
    },
    [loadAround],
  );

  const loadOlder = useCallback(async () => {
    const current = targetRef.current;
    const container = scroller.current;
    const first = messages[0];
    if (!current || !viewerId || !first || loadingOlder || !hasOlder) return;
    setLoadingOlder(true);
    try {
      const older = await fetchMessages(current, viewerId, { before: first.id, limit: PAGE_SIZE });
      if (!sameTarget(targetRef.current, current)) return;
      if (container) {
        scrollIntent.current = {
          kind: "preserve",
          height: container.scrollHeight,
          top: container.scrollTop,
        };
      }
      setMessages((existing) => {
        const known = new Set(existing.map((message) => message.id));
        return [...older.filter((message) => !known.has(message.id)), ...existing];
      });
      setHasOlder(older.length >= PAGE_SIZE);
    } catch {
      toast.error(t("بارگذاری پیام‌های قدیمی‌تر ناموفق بود"));
    } finally {
      setLoadingOlder(false);
    }
  }, [messages, viewerId, loadingOlder, hasOlder, t]);

  const onScroll = () => {
    const container = scroller.current;
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    setNearBottom(distance < 120);
    if (container.scrollTop < 80) void loadOlder();
  };

  useEffect(() => {
    if (!viewerId) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;

    const matches = (payload: Record<string, unknown>) => {
      const current = targetRef.current;
      if (!current) return false;
      if (current.type === "direct") return Number(payload["conversationId"]) === current.id;
      if (current.type === "group") return Number(payload["groupId"]) === current.id;
      return Number(payload["channelId"]) === current.id;
    };

    const onCreated = (payload: Record<string, unknown>) => {
      const raw = payload["message"] as Parameters<typeof toChatMessage>[0] | undefined;
      const current = targetRef.current;
      if (raw && current && matches(payload)) {
        const mapped = toChatMessage(raw, viewerId);
        if (historyRef.current) {
          setFreshCount((count) => count + 1);
        } else {
          const container = scroller.current;
          const atBottom = container
            ? container.scrollHeight - container.scrollTop - container.clientHeight < 160
            : true;
          if (atBottom || mapped.role === "user")
            scrollIntent.current = { kind: "bottom", smooth: true };
          setMessages((existing) =>
            existing.some((message) => message.id === mapped.id)
              ? existing.map((message) => (message.id === mapped.id ? mapped : message))
              : [...existing, mapped],
          );
          markRead(current, mapped.id).catch(() => undefined);
        }
      }
      void reloadSidebar().catch(() => undefined);
    };

    const onUpdated = (payload: Record<string, unknown>) => {
      const raw = payload["message"] as Parameters<typeof toChatMessage>[0] | undefined;
      if (!raw || !matches(payload)) return;
      const mapped = toChatMessage(raw, viewerId);
      setMessages((existing) =>
        existing.map((message) =>
          message.id === mapped.id
            ? { ...mapped, attachments: mapped.attachments ?? message.attachments ?? [] }
            : message,
        ),
      );
    };

    const onPinnedChange = (payload: Record<string, unknown>) => {
      onUpdated(payload);
      if (matches(payload)) reloadPinned();
    };

    const onRemoved = (payload: Record<string, unknown>) => {
      if (!matches(payload)) return;
      const messageId = String(payload["messageId"]);
      setMessages((existing) => existing.filter((message) => message.id !== messageId));
      reloadPinned();
      reloadPanel();
    };

    const refreshCurrent = () => {
      const current = targetRef.current;
      if (!current || historyRef.current) return;
      fetchMessages(current, viewerId, { limit: PAGE_SIZE })
        .then((loaded) => {
          if (sameTarget(targetRef.current, current)) setMessages(loaded);
        })
        .catch(() => undefined);
    };

    const onTyping = (payload: Record<string, unknown>) => {
      const current = targetRef.current;
      if (!current) return;
      const same =
        Number(payload["targetId"] ?? payload["conversationId"]) === current.id &&
        (payload["targetType"] ?? "direct") === current.type;
      if (!same || Number(payload["userId"]) === viewerId) return;
      const name = String(payload["userName"] ?? "");
      setTypingNames((names) =>
        payload["typing"]
          ? names.includes(name)
            ? names
            : [...names, name]
          : names.filter((item) => item !== name),
      );
    };

    const onSidebarChanged = () => {
      reloadSidebar()
        .then((lists) => {
          const current = targetRef.current;
          const all = [...lists.channels, ...lists.groups, ...lists.direct];
          if (current && !all.some((item) => sameTarget(item, current))) {
            setMessages([]);
            setTarget(all[0] ?? null);
          }
        })
        .catch(() => undefined);
    };

    const onReadReceipt = (payload: Record<string, unknown>) => {
      if (matches(payload)) refreshCurrent();
    };

    const onSettings = () => {
      fetchClientSettings()
        .then((settings) => {
          setReadReceiptsEnabled(settings.readReceiptsEnabled);
          refreshCurrent();
        })
        .catch(() => undefined);
    };

    const onPanelChange = (payload: { targetType?: string; targetId?: number }) => {
      const current = targetRef.current;
      if (!current) return;
      if (payload.targetType && payload.targetType !== panelTargetType(current)) return;
      if (payload.targetId && Number(payload.targetId) !== current.id) return;
      reloadPanel();
    };

    const onSummary = (payload: {
      targetType: string;
      targetId: number;
      summary: Digest | null;
    }) => {
      const current = targetRef.current;
      if (
        !current ||
        panelTargetType(current) !== payload.targetType ||
        current.id !== Number(payload.targetId)
      )
        return;
      setDigest(payload.summary);
    };

    const onReconnect = () => {
      setTypingNames([]);
      refreshCurrent();
      onSidebarChanged();
      reloadPanel();
      reloadPinned();
    };

    const created = ["message:new", "group:message", "channel:message"];
    const edited = ["message:edited", "group:message:edited", "channel:message:edited"];
    const pinnedEvents = ["message:pinned", "group:message:pinned", "channel:message:pinned"];
    const removed = [
      "message:deleted",
      "message:hidden",
      "group:message:deleted",
      "channel:message:deleted",
    ];

    created.forEach((event) => socket.on(event, onCreated));
    edited.forEach((event) => socket.on(event, onUpdated));
    pinnedEvents.forEach((event) => socket.on(event, onPinnedChange));
    removed.forEach((event) => socket.on(event, onRemoved));
    socket.on("message:read", onReadReceipt);
    socket.on("channel:read", onReadReceipt);
    socket.on("group:read", onReadReceipt);
    socket.on("typing", onTyping);
    socket.on("presence:update", onSidebarChanged);
    socket.on("sidebar:changed", onSidebarChanged);
    socket.on("conversation:new", onSidebarChanged);
    socket.on("conversation:closed", onSidebarChanged);
    socket.on("settings:changed", onSettings);
    socket.on("channelfile:changed", onPanelChange);
    socket.on("poll:changed", onPanelChange);
    socket.on("summary:updated", onSummary);
    socket.io.on("reconnect", onReconnect);

    return () => {
      created.forEach((event) => socket.off(event, onCreated));
      edited.forEach((event) => socket.off(event, onUpdated));
      pinnedEvents.forEach((event) => socket.off(event, onPinnedChange));
      removed.forEach((event) => socket.off(event, onRemoved));
      socket.off("message:read", onReadReceipt);
      socket.off("channel:read", onReadReceipt);
      socket.off("group:read", onReadReceipt);
      socket.off("typing", onTyping);
      socket.off("presence:update", onSidebarChanged);
      socket.off("sidebar:changed", onSidebarChanged);
      socket.off("conversation:new", onSidebarChanged);
      socket.off("conversation:closed", onSidebarChanged);
      socket.off("settings:changed", onSettings);
      socket.off("channelfile:changed", onPanelChange);
      socket.off("poll:changed", onPanelChange);
      socket.off("summary:updated", onSummary);
      socket.io.off("reconnect", onReconnect);
    };
  }, [viewerId, reloadSidebar, reloadPanel, reloadPinned]);

  const emitTyping = useCallback((typing: boolean) => {
    const current = targetRef.current;
    const socket = getSocket();
    if (!current || !socket) return;
    socket.emit(typing ? "typing:start" : "typing:stop", {
      targetType: current.type,
      targetId: current.id,
      conversationId: current.id,
    });
  }, []);

  const handleTyping = useCallback(() => {
    emitTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => emitTyping(false), 1800);
  }, [emitTyping]);

  const handleSend = useCallback(
    (text: string) => {
      const current = targetRef.current;
      if (!current || !viewerId) return;
      emitTyping(false);
      if (historyRef.current) void loadLatest(current);
      if (current.type === "direct") {
        const socket = getSocket();
        socket?.emit(
          "message:send",
          { conversationId: current.id, body: text },
          (reply: { error?: string }) => {
            if (reply?.error) toast.error(t(sendFailure(reply.error) ?? "ارسال پیام ناموفق بود"));
          },
        );
        return;
      }
      sendMessageRequest(current, text).catch((error: unknown) =>
        toast.error(
          t((error instanceof ApiError && sendFailure(error.message)) || "ارسال پیام ناموفق بود"),
        ),
      );
    },
    [emitTyping, viewerId, loadLatest, t],
  );

  const handleUpload = useCallback(
    async (upload: PendingUpload, caption: string) => {
      const current = targetRef.current;
      if (!current) return;
      setUploading(true);
      try {
        for (const [index, file] of upload.files.entries()) {
          await uploadAttachment(
            current,
            file,
            index === 0 ? caption : "",
            isVisualMedia(file.type) ? upload.mode : "file",
          );
        }
        setPendingUpload(null);
      } catch (error) {
        toast.error(
          t((error instanceof Error && sendFailure(error.message)) || "بارگذاری فایل ناموفق بود"),
        );
      } finally {
        setUploading(false);
      }
    },
    [t],
  );

  const handlePin = useCallback(
    (messageId: string, next: boolean) => {
      const current = targetRef.current;
      if (!current) return;
      setPinnedRequest(current, messageId, next)
        .then(() => reloadPinned())
        .catch(() => toast.error(t("سنجاق کردن پیام ناموفق بود")));
    },
    [reloadPinned, t],
  );

  const handleEditSubmit = useCallback(() => {
    const current = targetRef.current;
    const id = editingId;
    setEditingId(null);
    if (!current || !id) return;
    const body = editDraft.trim();
    const original = messages.find((message) => message.id === id);
    if (!body || (original && original.content === body)) return;
    editMessageRequest(current, id, body).catch(() => toast.error(t("ویرایش پیام ناموفق بود")));
  }, [editingId, editDraft, messages, t]);

  const handleDelete = useCallback(() => {
    const current = targetRef.current;
    const message = pendingDelete;
    setPendingDelete(null);
    if (!current || !message) return;
    deleteMessageRequest(current, message.id)
      .then(() => setMessages((existing) => existing.filter((item) => item.id !== message.id)))
      .catch(() => toast.error(t("حذف پیام ناموفق بود")));
  }, [pendingDelete, t]);

  const pollsByMessage = useMemo(() => {
    const map = new Map<number, Poll>();
    for (const poll of panel?.polls ?? []) {
      if (poll.messageId !== null) map.set(poll.messageId, poll);
    }
    return map;
  }, [panel]);

  const mediaItems = useMemo<ViewerItem[]>(
    () =>
      messages.flatMap((message) => {
        const attachment = message.attachments?.[0];
        if (
          !attachment?.fileId ||
          attachment.mode !== "compressed" ||
          !isVisualMedia(attachment.mimeType)
        )
          return [];
        return [
          {
            fileId: attachment.fileId,
            name: attachment.name,
            mimeType: attachment.mimeType ?? null,
            sender: message.sender,
            createdAt: message.createdAt,
            ...(message.content ? { caption: message.content } : {}),
          },
        ];
      }),
    [messages],
  );

  const scope: ChatPinScope = tab;

  const isPinned = useCallback(
    (item: ChatTarget, forScope: ChatPinScope) =>
      pins.some(
        (pin) => pin.scope === forScope && pin.targetType === item.type && pin.targetId === item.id,
      ),
    [pins],
  );

  const togglePin = useCallback(
    (item: ChatTarget, forScope: ChatPinScope) => {
      const next = !isPinned(item, forScope);
      setChatPin(forScope, item, next)
        .then(setPins)
        .then(() => toast.success(next ? t("گفتگو سنجاق شد") : t("سنجاق گفتگو برداشته شد")))
        .catch(() => toast.error(t("سنجاق کردن گفتگو ناموفق بود")));
    },
    [isPinned, t],
  );

  const visibleTargets = useMemo(() => {
    const source =
      tab === "all" ? allTargets : tab === "direct" ? direct : tab === "group" ? groups : channels;
    const recency = (item: ChatTarget) =>
      item.lastMessageAt ? new Date(item.lastMessageAt).getTime() : 0;
    return [...source].sort((a, b) => {
      const pinDelta = Number(isPinned(b, scope)) - Number(isPinned(a, scope));
      if (pinDelta !== 0) return pinDelta;
      return recency(b) - recency(a);
    });
  }, [tab, allTargets, direct, groups, channels, isPinned, scope]);

  const isManagerOfSpace = target?.role === "owner" || target?.role === "admin";
  const canPost = target ? target.type !== "channel" || isManagerOfSpace : false;
  const canPin = target ? target.type === "direct" || isManagerOfSpace : false;
  const canPoll = canPost;
  const canPublishSummary = target ? target.type === "direct" || isManagerOfSpace : false;

  const dayLabel = (iso: string) => {
    const date = new Date(iso);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    if (date.toDateString() === today.toDateString()) return t("امروز");
    if (date.toDateString() === yesterday.toDateString()) return t("دیروز");
    return day(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  };

  const subtitle = !target
    ? ""
    : typingNames.length
      ? t("{names} در حال نوشتن...", { names: typingNames.join("، ") })
      : target.type === "direct"
        ? target.online
          ? t("آنلاین")
          : t("آفلاین")
        : (target.description ??
          (target.type === "channel" ? t("کانال سازمانی") : t("گروه سازمانی")));

  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!target || !canPost) return;
    if (Array.from(event.dataTransfer.types).includes("Files")) {
      event.preventDefault();
      setDragActive(true);
    }
  };

  const panelNode = target ? (
    <ChatPanel
      target={target}
      panel={panel}
      digest={digest}
      canPublishSummary={canPublishSummary}
      onDigestChange={setDigest}
      onReloadPanel={reloadPanel}
      onOpenMessage={openMessage}
      onOpenMedia={(items, index) => setViewer({ items, index })}
      mediaRequest={mediaRequest}
    />
  ) : null;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-[272px_minmax(0,1fr)] lg:gap-4 xl:grid-cols-[272px_minmax(0,1fr)_296px]">
      <aside className="panel hidden min-h-0 flex-col overflow-hidden rounded-[26px] lg:flex">
        <div className="shrink-0 p-3 pb-2">
          <div className="flex rounded-2xl bg-chat-ink/5 p-1">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex-1 rounded-xl py-1.5 text-[11px] font-bold transition-all",
                  tab === item.id
                    ? "bg-white text-chat-ink shadow-sm"
                    : "text-chat-ink-soft hover:text-chat-ink",
                )}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
        </div>
        <div className="custom-scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {visibleTargets.map((item) => (
            <SidebarItem
              key={`${item.type}-${item.id}`}
              item={item}
              active={sameTarget(item, target)}
              pinned={isPinned(item, scope)}
              onSelect={() => setTarget(item)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ target: item, x: event.clientX, y: event.clientY });
              }}
            />
          ))}
          {listsLoaded && visibleTargets.length === 0 ? (
            <p className="px-3 py-10 text-center text-[11.5px] leading-relaxed text-chat-ink-soft">
              {tab === "direct"
                ? t("هنوز گفتگوی شخصی ندارید؛ از بخش کاربران گفتگو را شروع کنید.")
                : t("موردی در این بخش نیست.")}
            </p>
          ) : null}
        </div>
      </aside>

      <main
        className="panel relative flex min-h-0 flex-col overflow-hidden rounded-[26px] bg-white/35"
        onDragEnter={onDragEnter}
      >
        {target ? (
          <>
            <header className="relative z-20 flex h-[62px] shrink-0 items-center gap-3 border-b border-chat-panel-border bg-white/25 px-4">
              {searchOpen ? (
                <ChatSearch
                  target={target}
                  onJump={openMessage}
                  onClose={() => setSearchOpen(false)}
                />
              ) : (
                <>
                  <UserAvatar
                    name={target.name}
                    src={target.avatarUrl}
                    seed={
                      target.id + (target.type === "group" ? 3 : target.type === "channel" ? 7 : 0)
                    }
                    size={40}
                    online={target.type === "direct" ? Boolean(target.online) : undefined}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-[14.5px] font-bold leading-tight">
                      {target.type === "channel" ? (
                        <Hash className="size-3.5 shrink-0 text-chat-ink-soft" />
                      ) : null}
                      <span className="truncate">{target.name}</span>
                    </p>
                    <p
                      className={cn(
                        "mt-1 truncate text-[11.5px]",
                        typingNames.length || (target.type === "direct" && target.online)
                          ? "text-chat-mint-deep"
                          : "text-chat-ink-soft",
                      )}
                    >
                      {subtitle}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSearchOpen(true)}
                    aria-label={t("جستجو در گفتگو")}
                    className="grid size-9 place-items-center rounded-full border border-chat-panel-border bg-white/60 text-chat-ink-soft transition-colors hover:bg-white hover:text-chat-ink"
                  >
                    <Search className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    aria-label={t("پروندهٔ گفتگو")}
                    className="grid size-9 place-items-center rounded-full border border-chat-panel-border bg-white/60 text-chat-ink-soft transition-colors hover:bg-white hover:text-chat-ink xl:hidden"
                  >
                    <PanelLeft className="size-4 ltr:rotate-180" />
                  </button>
                  <ChatMenu
                    muted={Boolean(target.muted)}
                    pinnedCount={pinned.length}
                    onSearch={() => setSearchOpen(true)}
                    onShowPinned={() => setPinnedListOpen(true)}
                    onShowMedia={() => {
                      if (!window.matchMedia("(min-width: 1280px)").matches) setDrawerOpen(true);
                      setMediaRequest((value) => value + 1);
                    }}
                    onToggleMute={() => {
                      const next = !target.muted;
                      setMuted(target, next)
                        .then(() => {
                          toast.success(
                            next
                              ? t("اعلان‌های این گفتگو خاموش شد")
                              : t("اعلان‌های این گفتگو روشن شد"),
                          );
                          return reloadSidebar();
                        })
                        .then((lists) => {
                          const all = [...lists.channels, ...lists.groups, ...lists.direct];
                          const refreshed = all.find((item) => sameTarget(item, target));
                          if (refreshed) setTarget(refreshed);
                        })
                        .catch(() => toast.error(t("تغییر وضعیت اعلان ناموفق بود")));
                    }}
                  />
                </>
              )}
            </header>

            <PinnedBar
              items={pinned}
              canUnpin={canPin}
              onOpen={openMessage}
              onUnpin={(messageId) => handlePin(String(messageId), false)}
            />

            <div
              ref={scroller}
              onScroll={onScroll}
              className="custom-scrollbar relative min-h-0 flex-1 overflow-y-auto px-4 py-4"
            >
              {loadingOlder ? (
                <Loader2 className="mx-auto mb-3 size-4 animate-spin text-chat-ink-soft" />
              ) : null}
              {loadingMessages && messages.length === 0 ? (
                <div className="grid h-full place-items-center">
                  <Loader2 className="size-6 animate-spin text-chat-ink-soft" />
                </div>
              ) : null}
              {!loadingMessages && messages.length === 0 ? (
                <div className="grid h-full place-items-center text-center">
                  <div>
                    <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-chat-violet/12 text-chat-violet">
                      <MessagesSquare className="size-7" />
                    </span>
                    <p className="mt-3 text-[13px] font-bold text-chat-ink">
                      {t("هنوز پیامی نیست")}
                    </p>
                    <p className="mt-1 text-[11.5px] text-chat-ink-soft">
                      {canPost
                        ? t("اولین پیام را شما بفرستید.")
                        : t("پیام‌های این کانال این‌جا نمایش داده می‌شود.")}
                    </p>
                  </div>
                </div>
              ) : null}
              <div className="flex flex-col gap-3">
                {messages.map((message, index) => {
                  const previous = messages[index - 1];
                  const showDay =
                    !previous ||
                    new Date(previous.createdAt).toDateString() !==
                      new Date(message.createdAt).toDateString();
                  return (
                    <div key={message.id} className="flex flex-col gap-3">
                      {showDay ? (
                        <div className="sticky top-0 z-10 flex justify-center">
                          <span className="rounded-full border border-chat-panel-border bg-chat-surface/85 px-3 py-1 text-[10.5px] font-bold text-chat-ink-soft backdrop-blur">
                            {dayLabel(message.createdAt)}
                          </span>
                        </div>
                      ) : null}
                      <MessageBubble
                        message={message}
                        showSender={target.type !== "direct"}
                        viewerId={viewerId}
                        poll={pollsByMessage.get(Number(message.id))}
                        highlighted={highlightId === message.id}
                        editing={editingId === message.id}
                        editDraft={editDraft}
                        canPin={canPin}
                        onEditDraftChange={setEditDraft}
                        onEditSubmit={handleEditSubmit}
                        onEditCancel={() => setEditingId(null)}
                        onPin={(item) => handlePin(item.id, !item.pinned)}
                        onEdit={(item) => {
                          setEditingId(item.id);
                          setEditDraft(item.content);
                        }}
                        onDelete={setPendingDelete}
                        onForward={setForwarding}
                        onVote={(pollId, optionId) =>
                          void import("@/lib/workspace")
                            .then((module) => module.votePoll(pollId, optionId))
                            .then(reloadPanel)
                            .catch(() => toast.error(t("ثبت رأی ناموفق بود")))
                        }
                        onOpenMedia={(fileId) => {
                          const position = mediaItems.findIndex((item) => item.fileId === fileId);
                          if (position >= 0) setViewer({ items: mediaItems, index: position });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {historyMode || !nearBottom ? (
              <button
                type="button"
                onClick={() => {
                  if (historyMode) {
                    void loadLatest(target);
                    return;
                  }
                  scroller.current?.scrollTo({
                    top: scroller.current.scrollHeight,
                    behavior: "smooth",
                  });
                }}
                aria-label={t("رفتن به آخرین پیام‌ها")}
                className="absolute bottom-[92px] end-5 z-10 grid size-10 place-items-center rounded-full border border-chat-panel-border bg-chat-surface text-chat-ink shadow-lg transition-transform hover:scale-105"
              >
                <ArrowDown className="size-4" />
                {freshCount ? (
                  <span className="absolute -top-1.5 end-0 grid h-4 min-w-4 place-items-center rounded-full bg-chat-mint px-1 text-[9.5px] font-bold text-chat-on-accent">
                    {digits(freshCount)}
                  </span>
                ) : null}
              </button>
            ) : null}

            {canPost ? (
              <Composer
                targetKey={`${target.type}-${target.id}`}
                placeholder={t("پیامی در «{name}» بنویسید...", { name: target.name })}
                disabled={false}
                uploading={uploading}
                canPoll={canPoll}
                onSend={handleSend}
                onTyping={handleTyping}
                onPickFiles={(files) => setPendingUpload({ files, mode: "compressed" })}
                onPoll={() => setPollOpen(true)}
              />
            ) : (
              <p className="m-4 mt-1 shrink-0 rounded-2xl border border-chat-panel-border bg-white/55 px-4 py-3 text-center text-[12px] text-chat-ink-soft">
                {t("فقط مدیران این کانال می‌توانند پیام بفرستند.")}
              </p>
            )}

            <DropOverlay
              visible={dragActive}
              onLeave={() => setDragActive(false)}
              onDropFiles={(files, mode) => {
                setDragActive(false);
                setPendingUpload({ files, mode });
              }}
            />
          </>
        ) : (
          <div className="grid h-full place-items-center p-6 text-center">
            <div>
              <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-chat-violet/12 text-chat-violet">
                <MessagesSquare className="size-8" />
              </span>
              <p className="mt-4 font-display text-[15px] font-semibold">
                {t("گفتگویی انتخاب نشده است")}
              </p>
              <p className="mt-1 text-[12px] text-chat-ink-soft">
                {t("از فهرست گفتگوها یکی را انتخاب کنید.")}
              </p>
            </div>
          </div>
        )}
      </main>

      <div className="hidden min-h-0 xl:block">{panelNode}</div>

      {drawerOpen && panelNode ? (
        <div className="fixed inset-0 z-40 xl:hidden" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-0 bg-chat-scrim backdrop-blur-[2px]" />
          <div
            className="absolute inset-y-3 end-3 flex w-[min(320px,calc(100vw-1.5rem))] flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label={t("بستن")}
              className="absolute -start-11 top-2 grid size-9 place-items-center rounded-full bg-chat-surface text-chat-ink shadow-lg"
            >
              <X className="size-4" />
            </button>
            {panelNode}
          </div>
        </div>
      ) : null}

      {menu ? (
        <div
          role="menu"
          style={{
            top: Math.min(menu.y, window.innerHeight - 190),
            left: Math.min(menu.x, window.innerWidth - 220),
          }}
          onClick={(event) => event.stopPropagation()}
          className="fixed z-50 w-52 overflow-hidden rounded-[18px] border border-chat-panel-border bg-chat-surface p-1.5 shadow-[0_24px_60px_-28px_oklch(0.2_0.05_288/0.6)]"
        >
          <p className="truncate px-2.5 py-1.5 text-[11px] font-bold text-chat-ink-soft">
            {menu.target.name}
          </p>
          <button
            type="button"
            onClick={() => {
              togglePin(menu.target, scope);
              setMenu(null);
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[12px] font-bold text-chat-ink transition-colors hover:bg-white/70"
          >
            {isPinned(menu.target, scope) ? (
              <PinOff className="size-4 text-chat-ink-soft" />
            ) : (
              <Pin className="size-4 text-chat-ink-soft" />
            )}
            {isPinned(menu.target, scope)
              ? t("برداشتن سنجاق در «{tab}»", {
                  tab: t(TABS.find((item) => item.id === tab)!.label),
                })
              : t("سنجاق در «{tab}»", { tab: t(TABS.find((item) => item.id === tab)!.label) })}
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !menu.target.muted;
              const item = menu.target;
              setMenu(null);
              setMuted(item, next)
                .then(() => {
                  toast.success(
                    next ? t("اعلان‌های این گفتگو خاموش شد") : t("اعلان‌های این گفتگو روشن شد"),
                  );
                  return reloadSidebar();
                })
                .then((lists) => {
                  const all = [...lists.channels, ...lists.groups, ...lists.direct];
                  const refreshed = all.find((entry) => sameTarget(entry, item));
                  if (refreshed && sameTarget(targetRef.current, item)) setTarget(refreshed);
                })
                .catch(() => toast.error(t("تغییر وضعیت اعلان ناموفق بود")));
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[12px] font-bold text-chat-ink transition-colors hover:bg-white/70"
          >
            {menu.target.muted ? (
              <BellRing className="size-4 text-chat-ink-soft" />
            ) : (
              <BellOff className="size-4 text-chat-ink-soft" />
            )}
            {menu.target.muted ? t("روشن کردن اعلان") : t("خاموش کردن اعلان")}
          </button>
          <button
            type="button"
            disabled={!menu.target.unread}
            onClick={() => {
              const item = menu.target;
              setMenu(null);
              fetchMessages(item, viewerId ?? 0, { limit: 1 })
                .then((loaded) => {
                  const last = loaded[loaded.length - 1];
                  return last ? markRead(item, last.id) : null;
                })
                .then(() => reloadSidebar())
                .catch(() => undefined);
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[12px] font-bold text-chat-ink transition-colors hover:bg-white/70 disabled:opacity-40"
          >
            <CheckCheck className="size-4 text-chat-ink-soft" />
            {t("علامت‌گذاری به‌عنوان خوانده‌شده")}
          </button>
        </div>
      ) : null}

      <ForwardDialog
        open={forwarding !== null}
        targets={allTargets.filter(
          (item) => item.type !== "channel" || item.role === "owner" || item.role === "admin",
        )}
        busy={forwardBusy}
        onClose={() => setForwarding(null)}
        onSubmit={(destinations) => {
          const current = targetRef.current;
          const message = forwarding;
          if (!current || !message) return;
          setForwardBusy(true);
          forwardMessage(current, message.id, destinations)
            .then((result) => {
              setForwarding(null);
              toast.success(
                t("پیام به {count} گفتگو هدایت شد", { count: digits(result.delivered.length) }),
              );
              return reloadSidebar();
            })
            .catch(() => toast.error(t("هدایت پیام ناموفق بود")))
            .finally(() => setForwardBusy(false));
        }}
      />

      <SendFilesDialog
        pending={pendingUpload}
        busy={uploading}
        onChange={setPendingUpload}
        onClose={() => !uploading && setPendingUpload(null)}
        onSend={(upload, caption) => void handleUpload(upload, caption)}
      />

      <PollDialog
        open={pollOpen}
        busy={pollBusy}
        onClose={() => setPollOpen(false)}
        onSubmit={(question, options) => {
          const current = targetRef.current;
          if (!current) return;
          setPollBusy(true);
          createPoll(current, question, options)
            .then(() => {
              setPollOpen(false);
              reloadPanel();
            })
            .catch(() => toast.error(t("ساخت نظرسنجی ناموفق بود")))
            .finally(() => setPollBusy(false));
        }}
      />

      <MediaViewer
        items={viewer?.items ?? []}
        index={viewer?.index ?? null}
        onIndexChange={(index) =>
          setViewer((current) => (current ? { ...current, index } : current))
        }
        onClose={() => setViewer(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("حذف پیام")}
        description={t("این پیام برای همه حذف می‌شود و قابل بازگشت نیست.")}
        confirmLabel={t("حذف پیام")}
        onConfirm={handleDelete}
        onClose={() => setPendingDelete(null)}
      />

      <GlassDialog
        open={pinnedListOpen}
        onClose={() => setPinnedListOpen(false)}
        title={t("پیام‌های سنجاق‌شده")}
        description={t("روی هر مورد بزنید تا به همان پیام بروید.")}
      >
        <div className="custom-scrollbar grid max-h-[60dvh] gap-2 overflow-y-auto">
          {pinned.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-chat-ink-soft">
              {t("پیامی سنجاق نشده است.")}
            </p>
          ) : null}
          {pinned.map((item) => (
            <button
              key={item.messageId}
              type="button"
              onClick={() => {
                setPinnedListOpen(false);
                openMessage(item.messageId);
              }}
              className="flex items-start gap-2.5 rounded-2xl border border-chat-panel-border bg-white/55 p-3 text-start transition-colors hover:bg-white/85"
            >
              <Pin className="mt-0.5 size-3.5 shrink-0 text-chat-violet" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2 text-[11px] text-chat-ink-soft">
                  <span className="truncate font-bold text-chat-ink">{item.senderName}</span>
                  <span>{day(item.createdAt, { day: "numeric", month: "short" })}</span>
                </span>
                <span
                  className="mt-0.5 line-clamp-2 block text-[12px] leading-relaxed text-chat-ink"
                  dir="auto"
                >
                  {item.kind === "poll"
                    ? t("نظرسنجی: {question}", { question: item.text ?? "" })
                    : item.kind === "file"
                      ? [item.fileName, item.text].filter(Boolean).join(" — ")
                      : item.text}
                </span>
              </span>
            </button>
          ))}
        </div>
      </GlassDialog>
    </div>
  );
}
