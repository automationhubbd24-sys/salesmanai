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
    <div className="flex h-[calc(100dvh-64px)] md:h-[calc(100vh-80px)] overflow-hidden bg-[#050810] md:rounded-[2rem] border border-white/5 shadow-2xl">
      {/* Conversation List */}
      <div
        className={cn(
          "w-full md:w-[360px] lg:w-[380px] border-r border-white/5 flex flex-col bg-[#070a12]",
          !isMobileListVisible && "hidden md:flex"
        )}
      >
        {/* Header */}
        <div className="border-b border-white/5 p-4 md:p-5 space-y-4 bg-gradient-to-b from-black/40 to-transparent">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl md:text-2xl font-black tracking-tight text-white">
                Smart Inbox
              </h1>
              <p className="text-xs text-white/40 mt-1">
                Manage your {getPlatformTitle(platform)} conversations
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fetchChats({ silent: true })}
              className="text-white/50 hover:text-[#00ff88] hover:bg-[#00ff88]/10 transition-all duration-300"
            >
              <RefreshCw size={18} className={cn("transition-transform", refreshingChats && "animate-spin")} />
            </Button>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-2">
            {FILTER_OPTIONS.slice(1).map((filter) => (
              <div 
                key={filter.key} 
                className="group rounded-2xl border border-white/5 bg-white/[0.02] px-3 py-3 hover:bg-white/[0.04] hover:border-white/10 transition-all duration-300"
              >
                <div className="text-[10px] uppercase tracking-[0.16em] text-white/40 group-hover:text-white/60 transition-colors">
                  {filter.title}
                </div>
                <div className="mt-1 text-xl font-black text-white">
                  {counts[filter.key]}
                </div>
              </div>
            ))}
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35" size={18} />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search conversations or contacts..."
              className="pl-11 h-12 rounded-2xl border-white/10 bg-white/[0.04] focus-visible:ring-[#00ff88]/40 focus-visible:border-[#00ff88]/30 placeholder:text-white/30 transition-all duration-300"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {FILTER_OPTIONS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setActiveFilter(filter.key)}
                className={cn(
                  "shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition-all duration-300",
                  activeFilter === filter.key
                    ? "border-[#00ff88]/40 bg-gradient-to-r from-[#00ff88]/15 to-[#00ff88]/8 text-[#97ffca] shadow-[0_0_15px_rgba(0,255,136,0.1)]"
                    : "border-white/10 bg-white/[0.02] text-white/60 hover:text-white hover:bg-white/[0.04] hover:border-white/20"
                )}
              >
                {filter.title}
                <span className="ml-2 text-[10px] opacity-70">
                  {counts[filter.key]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Conversation List */}
        <ScrollArea className="flex-1">
          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 animate-pulse">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-12 w-12 rounded-full bg-white/10" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-28 bg-white/10" />
                      <Skeleton className="h-3 w-48 bg-white/10" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center px-8 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.03] border border-white/5">
                <Inbox className="text-white/20" size={32} />
              </div>
              <h3 className="text-lg font-semibold text-white">
                {searchTerm ? "No results found" : "No conversations yet"}
              </h3>
              <p className="mt-2 text-sm text-white/40 max-w-[260px]">
                {searchTerm 
                  ? "Try adjusting your search or filters to find what you're looking for."
                  : "Start messaging with your customers to see conversations here."}
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
                      "w-full rounded-2xl border p-4 text-left transition-all duration-300 group",
                      isActive
                        ? "border-[#00ff88]/30 bg-gradient-to-r from-[#00ff88]/12 to-[#00ff88]/6 shadow-[0_0_30px_rgba(0,255,136,0.12)]"
                        : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className={cn(
                        "h-12 w-12 border transition-all duration-300",
                        isActive ? "border-[#00ff88]/30" : "border-white/10 group-hover:border-white/20"
                      )}>
                        <AvatarImage src={undefined} />
                        <AvatarFallback className={cn(
                          "bg-gradient-to-br from-white/10 to-white/5 text-white/60",
                          isActive && "from-[#00ff88]/20 to-[#00ff88]/10"
                        )}>
                          <UserIcon size={20} />
                        </AvatarFallback>
                      </Avatar>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-white">
                              {getDisplayName(chat)}
                            </div>
                            <div className="mt-0.5 text-[11px] text-white/40">
                              {chat.from}
                            </div>
                          </div>
                          <div className="shrink-0 text-[11px] text-white/40 font-medium">
                            {formatListTime(chat.timestamp)}
                          </div>
                        </div>

                        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-white/65">
                          {getMessagePreview(chat.body)}
                        </p>

                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {chat.active_labels.length > 0 ? (
                            chat.active_labels.map((label) => (
                              <Badge
                                key={`${chat.id}-${label}`}
                                variant="outline"
                                className={cn("rounded-full px-3 py-1 text-[10px] font-bold border-opacity-50", LABEL_META[label].className)}
                              >
                                {LABEL_META[label].title}
                              </Badge>
                            ))
                          ) : (
                            <Badge
                              variant="outline"
                              className="rounded-full border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] text-white/45"
                            >
                              New
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

      {/* Chat Area */}
      <div className={cn("flex flex-1 flex-col bg-[#050810]", isMobileListVisible && "hidden md:flex")}>
        {selectedChat ? (
          <>
            {/* Chat Header */}
            <div className="border-b border-white/5 bg-gradient-to-b from-black/30 to-transparent px-4 py-4 md:px-6">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden text-white/50 hover:text-white hover:bg-white/10"
                    onClick={() => setIsMobileListVisible(true)}
                  >
                    <ChevronLeft size={22} />
                  </Button>

                  <Avatar className="h-12 w-12 border border-white/10">
                    <AvatarFallback className="bg-gradient-to-br from-white/10 to-white/5 text-white/60">
                      <UserIcon size={20} />
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0">
                    <div className="truncate text-base font-bold text-white">
                      {getDisplayName(selectedChat)}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-white/45">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-[#00ff88] animate-pulse" />
                        {selectedChat.reply_by === "bot"
                          ? "Last reply by Agent"
                          : selectedChat.reply_by === "admin"
                            ? "Last reply by Admin"
                            : "Waiting for your reply"}
                      </span>
                      <span className="text-white/20">•</span>
                      <span>{getPlatformTitle(platform)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => fetchMessages(selectedChat.id, { silent: true })}
                    className="text-white/40 hover:text-[#00ff88] hover:bg-[#00ff88]/10 transition-all duration-300"
                  >
                    <RefreshCw size={18} className={cn("transition-transform", refreshingMessages && "animate-spin")} />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-white/35 hover:text-white hover:bg-white/10 transition-all duration-300">
                    <ShieldCheck size={18} />
                  </Button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {selectedChat.active_labels.length > 0 ? (
                  selectedChat.active_labels.map((label) => (
                    <Badge
                      key={`header-${label}`}
                      variant="outline"
                      className={cn("rounded-full px-3 py-1.5 text-[10px] font-bold border-opacity-50", LABEL_META[label].className)}
                    >
                      {LABEL_META[label].title}
                    </Badge>
                  ))
                ) : (
                  <Badge
                    variant="outline"
                    className="rounded-full border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] text-white/45"
                  >
                    New Conversation
                  </Badge>
                )}
              </div>
            </div>

            {/* Mobile Label Controls */}
            <div className="border-b border-white/5 bg-white/[0.015] px-4 py-3.5 md:hidden">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/5 bg-white/[0.025] p-3.5 hover:bg-white/[0.04] transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-white">Order</div>
                      <div className="mt-1 text-[11px] text-white/45">Track order conversations</div>
                    </div>
                    <Switch
                      checked={selectedChat.order_selected}
                      disabled={labelUpdating[`${selectedChat.id}:order`]}
                      onCheckedChange={(checked) => handleToggleLabel("order", checked)}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-white/5 bg-white/[0.025] p-3.5 hover:bg-white/[0.04] transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-white">Human Transfer</div>
                      <div className="mt-1 text-[11px] text-white/45">Unreplied customer queue</div>
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

            {/* Messages */}
            <ScrollArea ref={scrollRef} className="flex-1 bg-gradient-to-b from-transparent to-black/10">
              {msgLoading ? (
                <div className="space-y-4 p-4 md:p-6">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className={cn("flex", index % 2 === 0 ? "justify-start" : "justify-end")}>
                      <Skeleton className="h-20 w-[65%] md:w-[55%] rounded-3xl bg-white/8 animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-4 p-4 md:p-6">
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
                        className={cn("flex gap-3 items-end animate-in fade-in slide-in-from-bottom-2 duration-500", isOutgoing ? "justify-end" : "justify-start")}
                      >
                        {!isOutgoing && (
                          <Avatar className="h-9 w-9 border border-white/10 shrink-0">
                            <AvatarFallback className="bg-white/5 text-[11px] text-white/60 font-bold">
                              {getDisplayName(selectedChat).substring(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        )}

                        <div
                          className={cn(
                            "max-w-[88%] rounded-[1.5rem] px-4 py-3.5 text-sm md:max-w-[70%] lg:max-w-[60%] shadow-lg transition-all duration-200 hover:shadow-xl",
                            isOutgoing
                              ? isBot
                                ? "rounded-br-md bg-gradient-to-br from-[#00ff88] to-[#00cc6a] text-black shadow-[0_4px_20px_rgba(0,255,136,0.25)]"
                                : "rounded-br-md border border-[#00ff88]/20 bg-gradient-to-br from-[#1a3a28] to-[#0f291d] text-white shadow-[0_4px_20px_rgba(0,255,136,0.08)]"
                              : "rounded-bl-md border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.04] text-white/95 shadow-[0_4px_20px_rgba(0,0,0,0.3)]"
                          )}
                        >
                          {isBotImage ? (
                            <div className="space-y-3">
                              <img
                                src={imageUrl}
                                alt="Conversation media"
                                className="w-full max-w-[260px] rounded-2xl border border-black/10 object-cover cursor-pointer hover:scale-[1.02] transition-transform duration-300"
                                onClick={() => window.open(imageUrl, "_blank")}
                                onError={(event) => {
                                  (event.target as HTMLImageElement).src =
                                    "https://placehold.co/400x400/1a1a2e/ffffff?text=Image+Not+Available";
                                }}
                              />
                              {body
                                .replace(/\[?System Memory:[^\]]+\]?/g, "")
                                .replace(/##PRODUCT[^\n]+/g, "")
                                .replace(/https?:\/\/[^\s]+/g, "")
                                .trim() && (
                                <p className={cn("text-xs leading-relaxed", isOutgoing ? "text-black/70" : "text-white/70")}>
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
                              <summary className={cn("cursor-pointer list-none text-xs font-bold", isOutgoing ? "text-black/80" : "text-[#8effc4]")}>
                                {body.includes("Analyzed Image:") ? "📷 Analyzed image details" : "🎤 Analyzed voice details"}
                              </summary>
                              <p className={cn("mt-3 whitespace-pre-wrap text-xs leading-relaxed", isOutgoing ? "text-black/75" : "text-white/75")}>
                                {body
                                  .replace(/\[Analyzed Image\]:?\s*/i, "")
                                  .replace(/\[Analyzed Voice\]:?\s*/i, "")
                                  .replace(/Analyzed Image:\s*/i, "")
                                  .replace(/Analyzed Voice:\s*/i, "")
                                  .trim()}
                              </p>
                            </details>
                          ) : (
                            <p className="whitespace-pre-wrap break-words leading-relaxed text-[14px]">
                              {body}
                            </p>
                          )}

                          <div
                            className={cn(
                              "mt-2.5 flex items-center gap-2 text-[10px]",
                              isOutgoing ? "justify-end text-black/55" : "text-white/40"
                            )}
                          >
                            <span className="font-medium">{formatClock(message.timestamp)}</span>
                            <span className="opacity-50">•</span>
                            <span className="font-bold">
                              {isBot ? "Agent" : message.reply_by === "admin" ? "Admin" : "Customer"}
                            </span>
                          </div>
                        </div>

                        {isBot && (
                          <div className="shrink-0 text-[#00ff88] mb-1">
                            <Bot size={16} className="drop-shadow-[0_0_8px_rgba(0,255,136,0.5)]" />
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {!msgLoading && visibleMessages.length >= MESSAGE_LIMIT && (
                    <div className="pt-4 text-center">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[11px] text-white/40">
                        <div className="h-1.5 w-1.5 rounded-full bg-[#00ff88]/50" />
                        Showing recent {MESSAGE_LIMIT} messages
                      </div>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>

            {/* Input Area */}
            <div className="border-t border-white/5 bg-gradient-to-t from-black/40 to-transparent px-3 py-3.5 pb-[calc(env(safe-area-inset-bottom)+0.875rem)] md:px-6 md:py-4">
              <div className="flex items-end gap-2.5 rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-2.5 backdrop-blur-sm">
                <Input
                  value={newMessage}
                  onChange={(event) => setNewMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Type your message..."
                  className="h-12 border-none bg-transparent text-sm text-white placeholder:text-white/30 focus-visible:ring-0 resize-none"
                />
                <Button
                  size="icon"
                  onClick={handleSendMessage}
                  disabled={!newMessage.trim() || sending}
                  className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[#00ff88] to-[#00cc6a] text-black hover:from-[#00ff88]/90 hover:to-[#00cc6a]/90 transition-all duration-300 shadow-[0_4px_20px_rgba(0,255,136,0.3)] hover:shadow-[0_6px_25px_rgba(0,255,136,0.4)] hover:scale-105 active:scale-95 disabled:hover:scale-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={19} />}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full border border-[#00ff88]/20 bg-gradient-to-br from-[#00ff88]/10 to-[#00ff88]/3">
              <Inbox size={44} className="text-[#00ff88] drop-shadow-[0_0_20px_rgba(0,255,136,0.3)]" />
            </div>
            <h2 className="text-2xl md:text-3xl font-black tracking-tight text-white">
              {emptyStateTitle}
            </h2>
            <p className="mt-4 max-w-[420px] text-sm md:text-base leading-relaxed text-white/50">
              {emptyStateDescription}
            </p>
          </div>
        )}
      </div>

      {/* Desktop Right Panel */}
      {selectedChat && (
        <div className="hidden w-[340px] border-l border-white/5 bg-gradient-to-b from-[#070a12] to-[#050810] lg:flex lg:flex-col">
          {/* Profile Header */}
          <div className="border-b border-white/5 p-7">
            <div className="flex flex-col items-center text-center">
              <Avatar className="h-24 w-24 border-2 border-white/10">
                <AvatarFallback className="bg-gradient-to-br from-white/10 to-white/5 text-white/60">
                  <UserIcon size={36} />
                </AvatarFallback>
              </Avatar>
              <h3 className="mt-5 text-xl font-bold text-white">
                {getDisplayName(selectedChat)}
              </h3>
              <p className="mt-1.5 text-sm text-white/40 font-medium">
                {selectedChat.from}
              </p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-[11px] text-white/55">
                <Smartphone size={14} />
                {getPlatformTitle(platform)}
              </div>
            </div>
          </div>

          {/* Panel Content */}
          <div className="space-y-7 p-7">
            {/* Active Labels */}
            <div className="space-y-3.5">
              <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#8effc4] flex items-center gap-2">
                <div className="h-0.5 w-4 bg-[#8effc4]/50 rounded-full" />
                Active Labels
                <div className="h-0.5 flex-1 bg-[#8effc4]/30 rounded-full" />
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedChat.active_labels.length > 0 ? (
                  selectedChat.active_labels.map((label) => (
                    <Badge
                      key={`panel-${label}`}
                      variant="outline"
                      className={cn("rounded-full px-3.5 py-1.5 text-[10px] font-bold border-opacity-50", LABEL_META[label].className)}
                    >
                      {LABEL_META[label].title}
                    </Badge>
                  ))
                ) : (
                  <Badge
                    variant="outline"
                    className="rounded-full border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-[10px] text-white/45"
                  >
                    New Conversation
                  </Badge>
                )}
              </div>
            </div>

            {/* Label Controls */}
            <div className="space-y-3.5">
              <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#8effc4] flex items-center gap-2">
                <div className="h-0.5 w-4 bg-[#8effc4]/50 rounded-full" />
                Label Controls
                <div className="h-0.5 flex-1 bg-[#8effc4]/30 rounded-full" />
              </div>

              <div className="rounded-2xl border border-white/5 bg-white/[0.025] p-5 hover:bg-white/[0.04] transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-base font-bold text-white">Order</div>
                    <p className="mt-2 text-xs leading-relaxed text-white/45">
                      Add this conversation to your order follow-up queue.
                    </p>
                  </div>
                  <Switch
                    checked={selectedChat.order_selected}
                    disabled={labelUpdating[`${selectedChat.id}:order`]}
                    onCheckedChange={(checked) => handleToggleLabel("order", checked)}
                  />
                </div>
                {selectedChat.order_status && (
                  <div className="mt-4 flex items-center gap-2 text-[11px] text-amber-200/80 bg-amber-500/10 px-3 py-2 rounded-xl border border-amber-500/20">
                    <div className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    Order status: {selectedChat.order_status}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/5 bg-white/[0.025] p-5 hover:bg-white/[0.04] transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-base font-bold text-white">Human Transfer</div>
                    <p className="mt-2 text-xs leading-relaxed text-white/45">
                      Mark for human follow-up when you need to personally reply.
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

            {/* Info Card */}
            <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.025] to-white/[0.015] p-5 text-xs leading-relaxed text-white/45">
              <div className="font-bold text-white/80 text-sm mb-3 flex items-center gap-2">
                <Bot size={14} className="text-[#8effc4]" />
                Smart Rules
              </div>
              <div className="space-y-2.5">
                <p className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#8effc4]/60 shrink-0" />
                  Last reply by bot → Agent label
                </p>
                <p className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-sky-400/60 shrink-0" />
                  Last reply by admin → Human label
                </p>
                <p className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-white/40 shrink-0" />
                  Toggle labels manually as needed
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SmartInbox;
