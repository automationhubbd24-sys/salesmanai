import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronLeft,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  User as UserIcon
} from "lucide-react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://api.salesmanchatbot.online";
const CHAT_POLL_INTERVAL_MS = 12000;
const MESSAGE_POLL_INTERVAL_MS = 4500;
const MESSAGE_LIMIT = 120;

type LabelKey = "agent" | "human" | "order" | "human_transfer";
type FilterKey = "all" | LabelKey;
type PlatformKey = "whatsapp" | "messenger";

type Conversation = {
  id: string;
  from: string;
  name: string | null;
  body: string;
  timestamp: number | null;
  reply_by: string | null;
  primary_label: "agent" | "human" | null;
  primary_label_title: string | null;
  active_labels: LabelKey[];
  active_label_titles: string[];
  has_order: boolean;
  order_status: string | null;
  order_selected: boolean;
  human_transfer_selected: boolean;
  manual_label_overrides?: {
    order?: boolean | null;
    human_transfer?: boolean | null;
  };
};

type MessageItem = {
  from: string;
  body: string;
  timestamp: number | string | null;
  is_ai: boolean;
  reply_by?: string | null;
};

const LABEL_META: Record<LabelKey, { title: string; className: string }> = {
  agent: {
    title: "Agent",
    className: "border-[#00ff88]/30 bg-[#00ff88]/10 text-[#8effc4]"
  },
  human: {
    title: "Human",
    className: "border-sky-400/30 bg-sky-400/10 text-sky-200"
  },
  order: {
    title: "Order",
    className: "border-amber-400/30 bg-amber-400/10 text-amber-200"
  },
  human_transfer: {
    title: "Human Transfer",
    className: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200"
  }
};

const FILTER_OPTIONS: { key: FilterKey; title: string }[] = [
  { key: "all", title: "All" },
  { key: "agent", title: "Agent" },
  { key: "human", title: "Human" },
  { key: "order", title: "Order" },
  { key: "human_transfer", title: "Human Transfer" }
];

const getActiveResourceId = (platform?: string | null) =>
  platform === "whatsapp"
    ? localStorage.getItem("active_wa_session_id")
    : localStorage.getItem("active_fb_page_id");

const getPlatformTitle = (platform?: string | null) =>
  platform === "whatsapp" ? "WhatsApp" : "Messenger";

const normalizeTimestamp = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;

  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;

  if (Number.isFinite(numericValue)) {
    return numericValue;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

const formatClock = (value: number | string | null | undefined) => {
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatListTime = (value: number | string | null | undefined) => {
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) return "";

  const date = new Date(timestamp);
  const now = new Date();
  const isSameDay = date.toDateString() === now.toDateString();

  if (isSameDay) {
    return formatClock(timestamp);
  }

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

const getMessagePreview = (body?: string) => {
  if (!body) return "No messages yet";

  if (body.includes("bot_image:")) return "Sent an image";
  if (body.includes("Analyzed Image:")) return "Analyzed image";
  if (body.includes("Analyzed Voice:")) return "Analyzed voice";
  if (body.toLowerCase().includes("system memory") || body.includes("ai_memory")) return "System update";

  return body;
};

const shouldHideMessage = (message: MessageItem) => {
  const body = message.body || "";
  const hasImage = /https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|bmp)/i.test(body);
  const isBotImage = body.includes("bot_image:");
  return (body.toLowerCase().includes("system memory") || body.includes("ai_memory")) && !hasImage && !isBotImage;
};

const getDisplayName = (chat: Conversation | null) => {
  if (!chat) return "";
  return chat.name || chat.from;
};

const SmartInbox = () => {
  const { platform } = useParams<{ platform: PlatformKey }>();
  const [selectedChat, setSelectedChat] = useState<Conversation | null>(null);
  const [isMobileListVisible, setIsMobileListVisible] = useState(true);
  const [chats, setChats] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingChats, setRefreshingChats] = useState(false);
  const [msgLoading, setMsgLoading] = useState(false);
  const [refreshingMessages, setRefreshingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [labelUpdating, setLabelUpdating] = useState<Record<string, boolean>>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const chatsAbortRef = useRef<AbortController | null>(null);
  const messagesAbortRef = useRef<AbortController | null>(null);
  const chatsSignatureRef = useRef("");
  const messagesSignatureRef = useRef("");

  const activeResourceId = getActiveResourceId(platform);
  const hasActiveResource = Boolean(activeResourceId);

  const scrollToBottom = useCallback(() => {
    const viewport = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]") as HTMLDivElement | null;
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, []);

  const upsertConversationLocally = useCallback((nextConversation: Conversation) => {
    setChats((prev) =>
      prev
        .map((item) => (item.id === nextConversation.id ? nextConversation : item))
        .sort((a, b) => (normalizeTimestamp(b.timestamp) || 0) - (normalizeTimestamp(a.timestamp) || 0))
    );
    setSelectedChat((prev) => (prev?.id === nextConversation.id ? nextConversation : prev));
  }, []);

  const fetchChats = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;

    if (!hasActiveResource || !platform) {
      chatsAbortRef.current?.abort();
      setChats([]);
      setSelectedChat(null);
      setLoading(false);
      setRefreshingChats(false);
      return;
    }

    if (silent) {
      setRefreshingChats(true);
    } else {
      setLoading(true);
    }

    chatsAbortRef.current?.abort();
    const controller = new AbortController();
    chatsAbortRef.current = controller;

    try {
      const token = localStorage.getItem("auth_token");
      const endpoint =
        platform === "whatsapp"
          ? `/api/whatsapp/conversations/${activeResourceId}`
          : `/api/messenger/conversations/${activeResourceId}`;

      const response = await fetch(`${BACKEND_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error("Failed to load conversations");
      }

      const data = (await response.json()) as Conversation[];
      const signature = JSON.stringify(data);

      if (signature !== chatsSignatureRef.current) {
        chatsSignatureRef.current = signature;
        setChats(data || []);
        setSelectedChat((prev) => {
          if (!prev) return null;
          return data.find((item) => item.id === prev.id) || null;
        });
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        console.error("Failed to fetch chats:", error);
        if (!silent) {
          toast.error("Conversation list load korte parini");
        }
      }
    } finally {
      if (silent) {
        setRefreshingChats(false);
      } else {
        setLoading(false);
      }
    }
  }, [activeResourceId, hasActiveResource, platform]);

  const fetchMessages = useCallback(
    async (chatId: string, options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;

      if (!hasActiveResource || !platform || !chatId) {
        setMessages([]);
        setMsgLoading(false);
        setRefreshingMessages(false);
        return;
      }

      if (silent) {
        setRefreshingMessages(true);
      } else {
        setMsgLoading(true);
      }

      messagesAbortRef.current?.abort();
      const controller = new AbortController();
      messagesAbortRef.current = controller;

      try {
        const token = localStorage.getItem("auth_token");
        const endpoint =
          platform === "whatsapp"
            ? `/api/whatsapp/messages/${activeResourceId}/${chatId}?limit=${MESSAGE_LIMIT}`
            : `/api/messenger/messages/${activeResourceId}/${chatId}?limit=${MESSAGE_LIMIT}`;

        const response = await fetch(`${BACKEND_URL}${endpoint}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error("Failed to load messages");
        }

        const data = (await response.json()) as MessageItem[];
        const signature = JSON.stringify(data);

        if (signature !== messagesSignatureRef.current) {
          messagesSignatureRef.current = signature;
          setMessages(data || []);
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("Failed to fetch messages:", error);
          if (!silent) {
            toast.error("Message history load korte parini");
          }
        }
      } finally {
        if (silent) {
          setRefreshingMessages(false);
        } else {
          setMsgLoading(false);
        }
      }
    },
    [activeResourceId, hasActiveResource, platform]
  );

  useEffect(() => {
    setSelectedChat(null);
    setMessages([]);
    setIsMobileListVisible(true);
    chatsSignatureRef.current = "";
    messagesSignatureRef.current = "";
  }, [platform]);

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchChats({ silent: true });
      }
    };

    const interval = window.setInterval(() => {
      if (!document.hidden) {
        fetchChats({ silent: true });
      }
    }, CHAT_POLL_INTERVAL_MS);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(interval);
      chatsAbortRef.current?.abort();
    };
  }, [fetchChats]);

  useEffect(() => {
    if (!selectedChat?.id) return undefined;

    fetchMessages(selectedChat.id);

    const interval = window.setInterval(() => {
      if (!document.hidden) {
        fetchMessages(selectedChat.id, { silent: true });
      }
    }, MESSAGE_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
      messagesAbortRef.current?.abort();
    };
  }, [fetchMessages, selectedChat?.id]);

  useEffect(() => {
    if (!messages.length) return;
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const filteredChats = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return chats.filter((chat) => {
      const matchesFilter =
        activeFilter === "all" ? true : chat.active_labels.includes(activeFilter as LabelKey);

      if (!matchesFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [
        getDisplayName(chat),
        chat.from,
        chat.body,
        ...chat.active_label_titles
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [activeFilter, chats, searchTerm]);

  const counts = useMemo(() => {
    return FILTER_OPTIONS.reduce<Record<FilterKey, number>>(
      (acc, item) => {
        acc[item.key] =
          item.key === "all"
            ? chats.length
            : chats.filter((chat) => chat.active_labels.includes(item.key as LabelKey)).length;
        return acc;
      },
      { all: 0, agent: 0, human: 0, order: 0, human_transfer: 0 }
    );
  }, [chats]);

  const handleSelectChat = useCallback(
    (chat: Conversation) => {
      setSelectedChat(chat);
      setIsMobileListVisible(false);
      fetchMessages(chat.id);
    },
    [fetchMessages]
  );

  const handleToggleLabel = useCallback(
    async (labelKey: "order" | "human_transfer", active: boolean) => {
      if (!selectedChat || !activeResourceId || !platform) return;

      const mutationKey = `${selectedChat.id}:${labelKey}`;
      const endpoint =
        platform === "whatsapp"
          ? `/api/whatsapp/conversations/${activeResourceId}/${selectedChat.id}/labels`
          : `/api/messenger/conversations/${activeResourceId}/${selectedChat.id}/labels`;

      const optimisticConversation: Conversation = {
        ...selectedChat,
        order_selected: labelKey === "order" ? active : selectedChat.order_selected,
        human_transfer_selected:
          labelKey === "human_transfer" ? active : selectedChat.human_transfer_selected,
        active_labels: (() => {
          const nextLabels = new Set<LabelKey>(selectedChat.active_labels);
          if (active) {
            nextLabels.add(labelKey);
          } else {
            nextLabels.delete(labelKey);
          }
          return Array.from(nextLabels);
        })(),
        active_label_titles: (() => {
          const nextLabels = new Set(
            selectedChat.active_label_titles.filter((item) => item !== LABEL_META[labelKey].title)
          );
          if (active) {
            nextLabels.add(LABEL_META[labelKey].title);
          }
          return Array.from(nextLabels);
        })()
      };

      upsertConversationLocally(optimisticConversation);
      setLabelUpdating((prev) => ({ ...prev, [mutationKey]: true }));

      try {
        const token = localStorage.getItem("auth_token");
        const response = await fetch(`${BACKEND_URL}${endpoint}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ labelKey, active })
        });

        if (!response.ok) {
          throw new Error("Label update failed");
        }

        const data = await response.json();
        if (data?.conversation) {
          upsertConversationLocally(data.conversation as Conversation);
        } else {
          fetchChats({ silent: true });
        }
      } catch (error) {
        console.error("Failed to update smart inbox label:", error);
        toast.error("Label update korte parini");
        fetchChats({ silent: true });
      } finally {
        setLabelUpdating((prev) => ({ ...prev, [mutationKey]: false }));
      }
    },
    [activeResourceId, fetchChats, platform, selectedChat, upsertConversationLocally]
  );

  const handleSendMessage = useCallback(async () => {
    if (!selectedChat || !activeResourceId || !platform || !newMessage.trim() || sending) {
      return;
    }

    const messageText = newMessage.trim();
    const optimisticMessage: MessageItem = {
      from: "me",
      body: messageText,
      timestamp: Date.now(),
      reply_by: "admin",
      is_ai: false
    };

    setSending(true);
    setNewMessage("");
    setMessages((prev) => [...prev, optimisticMessage]);

    try {
      const token = localStorage.getItem("auth_token");
      const endpoint = platform === "whatsapp" ? "/api/whatsapp/send" : "/api/messenger/send";
      const payload =
        platform === "whatsapp"
          ? { sessionName: activeResourceId, to: selectedChat.id, message: messageText }
          : { pageId: activeResourceId, to: selectedChat.id, message: messageText };

      const response = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error("Send failed");
      }

      const timestamp = Date.now();
      const updatedConversation: Conversation = {
        ...selectedChat,
        body: messageText,
        timestamp,
        reply_by: "admin",
        primary_label: "human",
        primary_label_title: "Human",
        active_labels: Array.from(new Set<LabelKey>([
          "human",
          ...(selectedChat.order_selected ? ["order" as const] : []),
          ...(selectedChat.human_transfer_selected ? ["human_transfer" as const] : [])
        ])),
        active_label_titles: Array.from(new Set([
          "Human",
          ...(selectedChat.order_selected ? ["Order"] : []),
          ...(selectedChat.human_transfer_selected ? ["Human Transfer"] : [])
        ]))
      };

      upsertConversationLocally(updatedConversation);
      fetchMessages(selectedChat.id, { silent: true });
      fetchChats({ silent: true });
    } catch (error) {
      console.error("Failed to send message:", error);
      toast.error("Message pathate parini");
      setNewMessage(messageText);
      fetchMessages(selectedChat.id, { silent: true });
    } finally {
      setSending(false);
    }
  }, [
    activeResourceId,
    fetchChats,
    fetchMessages,
    newMessage,
    platform,
    selectedChat,
    sending,
    upsertConversationLocally
  ]);

  const emptyStateTitle = hasActiveResource ? "Select a conversation" : "Select active account";
  const emptyStateDescription = hasActiveResource
    ? "Left list theke ekta chat select korlei full inbox, labels, ar recent messages dekhte parben."
    : `Smart Inbox use korar age ekta active ${getPlatformTitle(platform)} account select korun.`;

  const visibleMessages = useMemo(
    () => messages.filter((message) => !shouldHideMessage(message)),
    [messages]
  );

  return (
    <div className="flex h-[calc(100dvh-64px)] md:h-[calc(100vh-80px)] overflow-hidden bg-[#050505] md:rounded-3xl border border-white/5 shadow-2xl">
      <div
        className={cn(
          "w-full md:w-[370px] lg:w-[390px] border-r border-white/5 flex flex-col bg-[#080808]",
          !isMobileListVisible && "hidden md:flex"
        )}
      >
        <div className="border-b border-white/5 p-4 md:p-5 space-y-4 bg-black/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-black tracking-tight text-white">Smart Inbox</h1>
              <p className="text-xs text-white/40">
                Mobile-first {getPlatformTitle(platform)} conversations
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fetchChats({ silent: true })}
              className="text-white/50 hover:text-[#00ff88]"
            >
              <RefreshCw size={18} className={refreshingChats ? "animate-spin" : ""} />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {FILTER_OPTIONS.slice(1).map((filter) => (
              <div key={filter.key} className="rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">{filter.title}</div>
                <div className="mt-1 text-lg font-bold text-white">{counts[filter.key]}</div>
              </div>
            ))}
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" size={16} />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search conversations..."
              className="pl-10 h-11 rounded-2xl border-white/10 bg-white/5 focus-visible:ring-[#00ff88]/30"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {FILTER_OPTIONS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setActiveFilter(filter.key)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all",
                  activeFilter === filter.key
                    ? "border-[#00ff88]/40 bg-[#00ff88]/10 text-[#97ffca]"
                    : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white"
                )}
              >
                {filter.title}
                <span className="ml-2 text-[10px] opacity-70">{counts[filter.key]}</span>
              </button>
            ))}
          </div>
        </div>

        <ScrollArea className="flex-1">
          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="rounded-2xl border border-white/5 bg-white/[0.02] p-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-12 w-12 rounded-full bg-white/10" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-32 bg-white/10" />
                      <Skeleton className="h-3 w-full bg-white/10" />
                      <Skeleton className="h-3 w-24 bg-white/10" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-8 text-center">
              <Inbox className="mb-4 text-white/20" size={34} />
              <h3 className="text-base font-semibold text-white">No conversations found</h3>
              <p className="mt-2 text-sm text-white/35">
                Search, filter, ba active account change kore abar try korun.
              </p>
            </div>
          ) : (
            <div className="p-2 md:p-3 space-y-2">
              {filteredChats.map((chat) => {
                const isActive = selectedChat?.id === chat.id;
                return (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => handleSelectChat(chat)}
                    className={cn(
                      "w-full rounded-3xl border p-3 text-left transition-all",
                      isActive
                        ? "border-[#00ff88]/30 bg-[#00ff88]/8 shadow-[0_0_20px_rgba(0,255,136,0.08)]"
                        : "border-white/5 bg-white/[0.025] hover:bg-white/[0.05]"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className="h-12 w-12 border border-white/10">
                        <AvatarImage src={undefined} />
                        <AvatarFallback className="bg-white/5 text-white/60">
                          <UserIcon size={18} />
                        </AvatarFallback>
                      </Avatar>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white">
                              {getDisplayName(chat)}
                            </div>
                            <div className="mt-0.5 text-[11px] text-white/35">{chat.from}</div>
                          </div>
                          <div className="shrink-0 text-[11px] text-white/35">
                            {formatListTime(chat.timestamp)}
                          </div>
                        </div>

                        <p className="mt-2 line-clamp-2 text-sm leading-5 text-white/60">
                          {getMessagePreview(chat.body)}
                        </p>

                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {chat.active_labels.length > 0 ? (
                            chat.active_labels.map((label) => (
                              <Badge
                                key={`${chat.id}-${label}`}
                                variant="outline"
                                className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-bold", LABEL_META[label].className)}
                              >
                                {LABEL_META[label].title}
                              </Badge>
                            ))
                          ) : (
                            <Badge
                              variant="outline"
                              className="rounded-full border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[10px] text-white/45"
                            >
                              Open
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      <div className={cn("flex flex-1 flex-col bg-black/20", isMobileListVisible && "hidden md:flex")}>
        {selectedChat ? (
          <>
            <div className="border-b border-white/5 bg-black/30 px-4 py-3 md:px-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden text-white/50 hover:text-white"
                    onClick={() => setIsMobileListVisible(true)}
                  >
                    <ChevronLeft size={20} />
                  </Button>

                  <Avatar className="h-11 w-11 border border-white/10">
                    <AvatarFallback className="bg-white/5 text-white/60">
                      <UserIcon size={18} />
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">
                      {getDisplayName(selectedChat)}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-white/40">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-[#00ff88]" />
                        {selectedChat.reply_by === "bot"
                          ? "Last reply by agent"
                          : selectedChat.reply_by === "admin"
                            ? "Last reply by human"
                            : "Waiting for reply"}
                      </span>
                      <span className="text-white/20">|</span>
                      <span>{getPlatformTitle(platform)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => fetchMessages(selectedChat.id, { silent: true })}
                    className="text-white/40 hover:text-[#00ff88]"
                  >
                    <RefreshCw size={16} className={refreshingMessages ? "animate-spin" : ""} />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-white/35 hover:text-white">
                    <ShieldCheck size={18} />
                  </Button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {selectedChat.active_labels.length > 0 ? (
                  selectedChat.active_labels.map((label) => (
                    <Badge
                      key={`header-${label}`}
                      variant="outline"
                      className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold", LABEL_META[label].className)}
                    >
                      {LABEL_META[label].title}
                    </Badge>
                  ))
                ) : (
                  <Badge
                    variant="outline"
                    className="rounded-full border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] text-white/45"
                  >
                    Open
                  </Badge>
                )}
              </div>
            </div>

            <div className="border-b border-white/5 bg-white/[0.02] px-4 py-3 md:hidden">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-white">Order</div>
                      <div className="mt-1 text-[11px] text-white/40">Track order conversations</div>
                    </div>
                    <Switch
                      checked={selectedChat.order_selected}
                      disabled={labelUpdating[`${selectedChat.id}:order`]}
                      onCheckedChange={(checked) => handleToggleLabel("order", checked)}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-white">Human Transfer</div>
                      <div className="mt-1 text-[11px] text-white/40">Unreplied customer queue</div>
                    </div>
                    <Switch
                      checked={selectedChat.human_transfer_selected}
                      disabled={labelUpdating[`${selectedChat.id}:human_transfer`]}
                      onCheckedChange={(checked) => handleToggleLabel("human_transfer", checked)}
                    />
                  </div>
                </div>
              </div>
            </div>

            <ScrollArea ref={scrollRef} className="flex-1">
              {msgLoading ? (
                <div className="space-y-4 p-4 md:p-5">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className={cn("flex", index % 2 === 0 ? "justify-start" : "justify-end")}>
                      <Skeleton className="h-16 w-[72%] rounded-3xl bg-white/10" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3 p-4 md:p-5">
                  {visibleMessages.map((message, index) => {
                    const body = message.body || "";
                    const imageMatch = body.match(
                      /(https?:\/\/[^\s\]\)]+\.(?:jpg|jpeg|png|gif|webp|bmp)(?:\?[^\s\]\)]*)?)/i
                    );
                    const imageUrl = imageMatch ? imageMatch[0] : "";
                    const isBotImage =
                      Boolean(imageUrl) &&
                      (body.includes("bot_image:") ||
                        body.includes("##PRODUCT") ||
                        body.toLowerCase().includes("system memory: user is viewing image") ||
                        body.toLowerCase().includes("sent images to user"));
                    const isOutgoing = message.from === "me" || isBotImage;
                    const isBot = message.reply_by === "bot" || isBotImage;

                    return (
                      <div
                        key={`${normalizeTimestamp(message.timestamp) || index}-${index}`}
                        className={cn("flex gap-3", isOutgoing ? "justify-end" : "justify-start")}
                      >
                        {!isOutgoing && (
                          <Avatar className="mt-auto h-8 w-8 border border-white/10">
                            <AvatarFallback className="bg-white/5 text-[10px] text-white/60">US</AvatarFallback>
                          </Avatar>
                        )}

                        <div
                          className={cn(
                            "max-w-[88%] rounded-[1.35rem] px-3.5 py-3 text-sm shadow-sm md:max-w-[75%]",
                            isOutgoing
                              ? isBot
                                ? "rounded-br-md bg-[#00ff88] text-black"
                                : "rounded-br-md border border-[#00ff88]/15 bg-[#153126] text-white"
                              : "rounded-bl-md border border-white/10 bg-white/[0.05] text-white/90"
                          )}
                        >
                          {isBotImage ? (
                            <div className="space-y-2">
                              <img
                                src={imageUrl}
                                alt="Conversation media"
                                className="w-full max-w-[240px] rounded-2xl border border-black/10 object-cover"
                                onClick={() => window.open(imageUrl, "_blank")}
                                onError={(event) => {
                                  (event.target as HTMLImageElement).src =
                                    "https://placehold.co/400x400?text=Image+Load+Failed";
                                }}
                              />
                              {body
                                .replace(/\[?System Memory:[^\]]+\]?/g, "")
                                .replace(/##PRODUCT[^\n]+/g, "")
                                .replace(/https?:\/\/[^\s]+/g, "")
                                .trim() && (
                                <p className={cn("text-[11px] leading-5", isOutgoing ? "text-black/70" : "text-white/70")}>
                                  {body
                                    .replace(/\[?System Memory:[^\]]+\]?/g, "")
                                    .replace(/##PRODUCT[^\n]+/g, "")
                                    .replace(/https?:\/\/[^\s]+/g, "")
                                    .trim()}
                                </p>
                              )}
                            </div>
                          ) : body.includes("Analyzed Image:") || body.includes("Analyzed Voice:") ? (
                            <details className="group">
                              <summary className={cn("cursor-pointer list-none text-xs font-semibold", isOutgoing ? "text-black/80" : "text-[#8effc4]")}>
                                {body.includes("Analyzed Image:") ? "Analyzed image details" : "Analyzed voice details"}
                              </summary>
                              <p className={cn("mt-3 whitespace-pre-wrap text-xs leading-5", isOutgoing ? "text-black/75" : "text-white/75")}>
                                {body
                                  .replace(/\[Analyzed Image\]:?\s*/i, "")
                                  .replace(/\[Analyzed Voice\]:?\s*/i, "")
                                  .replace(/Analyzed Image:\s*/i, "")
                                  .replace(/Analyzed Voice:\s*/i, "")
                                  .trim()}
                              </p>
                            </details>
                          ) : (
                            <p className="whitespace-pre-wrap break-words leading-6">{body}</p>
                          )}

                          <div
                            className={cn(
                              "mt-2 flex items-center gap-2 text-[10px]",
                              isOutgoing ? "justify-end text-black/55" : "text-white/35"
                            )}
                          >
                            <span>{formatClock(message.timestamp)}</span>
                            <span className="opacity-60">|</span>
                            <span>{isBot ? "Agent" : message.reply_by === "admin" ? "Admin" : "Customer"}</span>
                          </div>
                        </div>

                        {isBot && (
                          <div className="mt-auto shrink-0 text-[#00ff88]">
                            <Bot size={14} />
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {!msgLoading && visibleMessages.length >= MESSAGE_LIMIT && (
                    <div className="pt-2 text-center text-[11px] text-white/35">
                      Recent {MESSAGE_LIMIT} messages show korchi jate mobile smooth thake.
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>

            <div className="border-t border-white/5 bg-black/30 px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:px-5">
              <div className="flex items-end gap-2 rounded-[1.4rem] border border-white/10 bg-white/[0.04] p-2">
                <Input
                  value={newMessage}
                  onChange={(event) => setNewMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Type a message..."
                  className="h-11 border-none bg-transparent text-sm text-white placeholder:text-white/25 focus-visible:ring-0"
                />
                <Button
                  size="icon"
                  onClick={handleSendMessage}
                  disabled={!newMessage.trim() || sending}
                  className="h-11 w-11 rounded-2xl bg-[#00ff88] text-black hover:bg-[#00ff88]/85"
                >
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={17} />}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full border border-[#00ff88]/15 bg-[#00ff88]/5">
              <Inbox size={38} className="text-[#00ff88]" />
            </div>
            <h2 className="text-2xl font-black tracking-tight text-white">{emptyStateTitle}</h2>
            <p className="mt-3 max-w-[360px] text-sm leading-6 text-white/45">{emptyStateDescription}</p>
          </div>
        )}
      </div>

      {selectedChat && (
        <div className="hidden w-[320px] border-l border-white/5 bg-white/[0.02] lg:flex lg:flex-col">
          <div className="border-b border-white/5 p-6">
            <div className="flex flex-col items-center text-center">
              <Avatar className="h-20 w-20 border border-white/10">
                <AvatarFallback className="bg-white/5 text-white/60">
                  <UserIcon size={28} />
                </AvatarFallback>
              </Avatar>
              <h3 className="mt-4 text-lg font-semibold text-white">{getDisplayName(selectedChat)}</h3>
              <p className="mt-1 text-xs text-white/35">{selectedChat.from}</p>
              <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-white/55">
                <Smartphone size={13} />
                {getPlatformTitle(platform)}
              </div>
            </div>
          </div>

          <div className="space-y-6 p-6">
            <div className="space-y-3">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[#8effc4]">
                Active Labels
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedChat.active_labels.length > 0 ? (
                  selectedChat.active_labels.map((label) => (
                    <Badge
                      key={`panel-${label}`}
                      variant="outline"
                      className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold", LABEL_META[label].className)}
                    >
                      {LABEL_META[label].title}
                    </Badge>
                  ))
                ) : (
                  <Badge
                    variant="outline"
                    className="rounded-full border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] text-white/45"
                  >
                    Open
                  </Badge>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[#8effc4]">
                Label Controls
              </div>

              <div className="rounded-3xl border border-white/5 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">Order</div>
                    <p className="mt-1 text-xs leading-5 text-white/40">
                      Customer order follow-up queue te conversation rakhe.
                    </p>
                  </div>
                  <Switch
                    checked={selectedChat.order_selected}
                    disabled={labelUpdating[`${selectedChat.id}:order`]}
                    onCheckedChange={(checked) => handleToggleLabel("order", checked)}
                  />
                </div>
                {selectedChat.order_status && (
                  <div className="mt-3 text-[11px] text-amber-200/80">
                    Order status: {selectedChat.order_status}
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-white/5 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">Human Transfer</div>
                    <p className="mt-1 text-xs leading-5 text-white/40">
                      Jekhane customer message dise kintu agent/admin ekhono reply dey nai.
                    </p>
                  </div>
                  <Switch
                    checked={selectedChat.human_transfer_selected}
                    disabled={labelUpdating[`${selectedChat.id}:human_transfer`]}
                    onCheckedChange={(checked) => handleToggleLabel("human_transfer", checked)}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/5 bg-white/[0.03] p-4 text-xs leading-6 text-white/45">
              <div className="font-semibold text-white/80">Auto rules</div>
              <p className="mt-2">Last reply bot hole conversation Agent-e thakbe.</p>
              <p>Last reply admin hole conversation Human-e chole jabe.</p>
              <p>Order ar Human Transfer manual toggle diye on/off kora jabe.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SmartInbox;
